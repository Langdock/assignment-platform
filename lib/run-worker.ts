import { delay, executeAgentStep, stepTransitionDelay } from "@/lib/agent";
import {
  claimNextRun,
  handleStepFailure,
  markRunCompleted,
  markStepCompleted,
  markStepStarted,
  recoverInterruptedRuns,
} from "@/lib/run-store";
import type { AgentRun } from "@/lib/types";

type WorkerGlobals = typeof globalThis & {
  __agentRunWorker?: {
    initialization?: Promise<void>;
    running: boolean;
    wakeVersion: number;
  };
};

const workerGlobals = globalThis as WorkerGlobals;
workerGlobals.__agentRunWorker ??= {
  running: false,
  wakeVersion: 0,
};
const worker = workerGlobals.__agentRunWorker;

function maxStepAttempts(): number {
  const configured = Number(process.env.AGENT_MAX_STEP_ATTEMPTS ?? 3);
  return Number.isInteger(configured) && configured > 0 ? configured : 3;
}

function retryDelay(): number {
  const configured = Number(process.env.AGENT_RETRY_DELAY_MS ?? 1_000);
  return Number.isFinite(configured) && configured >= 0 ? configured : 1_000;
}

async function executeClaimedRun(run: AgentRun): Promise<void> {
  for (const step of run.steps) {
    if (step.status === "completed") continue;

    await markStepStarted(run.id, step.number);
    try {
      const detail = await executeAgentStep({
        runId: run.id,
        prompt: run.prompt,
        step: step.number,
      });
      await markStepCompleted(run.id, step.number, detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown agent step error";
      const resolution = await handleStepFailure(
        run.id,
        step.number,
        message,
        maxStepAttempts(),
      );
      if (resolution === "retry") {
        await delay(retryDelay());
      }
      return;
    }

    if (step.number < run.steps.length) {
      await delay(stepTransitionDelay());
    }
  }

  await markRunCompleted(
    run.id,
    `The agent completed the task “${run.prompt}” and created a document with its result.`,
  );
}

async function runWorker(): Promise<void> {
  try {
    while (true) {
      const observedWakeVersion = worker.wakeVersion;
      let run: AgentRun | null;
      while ((run = await claimNextRun())) {
        await executeClaimedRun(run);
      }
      if (worker.wakeVersion === observedWakeVersion) return;
    }
  } catch (error) {
    console.error("Agent worker stopped unexpectedly.", error);
  } finally {
    worker.running = false;
  }
}

/**
 * Recovers work once per backend process and wakes the singleton local worker.
 * The caller never waits for execution, so browser and request lifetimes are
 * independent from accepted runs.
 */
export async function ensureRunWorker(): Promise<void> {
  worker.initialization ??= recoverInterruptedRuns().then(() => undefined);
  await worker.initialization;

  worker.wakeVersion += 1;
  if (!worker.running) {
    worker.running = true;
    void runWorker();
  }
}
