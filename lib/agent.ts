import { createDocument } from "@/lib/fake-external-service";

function configuredDelay(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function stepTransitionDelay(): number {
  return configuredDelay("AGENT_STEP_TRANSITION_DELAY_MS", 600);
}

export async function executeAgentStep(input: {
  runId: string;
  prompt: string;
  step: number;
}): Promise<string | undefined> {
  await delay(configuredDelay("AGENT_STEP_DELAY_MS", 2_500));

  if (input.step !== 4) return undefined;

  const document = await createDocument({
    idempotencyKey: `agent-run:${input.runId}:step:4`,
    runId: input.runId,
    title: `Agent result: ${input.prompt.slice(0, 48)}`,
    content: `Simulated work product for: ${input.prompt}`,
  });
  return `External document ${document.id} is durable`;
}
