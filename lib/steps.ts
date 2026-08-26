export const AGENT_STEPS = [
  { number: 1, title: "Understand the request", hasSideEffect: false },
  { number: 2, title: "Search available information", hasSideEffect: false },
  { number: 3, title: "Prepare a recommendation", hasSideEffect: false },
  { number: 4, title: "Create a document in an external system", hasSideEffect: true },
  { number: 5, title: "Produce the final response", hasSideEffect: false },
] as const;

export function documentIdempotencyKey(runId: string): string {
  return `run:${runId}:step:4:create-document`;
}

export function stepDelayMs(): number {
  return Number(process.env.AGENT_STEP_DELAY_MS ?? 2_500);
}

export function stepTransitionDelayMs(): number {
  return Number(process.env.AGENT_STEP_TRANSITION_DELAY_MS ?? 600);
}

export function leaseTtlMs(): number {
  return Number(process.env.AGENT_LEASE_TTL_MS ?? 8_000);
}
