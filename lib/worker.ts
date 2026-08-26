import { executeRun, failRun } from "@/lib/agent";
import { claimNextRun, heartbeatRun } from "@/lib/store";

type WorkerState = {
  ownerId: string;
  tickTimer: NodeJS.Timeout | null;
  heartbeatTimer: NodeJS.Timeout | null;
  active: Set<string>;
  shuttingDown: boolean;
  abort: AbortController;
};

const MAX_CONCURRENT_RUNS = 2;
const TICK_MS = 400;
const HEARTBEAT_MS = 1_000;

function getWorkerState(): WorkerState | undefined {
  return (globalThis as typeof globalThis & { __agentWorker?: WorkerState }).__agentWorker;
}

function setWorkerState(state: WorkerState | undefined): void {
  const globalState = globalThis as typeof globalThis & { __agentWorker?: WorkerState };
  if (state) {
    globalState.__agentWorker = state;
  } else {
    delete globalState.__agentWorker;
  }
}

async function heartbeatOwned(state: WorkerState): Promise<void> {
  await Promise.all([...state.active].map((runId) => heartbeatRun(runId, state.ownerId)));
}

async function launch(state: WorkerState, runId: string, recovered: boolean): Promise<void> {
  state.active.add(runId);
  try {
    await executeRun({ runId, recovered, signal: state.abort.signal });
  } catch (error) {
    await failRun(runId, error);
  } finally {
    state.active.delete(runId);
  }
}

async function tick(state: WorkerState): Promise<void> {
  if (state.shuttingDown) {
    return;
  }

  await heartbeatOwned(state);

  while (!state.shuttingDown && state.active.size < MAX_CONCURRENT_RUNS) {
    const claimed = await claimNextRun(state.ownerId);
    if (!claimed) {
      break;
    }
    void launch(state, claimed.run.id, claimed.recovered);
  }
}

export function startWorker(): string {
  const existing = getWorkerState();
  if (existing) {
    return existing.ownerId;
  }

  const state: WorkerState = {
    ownerId: `${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
    tickTimer: null,
    heartbeatTimer: null,
    active: new Set(),
    shuttingDown: false,
    abort: new AbortController(),
  };
  setWorkerState(state);

  const pulse = () => {
    void tick(state).catch((error) => {
      console.error("Worker tick failed", error);
    });
  };

  pulse();
  state.tickTimer = setInterval(pulse, TICK_MS);
  state.tickTimer.unref();
  state.heartbeatTimer = setInterval(() => {
    void heartbeatOwned(state);
  }, HEARTBEAT_MS);
  state.heartbeatTimer.unref();

  return state.ownerId;
}

export function notifyWorker(): void {
  const state = getWorkerState();
  if (!state) {
    startWorker();
    return;
  }
  void tick(state);
}

export function stopWorkerForTests(): void {
  const state = getWorkerState();
  if (!state) {
    return;
  }
  state.shuttingDown = true;
  state.abort.abort();
  if (state.tickTimer) {
    clearInterval(state.tickTimer);
  }
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
  }
  setWorkerState(undefined);
}

export function workerOwnerId(): string | undefined {
  return getWorkerState()?.ownerId;
}
