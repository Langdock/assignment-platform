import { createDocument } from "@/lib/fake-external-service";
import { AGENT_STEPS, documentIdempotencyKey, stepDelayMs, stepTransitionDelayMs } from "@/lib/steps";
import { appendEvent, getRun, updateRun } from "@/lib/store";
import type { AgentEvent, RunRecord, StepRecord } from "@/lib/types";

function occurredAt(): string {
  return new Date().toISOString();
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("The run was aborted", "AbortError"));
      return;
    }

    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new DOMException("The run was aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
  );
}

function firstIncompleteStep(run: RunRecord): StepRecord | undefined {
  return run.steps.find((step) => step.status !== "completed");
}

async function emit(event: AgentEvent): Promise<void> {
  await appendEvent(event.runId, event);
}

async function executeStep(input: {
  runId: string;
  prompt: string;
  step: StepRecord;
  signal: AbortSignal;
}): Promise<void> {
  const attempt = input.step.attempt + 1;
  await updateRun(input.runId, (run) => {
    const step = run.steps.find((candidate) => candidate.number === input.step.number);
    if (!step) {
      throw new Error(`Step ${input.step.number} is missing`);
    }
    step.status = "running";
    step.attempt = attempt;
    step.startedAt ??= occurredAt();
  });

  await emit({
    id: crypto.randomUUID(),
    type: "step.started",
    runId: input.runId,
    step: input.step.number,
    title: input.step.title,
    attempt,
    occurredAt: occurredAt(),
  });

  await delay(stepDelayMs(), input.signal);

  let detail: string | undefined;
  if (input.step.number === 4) {
    const document = await createDocument({
      runId: input.runId,
      title: `Agent result: ${input.prompt.slice(0, 48)}`,
      content: `Simulated work product for: ${input.prompt}`,
      idempotencyKey: documentIdempotencyKey(input.runId),
    });
    detail = `Created external document ${document.id}`;
  }

  await updateRun(input.runId, (run) => {
    const step = run.steps.find((candidate) => candidate.number === input.step.number);
    if (!step) {
      throw new Error(`Step ${input.step.number} is missing`);
    }
    step.status = "completed";
    step.completedAt = occurredAt();
    step.detail = detail ?? null;
  });

  await emit({
    id: crypto.randomUUID(),
    type: "step.completed",
    runId: input.runId,
    step: input.step.number,
    title: input.step.title,
    detail,
    occurredAt: occurredAt(),
  });
}

export async function executeRun(input: {
  runId: string;
  recovered: boolean;
  signal: AbortSignal;
}): Promise<void> {
  const run = await getRun(input.runId);
  if (!run) {
    throw new Error(`Run ${input.runId} not found`);
  }
  if (run.status === "completed" || run.status === "failed") {
    return;
  }

  if (!run.events.some((event) => event.type === "run.started")) {
    await emit({
      id: crypto.randomUUID(),
      type: "run.started",
      runId: input.runId,
      prompt: run.prompt,
      occurredAt: occurredAt(),
    });
  }

  if (input.recovered) {
    const resumeFrom = firstIncompleteStep(run)?.number ?? AGENT_STEPS.length;
    await emit({
      id: crypto.randomUUID(),
      type: "run.recovered",
      runId: input.runId,
      resumeFromStep: resumeFrom,
      recoveryCount: run.recoveryCount,
      occurredAt: occurredAt(),
    });
  }

  for (const definition of AGENT_STEPS) {
    const latest = await getRun(input.runId);
    if (!latest) {
      throw new Error(`Run ${input.runId} not found`);
    }
    const step = latest.steps.find((candidate) => candidate.number === definition.number);
    if (!step) {
      throw new Error(`Step ${definition.number} is missing`);
    }
    if (step.status === "completed") {
      continue;
    }

    await executeStep({
      runId: input.runId,
      prompt: latest.prompt,
      step,
      signal: input.signal,
    });
    await delay(stepTransitionDelayMs(), input.signal);
  }

  const result = `The agent completed the task “${run.prompt}” and created a document with its result.`;
  await updateRun(input.runId, (current) => {
    current.status = "completed";
    current.result = result;
    current.finishedAt = occurredAt();
    current.lease = null;
    current.error = null;
  });
  await emit({
    id: crypto.randomUUID(),
    type: "run.completed",
    runId: input.runId,
    result,
    occurredAt: occurredAt(),
  });
}

export async function failRun(runId: string, error: unknown): Promise<void> {
  if (isAbortError(error)) {
    return;
  }

  const message = error instanceof Error ? error.message : "Unknown agent error";
  await updateRun(runId, (run) => {
    if (run.status === "completed") {
      return;
    }
    run.status = "failed";
    run.error = message;
    run.finishedAt = occurredAt();
    run.lease = null;
  });
  await emit({
    id: crypto.randomUUID(),
    type: "run.failed",
    runId,
    error: message,
    occurredAt: occurredAt(),
  });
}
