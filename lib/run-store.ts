import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent, AgentRun, RunSummary } from "@/lib/types";

const STEP_TITLES = [
  "Understand the request",
  "Search available information",
  "Prepare a recommendation",
  "Create a document in an external system",
  "Produce the final response",
] as const;

type Store = {
  version: 1;
  runs: AgentRun[];
};

type EventInput<T extends AgentEvent = AgentEvent> = T extends AgentEvent
  ? Omit<T, "runId" | "sequence" | "occurredAt">
  : never;

type StoreGlobals = typeof globalThis & {
  __agentRunStoreLock?: Promise<void>;
};

const storeGlobals = globalThis as StoreGlobals;
storeGlobals.__agentRunStoreLock ??= Promise.resolve();

function storeFile(): string {
  return process.env.AGENT_RUN_STORE_FILE ?? path.join(process.cwd(), ".runtime", "agent-runs.json");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function readStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(
      await readFile(/* turbopackIgnore: true */ storeFile(), "utf8"),
    ) as Store;
    if (parsed.version !== 1 || !Array.isArray(parsed.runs)) {
      throw new Error("The agent run store has an unsupported format.");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, runs: [] };
    }
    throw error;
  }
}

async function writeStore(store: Store): Promise<void> {
  const file = storeFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(store, null, 2), "utf8");
  await rename(temporaryFile, file);
}

async function withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = storeGlobals.__agentRunStoreLock!;
  let release!: () => void;
  storeGlobals.__agentRunStoreLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function inspectStore<T>(inspect: (store: Store) => T): Promise<T> {
  return withStoreLock(async () => inspect(await readStore()));
}

async function mutateStore<T>(mutate: (store: Store) => T): Promise<T> {
  return withStoreLock(async () => {
    const store = await readStore();
    const result = mutate(store);
    await writeStore(store);
    return result;
  });
}

function requireRun(store: Store, runId: string): AgentRun {
  const run = store.runs.find((candidate) => candidate.id === runId);
  if (!run) {
    throw new Error(`Run ${runId} does not exist.`);
  }
  return run;
}

function appendEvent(run: AgentRun, event: EventInput): void {
  run.events.push({
    ...event,
    runId: run.id,
    sequence: run.events.length + 1,
    occurredAt: new Date().toISOString(),
  } as AgentEvent);
  run.updatedAt = run.events.at(-1)!.occurredAt;
}

export async function createRun(prompt: string): Promise<AgentRun> {
  return mutateStore((store) => {
    const now = new Date().toISOString();
    const run: AgentRun = {
      id: crypto.randomUUID(),
      prompt,
      status: "queued",
      attempts: 0,
      steps: STEP_TITLES.map((title, index) => ({
        number: index + 1,
        title,
        status: "pending",
        attempts: 0,
      })),
      events: [],
      createdAt: now,
      updatedAt: now,
    };
    appendEvent(run, { type: "run.accepted", prompt });
    store.runs.push(run);
    return clone(run);
  });
}

export async function getRun(runId: string): Promise<AgentRun | null> {
  return inspectStore((store) => {
    const run = store.runs.find((candidate) => candidate.id === runId);
    return run ? clone(run) : null;
  });
}

export async function listRuns(): Promise<RunSummary[]> {
  return inspectStore((store) =>
    store.runs
      .slice()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((run) => ({
        id: run.id,
        prompt: run.prompt,
        status: run.status,
        attempts: run.attempts,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt,
        error: run.error,
        completedSteps: run.steps.filter((step) => step.status === "completed").length,
        totalSteps: run.steps.length,
      })),
  );
}

export async function recoverInterruptedRuns(): Promise<number> {
  return mutateStore((store) => {
    let recovered = 0;
    for (const run of store.runs) {
      if (run.status !== "running") continue;

      const interruptedStep = run.steps.find((step) => step.status === "running");
      if (interruptedStep) {
        interruptedStep.status = "pending";
        interruptedStep.error = undefined;
      }
      run.status = "queued";
      appendEvent(run, {
        type: "run.recovered",
        detail: interruptedStep
          ? `Execution stopped during step ${interruptedStep.number}; the step was requeued.`
          : "Execution stopped between steps; the next incomplete step was requeued.",
      });
      recovered += 1;
    }
    return recovered;
  });
}

export async function claimNextRun(): Promise<AgentRun | null> {
  return mutateStore((store) => {
    const run = store.runs
      .filter((candidate) => candidate.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!run) return null;

    run.status = "running";
    run.attempts += 1;
    run.startedAt ??= new Date().toISOString();
    appendEvent(run, {
      type: run.attempts === 1 ? "run.started" : "run.resumed",
      attempt: run.attempts,
    });
    return clone(run);
  });
}

export async function markStepStarted(runId: string, stepNumber: number): Promise<void> {
  await mutateStore((store) => {
    const run = requireRun(store, runId);
    const step = run.steps.find((candidate) => candidate.number === stepNumber);
    if (!step || run.status !== "running" || step.status !== "pending") {
      throw new Error(`Step ${stepNumber} of run ${runId} cannot be started.`);
    }

    step.status = "running";
    step.attempts += 1;
    step.startedAt = new Date().toISOString();
    step.error = undefined;
    appendEvent(run, {
      type: "step.started",
      step: step.number,
      title: step.title,
      attempt: step.attempts,
    });
  });
}

export async function markStepCompleted(
  runId: string,
  stepNumber: number,
  detail?: string,
): Promise<void> {
  await mutateStore((store) => {
    const run = requireRun(store, runId);
    const step = run.steps.find((candidate) => candidate.number === stepNumber);
    if (!step || run.status !== "running" || step.status !== "running") {
      throw new Error(`Step ${stepNumber} of run ${runId} cannot be completed.`);
    }

    step.status = "completed";
    step.completedAt = new Date().toISOString();
    step.detail = detail;
    appendEvent(run, {
      type: "step.completed",
      step: step.number,
      title: step.title,
      detail,
    });
  });
}

export async function handleStepFailure(
  runId: string,
  stepNumber: number,
  error: string,
  maxAttempts: number,
): Promise<"retry" | "failed"> {
  return mutateStore((store) => {
    const run = requireRun(store, runId);
    const step = run.steps.find((candidate) => candidate.number === stepNumber);
    if (!step || run.status !== "running" || step.status !== "running") {
      throw new Error(`Step ${stepNumber} of run ${runId} cannot record a failure.`);
    }

    step.error = error;
    if (step.attempts < maxAttempts) {
      step.status = "pending";
      run.status = "queued";
      appendEvent(run, {
        type: "step.retrying",
        step: step.number,
        title: step.title,
        error,
        nextAttempt: step.attempts + 1,
      });
      return "retry";
    }

    step.status = "failed";
    run.status = "failed";
    run.error = error;
    run.completedAt = new Date().toISOString();
    appendEvent(run, {
      type: "step.failed",
      step: step.number,
      title: step.title,
      error,
    });
    appendEvent(run, { type: "run.failed", error });
    return "failed";
  });
}

export async function markRunCompleted(runId: string, result: string): Promise<void> {
  await mutateStore((store) => {
    const run = requireRun(store, runId);
    if (run.status !== "running" || run.steps.some((step) => step.status !== "completed")) {
      throw new Error(`Run ${runId} cannot be completed.`);
    }

    run.status = "completed";
    run.result = result;
    run.completedAt = new Date().toISOString();
    appendEvent(run, { type: "run.completed", result });
  });
}
