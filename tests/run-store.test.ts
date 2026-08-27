import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocument, listDocuments } from "@/lib/fake-external-service";
import {
  claimNextRun,
  createRun,
  getRun,
  handleStepFailure,
  markStepCompleted,
  markStepStarted,
  recoverInterruptedRuns,
} from "@/lib/run-store";

describe("durable agent execution", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "durable-agent-"));
    process.env.AGENT_RUN_STORE_FILE = path.join(directory, "runs.json");
    process.env.FAKE_EXTERNAL_ACTIONS_FILE = path.join(directory, "documents.json");
  });

  afterEach(async () => {
    delete process.env.AGENT_RUN_STORE_FILE;
    delete process.env.FAKE_EXTERNAL_ACTIONS_FILE;
    await rm(directory, { recursive: true, force: true });
  });

  it("persists acceptance before a worker claims the run", async () => {
    const run = await createRun("durable task");
    const persisted = JSON.parse(
      await readFile(process.env.AGENT_RUN_STORE_FILE!, "utf8"),
    ) as { runs: Array<{ id: string; status: string }> };

    expect(run.status).toBe("queued");
    expect(persisted.runs).toContainEqual(expect.objectContaining({
      id: run.id,
      status: "queued",
    }));
  });

  it("requeues an interrupted step and preserves completed checkpoints", async () => {
    const accepted = await createRun("recover this task");
    await claimNextRun();
    await markStepStarted(accepted.id, 1);
    await markStepCompleted(accepted.id, 1);
    await markStepStarted(accepted.id, 2);

    expect(await recoverInterruptedRuns()).toBe(1);
    const recovered = await getRun(accepted.id);

    expect(recovered?.status).toBe("queued");
    expect(recovered?.steps[0].status).toBe("completed");
    expect(recovered?.steps[1].status).toBe("pending");
    expect(recovered?.events.at(-1)).toEqual(expect.objectContaining({
      type: "run.recovered",
    }));

    const resumed = await claimNextRun();
    expect(resumed?.id).toBe(accepted.id);
    expect(resumed?.attempts).toBe(2);
    expect(resumed?.events.at(-1)).toEqual(expect.objectContaining({
      type: "run.resumed",
    }));
  });

  it("deduplicates a replayed external side effect by idempotency key", async () => {
    const input = {
      idempotencyKey: "run-1:step-4",
      runId: "run-1",
      title: "Result",
      content: "Content",
    };

    const first = await createDocument(input);
    const replay = await createDocument(input);

    expect(replay.id).toBe(first.id);
    expect(await listDocuments()).toHaveLength(1);
  });

  it("retries transient step errors and eventually records a terminal failure", async () => {
    const accepted = await createRun("failing task");
    await claimNextRun();
    await markStepStarted(accepted.id, 1);

    expect(await handleStepFailure(accepted.id, 1, "temporary", 2)).toBe("retry");
    expect((await getRun(accepted.id))?.status).toBe("queued");

    await claimNextRun();
    await markStepStarted(accepted.id, 1);
    expect(await handleStepFailure(accepted.id, 1, "still failing", 2)).toBe("failed");

    const failed = await getRun(accepted.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.steps[0].status).toBe("failed");
    expect(failed?.events.at(-1)).toEqual(expect.objectContaining({
      type: "run.failed",
      error: "still failing",
    }));
  });
});
