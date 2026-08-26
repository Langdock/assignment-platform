import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeRun } from "@/lib/agent";
import { createDocument, listDocuments, resetDocuments } from "@/lib/fake-external-service";
import { documentIdempotencyKey } from "@/lib/steps";
import {
  claimNextRun,
  createRun,
  deleteAllRunsForTests,
  getRun,
  listRuns,
  resetStoreLockForTests,
  updateRun,
} from "@/lib/store";
import { resetRunBusForTests } from "@/lib/run-bus";
import { stopWorkerForTests } from "@/lib/worker";

async function withTempRuntime(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-runtime-"));
  process.env.RUNTIME_DIR = directory;
  process.env.AGENT_STEP_DELAY_MS = "20";
  process.env.AGENT_STEP_TRANSITION_DELAY_MS = "5";
  return directory;
}

describe("durable agent execution", () => {
  let runtimeDir: string;

  beforeEach(async () => {
    runtimeDir = await withTempRuntime();
    resetStoreLockForTests();
    resetRunBusForTests();
    stopWorkerForTests();
  });

  afterEach(async () => {
    stopWorkerForTests();
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it("persists an accepted run independently of a client connection", async () => {
    const created = await createRun("Inspect persistence");
    const listed = await listRuns();
    const loaded = await getRun(created.id);

    expect(created.status).toBe("queued");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(loaded?.events[0]?.type).toBe("run.accepted");
  });

  it("returns the same external document when a step is retried", async () => {
    await resetDocuments();
    const first = await createDocument({
      runId: "run-1",
      title: "Result",
      content: "Body",
      idempotencyKey: "run:run-1:step:4:create-document",
    });
    const second = await createDocument({
      runId: "run-1",
      title: "Result",
      content: "Body",
      idempotencyKey: "run:run-1:step:4:create-document",
    });

    expect(second.id).toBe(first.id);
    expect(await listDocuments()).toHaveLength(1);
  });

  it("executes a run to completion from a checkpoint", async () => {
    const created = await createRun("Finish the remaining work");
    const claimed = await claimNextRun("worker-a");
    expect(claimed?.run.id).toBe(created.id);
    expect(claimed?.recovered).toBe(false);

    await executeRun({
      runId: created.id,
      recovered: false,
      signal: new AbortController().signal,
    });

    const finished = await getRun(created.id);
    expect(finished?.status).toBe("completed");
    expect(finished?.steps.every((step) => step.status === "completed")).toBe(true);
    expect(await listDocuments()).toHaveLength(1);
  });

  it("recovers an interrupted run without duplicating the external document", async () => {
    const created = await createRun("Recover after a crash");
    const existing = await createDocument({
      runId: created.id,
      title: `Agent result: Recover after a crash`,
      content: `Simulated work product for: Recover after a crash`,
      idempotencyKey: documentIdempotencyKey(created.id),
    });

    await updateRun(created.id, (run) => {
      run.status = "running";
      run.startedAt = new Date().toISOString();
      run.lease = {
        ownerId: "dead-worker",
        pid: 999_999_999,
        heartbeatAt: new Date().toISOString(),
      };
      for (const step of run.steps) {
        if (step.number <= 3) {
          step.status = "completed";
          step.startedAt = run.startedAt;
          step.completedAt = run.startedAt;
          step.attempt = 1;
        }
        if (step.number === 4) {
          step.status = "running";
          step.startedAt = run.startedAt;
          step.attempt = 1;
        }
      }
    });

    const claimed = await claimNextRun("worker-b");
    expect(claimed?.recovered).toBe(true);
    expect(claimed?.run.recoveryCount).toBe(1);

    await executeRun({
      runId: created.id,
      recovered: true,
      signal: new AbortController().signal,
    });

    const finished = await getRun(created.id);
    const documents = await listDocuments();
    expect(finished?.status).toBe("completed");
    expect(finished?.events.some((event) => event.type === "run.recovered")).toBe(true);
    expect(finished?.steps[3]?.attempt).toBeGreaterThan(1);
    expect(documents).toHaveLength(1);
    expect(documents[0]?.id).toBe(existing.id);
  });

  it("does not reclaim a run already owned by the current worker", async () => {
    const created = await createRun("Only one owner");
    const first = await claimNextRun("worker-a");
    const second = await claimNextRun("worker-a");

    expect(first?.run.id).toBe(created.id);
    expect(second).toBeNull();
    await deleteAllRunsForTests();
  });
});
