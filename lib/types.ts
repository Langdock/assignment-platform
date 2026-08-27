export type RunStatus = "queued" | "running" | "completed" | "failed";
export type StepStatus = "pending" | "running" | "completed" | "failed";

type EventMetadata = {
  runId: string;
  sequence: number;
  occurredAt: string;
};

export type AgentEvent = (
  | {
      type: "run.accepted";
      prompt: string;
    }
  | {
      type: "run.started" | "run.resumed";
      attempt: number;
    }
  | {
      type: "run.recovered";
      detail: string;
    }
  | {
      type: "step.started";
      step: number;
      title: string;
      attempt: number;
    }
  | {
      type: "step.completed";
      step: number;
      title: string;
      detail?: string;
    }
  | {
      type: "step.retrying";
      step: number;
      title: string;
      error: string;
      nextAttempt: number;
    }
  | {
      type: "step.failed";
      step: number;
      title: string;
      error: string;
    }
  | {
      type: "run.completed";
      result: string;
    }
  | {
      type: "run.failed";
      error: string;
    }
) &
  EventMetadata;

export type AgentStep = {
  number: number;
  title: string;
  status: StepStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  detail?: string;
  error?: string;
};

export type AgentRun = {
  id: string;
  prompt: string;
  status: RunStatus;
  attempts: number;
  steps: AgentStep[];
  events: AgentEvent[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  error?: string;
};

export type RunSummary = Pick<
  AgentRun,
  "id" | "prompt" | "status" | "attempts" | "createdAt" | "updatedAt" | "completedAt" | "error"
> & {
  completedSteps: number;
  totalSteps: number;
};

export type ExternalAction = {
  id: string;
  idempotencyKey: string;
  runId: string;
  title: string;
  content: string;
  createdAt: string;
};
