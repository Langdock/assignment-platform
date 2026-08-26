export type RunStatus = "queued" | "running" | "completed" | "failed";
export type StepStatus = "pending" | "running" | "completed" | "failed";

export type AgentEvent =
  | {
      id: string;
      type: "run.accepted";
      runId: string;
      prompt: string;
      occurredAt: string;
    }
  | {
      id: string;
      type: "run.started";
      runId: string;
      prompt: string;
      occurredAt: string;
    }
  | {
      id: string;
      type: "run.recovered";
      runId: string;
      resumeFromStep: number;
      recoveryCount: number;
      occurredAt: string;
    }
  | {
      id: string;
      type: "step.started";
      runId: string;
      step: number;
      title: string;
      attempt: number;
      occurredAt: string;
    }
  | {
      id: string;
      type: "step.completed";
      runId: string;
      step: number;
      title: string;
      detail?: string;
      occurredAt: string;
    }
  | {
      id: string;
      type: "run.completed";
      runId: string;
      result: string;
      occurredAt: string;
    }
  | {
      id: string;
      type: "run.failed";
      runId: string;
      error: string;
      occurredAt: string;
    };

export type StepRecord = {
  number: number;
  title: string;
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  detail: string | null;
  attempt: number;
};

export type RunLease = {
  ownerId: string;
  pid: number;
  heartbeatAt: string;
};

export type RunRecord = {
  id: string;
  prompt: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  error: string | null;
  recoveryCount: number;
  lease: RunLease | null;
  steps: StepRecord[];
  events: AgentEvent[];
};

export type RunSummary = {
  id: string;
  prompt: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  recoveryCount: number;
  currentStep: number | null;
};

export type ExternalAction = {
  id: string;
  runId: string;
  title: string;
  content: string;
  createdAt: string;
  idempotencyKey: string;
};
