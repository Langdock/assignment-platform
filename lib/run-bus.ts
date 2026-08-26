import type { AgentEvent } from "@/lib/types";

type Listener = (event: AgentEvent) => void;

type BusState = {
  listeners: Map<string, Set<Listener>>;
  waiters: Map<string, Set<() => void>>;
};

function getState(): BusState {
  const globalState = globalThis as typeof globalThis & { __runBus?: BusState };
  globalState.__runBus ??= { listeners: new Map(), waiters: new Map() };
  return globalState.__runBus;
}

export function publishRunEvent(runId: string, event: AgentEvent): void {
  const state = getState();
  for (const listener of state.listeners.get(runId) ?? []) {
    listener(event);
  }
  const waiters = state.waiters.get(runId);
  if (waiters) {
    for (const wake of waiters) wake();
    waiters.clear();
  }
}

export function subscribeRunEvents(runId: string, listener: Listener): () => void {
  const state = getState();
  const listeners = state.listeners.get(runId) ?? new Set<Listener>();
  listeners.add(listener);
  state.listeners.set(runId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      state.listeners.delete(runId);
    }
  };
}

export function waitForRunEvent(runId: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  const state = getState();
  return new Promise((resolve) => {
    const waiters = state.waiters.get(runId) ?? new Set<() => void>();
    const finish = () => {
      waiters.delete(finish);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    waiters.add(finish);
    state.waiters.set(runId, waiters);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function resetRunBusForTests(): void {
  const globalState = globalThis as typeof globalThis & { __runBus?: BusState };
  delete globalState.__runBus;
}
