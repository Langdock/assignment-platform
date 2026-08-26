import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { publishRunEvent } from "@/lib/run-bus";
import { getRuntimeDirectory } from "@/lib/runtime";
import { AGENT_STEPS, leaseTtlMs } from "@/lib/steps";
import type { AgentEvent, RunRecord, RunSummary, StepRecord } from "@/lib/types";

type LockState = { chain: Promise<unknown> };

function getLock(): LockState {
  const globalState = globalThis as typeof globalThis & { __runStoreLock?: LockState };
  globalState.__runStoreLock ??= { chain: Promise.resolve() };
  return globalState.__runStoreLock;
}

function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = getLock();
  const next = lock.chain.then(fn, fn);
  lock.chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function runsDirectory(): string {
  return path.join(getRuntimeDirectory(), "runs");
}

function runFile(id: string): string {
  return path.join(runsDirectory(), `${id}.json`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isTerminalStatus(status: RunRecord["status"]): boolean {
  return status === "completed" || status === "failed";
}

export function isLeaseExpired(run: RunRecord, now = Date.now()): boolean {
  if (!run.lease) {
    return true;
  }
  if (!isPidAlive(run.lease.pid)) {
    return true;
  }
  const heartbeat = Date.parse(run.lease.heartbeatAt);
  return Number.isNaN(heartbeat) || now - heartbeat > leaseTtlMs();
}

function toSummary(run: RunRecord): RunSummary {
  const current = run.steps.find((step) => step.status !== "completed") ?? null;
  return {
    id: run.id,
    prompt: run.prompt,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    recoveryCount: run.recoveryCount,
    currentStep: current && run.status === "running" ? current.number : null,
  };
}

function initialSteps(): StepRecord[] {
  return AGENT_STEPS.map((step) => ({
    number: step.number,
    title: step.title,
    status: "pending",
    startedAt: null,
    completedAt: null,
    detail: null,
    attempt: 0,
  }));
}

async function writeRunFile(run: RunRecord): Promise<void> {
  await mkdir(runsDirectory(), { recursive: true });
  const file = runFile(run.id);
  const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(run, null, 2), "utf8");
  await rename(temporaryFile, file);
}

async function readRunFile(id: string): Promise<RunRecord | null> {
  try {
    return JSON.parse(await readFile(runFile(id), "utf8")) as RunRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function listRunFiles(): Promise<string[]> {
  try {
    const files = await readdir(runsDirectory());
    return files.filter((file) => file.endsWith(".json") && !file.includes(".tmp"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function createRun(prompt: string): Promise<RunRecord> {
  return withStoreLock(async () => {
    const occurredAt = nowIso();
    const id = crypto.randomUUID();
    const accepted: AgentEvent = {
      id: crypto.randomUUID(),
      type: "run.accepted",
      runId: id,
      prompt,
      occurredAt,
    };
    const run: RunRecord = {
      id,
      prompt,
      status: "queued",
      createdAt: occurredAt,
      updatedAt: occurredAt,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      recoveryCount: 0,
      lease: null,
      steps: initialSteps(),
      events: [accepted],
    };
    await writeRunFile(run);
    publishRunEvent(id, accepted);
    return run;
  });
}

export async function getRun(id: string): Promise<RunRecord | null> {
  return withStoreLock(() => readRunFile(id));
}

export async function listRuns(): Promise<RunSummary[]> {
  return withStoreLock(async () => {
    const ids = (await listRunFiles()).map((file) => file.replace(/\.json$/, ""));
    const runs = (await Promise.all(ids.map((id) => readRunFile(id)))).filter(
      (run): run is RunRecord => run !== null,
    );
    runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return runs.map(toSummary);
  });
}

export async function updateRun(
  id: string,
  mutator: (run: RunRecord) => void | Promise<void>,
): Promise<RunRecord> {
  return withStoreLock(async () => {
    const run = await readRunFile(id);
    if (!run) {
      throw new Error(`Run ${id} not found`);
    }
    await mutator(run);
    run.updatedAt = nowIso();
    await writeRunFile(run);
    return run;
  });
}

export async function appendEvent(id: string, event: AgentEvent): Promise<RunRecord> {
  const run = await updateRun(id, (current) => {
    current.events.push(event);
  });
  publishRunEvent(id, event);
  return run;
}

export async function claimNextRun(ownerId: string): Promise<{ run: RunRecord; recovered: boolean } | null> {
  return withStoreLock(async () => {
    const ids = (await listRunFiles()).map((file) => file.replace(/\.json$/, ""));
    const runs = (await Promise.all(ids.map((id) => readRunFile(id)))).filter(
      (run): run is RunRecord => run !== null,
    );
    runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const candidate = runs.find((run) => {
      if (isTerminalStatus(run.status)) {
        return false;
      }
      if (run.lease?.ownerId === ownerId) {
        return false;
      }
      if (run.status === "queued" && (!run.lease || isLeaseExpired(run))) {
        return true;
      }
      return run.status === "running" && isLeaseExpired(run);
    });

    if (!candidate) {
      return null;
    }

    const recovered = Boolean(candidate.startedAt);
    candidate.status = "running";
    candidate.startedAt ??= nowIso();
    if (recovered) {
      candidate.recoveryCount += 1;
    }
    candidate.lease = {
      ownerId,
      pid: process.pid,
      heartbeatAt: nowIso(),
    };
    candidate.updatedAt = nowIso();
    await writeRunFile(candidate);
    return { run: candidate, recovered };
  });
}

export async function heartbeatRun(id: string, ownerId: string): Promise<boolean> {
  return withStoreLock(async () => {
    const run = await readRunFile(id);
    if (!run || run.lease?.ownerId !== ownerId || isTerminalStatus(run.status)) {
      return false;
    }
    run.lease = {
      ownerId,
      pid: process.pid,
      heartbeatAt: nowIso(),
    };
    run.updatedAt = nowIso();
    await writeRunFile(run);
    return true;
  });
}

export async function releaseLease(id: string, ownerId: string): Promise<void> {
  await withStoreLock(async () => {
    const run = await readRunFile(id);
    if (!run || run.lease?.ownerId !== ownerId) {
      return;
    }
    run.lease = null;
    run.updatedAt = nowIso();
    await writeRunFile(run);
  });
}

export async function deleteAllRunsForTests(): Promise<void> {
  await withStoreLock(async () => {
    const files = await listRunFiles();
    await Promise.all(files.map((file) => unlink(path.join(runsDirectory(), file))));
  });
}

export function resetStoreLockForTests(): void {
  const globalState = globalThis as typeof globalThis & { __runStoreLock?: LockState };
  delete globalState.__runStoreLock;
}
