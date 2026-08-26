"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, ExternalAction, RunRecord, RunSummary } from "@/lib/types";

const defaultPrompt = "Research the most important considerations for adopting an enterprise AI assistant.";
const activeRunStorageKey = "langdock.activeRunId";

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "run.accepted":
      return "Run accepted and persisted";
    case "run.started":
      return "Worker started execution";
    case "run.recovered":
      return `Recovered after interruption · resuming at step ${event.resumeFromStep}`;
    case "step.started":
      return event.attempt > 1 ? `${event.title} (retry ${event.attempt})` : event.title;
    case "step.completed":
      return event.detail ?? `${event.title} completed`;
    case "run.completed":
      return "Run completed";
    case "run.failed":
      return event.error;
  }
}

function statusLabel(run: RunRecord | RunSummary | null, events: AgentEvent[]): string {
  if (events.some((event) => event.type === "run.completed") || run?.status === "completed") {
    return "Completed";
  }
  if (events.some((event) => event.type === "run.failed") || run?.status === "failed") {
    return "Failed";
  }
  if (events.some((event) => event.type === "run.recovered")) {
    return "Recovered";
  }
  if (events.some((event) => event.type === "run.started") || run?.status === "running") {
    return "Running";
  }
  if (run?.status === "queued" || events.some((event) => event.type === "run.accepted")) {
    return "Queued";
  }
  return "Ready";
}

function mergeEvents(current: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) {
    byId.set(event.id, event);
  }
  return [...byId.values()];
}

export default function Home() {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [documents, setDocuments] = useState<ExternalAction[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [connected, setConnected] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const selectedRunId = selectedRun?.id ?? events[0]?.runId;

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/fake-tools/documents", { cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as { documents: ExternalAction[] };
      setDocuments(body.documents);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    const response = await fetch("/api/runs", { cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { runs: RunSummary[] };
    setRuns(body.runs);
    return body.runs;
  }, []);

  const subscribe = useCallback((runId: string) => {
    eventSourceRef.current?.close();
    const source = new EventSource(`/api/runs/${runId}/events`);
    eventSourceRef.current = source;
    source.onopen = () => setConnected(true);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as AgentEvent;
      setEvents((current) => mergeEvents(current, [event]));
      if (event.type === "run.recovered" || event.type === "run.completed" || event.type === "run.failed") {
        void fetch(`/api/runs/${runId}`, { cache: "no-store" })
          .then((response) => (response.ok ? response.json() : null))
          .then((body: { run: RunRecord } | null) => {
            if (body?.run) {
              setSelectedRun(body.run);
            }
          });
        void loadDocuments();
        void loadRuns();
      }
    };
    source.onerror = () => setConnected(false);
  }, [loadDocuments, loadRuns]);

  const selectRun = useCallback(
    async (runId: string) => {
      localStorage.setItem(activeRunStorageKey, runId);
      const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
      if (!response.ok) {
        setRequestError("The selected run could not be loaded.");
        return;
      }
      const body = (await response.json()) as { run: RunRecord };
      setSelectedRun(body.run);
      setEvents(body.run.events);
      setRequestError(null);
      subscribe(runId);
    },
    [subscribe],
  );

  useEffect(() => {
    const bootstrap = async () => {
      await loadDocuments();
      const listed = await loadRuns();
      const storedId = localStorage.getItem(activeRunStorageKey);
      const active = listed.find((run) => run.id === storedId) ?? listed.find((run) => run.status === "running" || run.status === "queued") ?? listed[0];
      if (active) {
        await selectRun(active.id);
      }
    };

    void bootstrap();
    const refresh = setInterval(() => {
      void loadRuns();
      void loadDocuments();
    }, 2500);

    return () => {
      clearInterval(refresh);
      eventSourceRef.current?.close();
    };
  }, [loadDocuments, loadRuns, selectRun]);

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || submitting) return;

    setSubmitting(true);
    setRequestError(null);

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok) {
        throw new Error(`The run request failed with status ${response.status}.`);
      }
      const body = (await response.json()) as { run: RunSummary };
      setEvents([]);
      setSelectedRun(null);
      await loadRuns();
      await selectRun(body.run.id);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "The run could not be started.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resetDocuments() {
    await fetch("/api/fake-tools/documents", { method: "DELETE" });
    await loadDocuments();
  }

  async function terminateBackend() {
    setRequestError("Backend termination requested. Restart it with pnpm dev, then refresh or wait — the run will be recovered.");
    try {
      await fetch("/api/debug/crash", { method: "POST" });
    } catch {
      // The request may fail because the endpoint intentionally terminates its own process.
    }
  }

  const status = statusLabel(selectedRun, events);
  const completed = events.find((event) => event.type === "run.completed");
  const inProgress = status === "Running" || status === "Queued" || status === "Recovered";

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="workspace-pill"><span className="brand-orb" aria-hidden="true" />Langdock Platform</div>
        <h1>What are we working on?</h1>
        <form className="composer" onSubmit={startRun}>
          <label className="sr-only" htmlFor="prompt">Agent task</label>
          <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Give the agent a task…" rows={3} />
          <div className="composer-footer">
            <span>5 simulated steps · about 15 seconds · survives refresh and crash</span>
            <button aria-label="Start agent run" disabled={submitting || !prompt.trim()} type="submit">
              {submitting ? <span className="spinner" /> : <span aria-hidden="true">↑</span>}
            </button>
          </div>
        </form>
        <p className="connection-note">
          Execution continues on the server after you close the tab. Refresh to inspect live progress.
          {!connected && inProgress && <strong> Reconnecting to the worker…</strong>}
        </p>
      </section>

      {runs.length > 0 && (
        <section className="recent-runs" aria-label="Recent runs">
          <div className="section-heading">
            <div><span className="section-label">Recent runs</span></div>
          </div>
          <div className="run-chips">
            {runs.slice(0, 8).map((run) => (
              <button
                key={run.id}
                className={`run-chip ${run.id === selectedRunId ? "run-chip-active" : ""}`}
                onClick={() => void selectRun(run.id)}
                type="button"
              >
                <i className={`status-dot status-${run.status}`} />
                <span>{run.prompt}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="activity" aria-live="polite">
        <div className="section-heading">
          <div>
            <span className="section-label">Current run</span>
            {selectedRunId && <code>{selectedRunId}</code>}
            {(selectedRun?.recoveryCount ?? 0) > 0 || events.some((event) => event.type === "run.recovered") ? (
              <span className="recovery-badge">Recovered {Math.max(selectedRun?.recoveryCount ?? 1, 1)}×</span>
            ) : null}
          </div>
          <div className="run-controls">
            {process.env.NODE_ENV === "development" && inProgress && (
              <button className="crash-button" onClick={terminateBackend} type="button">Simulate process crash</button>
            )}
            <span className={`status status-${status.toLowerCase()}`}><i aria-hidden="true" />{status}</span>
          </div>
        </div>
        {events.length === 0 ? <div className="quiet-state">Run activity will appear here.</div> : (
          <div className="timeline">
            {events.map((event, index) => (
              <div className="timeline-row" key={event.id ?? `${event.type}-${event.occurredAt}-${index}`}>
                <span className={`timeline-dot ${event.type === "run.recovered" ? "dot-recovered" : event.type.endsWith("completed") ? "dot-complete" : ""}`} />
                <strong>{eventLabel(event)}</strong>
                <time>{new Date(event.occurredAt).toLocaleTimeString()}</time>
              </div>
            ))}
          </div>
        )}
        {requestError && <p className="error-message">{requestError}</p>}
        {completed?.type === "run.completed" && <div className="result">{completed.result}</div>}
      </section>

      <section className="external-system">
        <div className="section-heading">
          <div>
            <span className="section-label">Fake external system</span>
            <p>Documents persist across restarts. Creation is idempotent per run, so recovery does not duplicate them.</p>
          </div>
          {documents.length > 0 && <button className="text-button" onClick={resetDocuments} type="button">Reset</button>}
        </div>
        {documents.length === 0 ? <div className="quiet-state">No documents created.</div> : (
          <div className="document-list">
            {documents.slice().reverse().map((document) => (
              <article key={document.id}>
                <span className="document-icon" aria-hidden="true">↗</span>
                <div><strong>{document.title}</strong><small>Run {document.runId.slice(0, 8)} · {new Date(document.createdAt).toLocaleString()}</small></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
