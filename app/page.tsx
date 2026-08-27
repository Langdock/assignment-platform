"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { AgentEvent, AgentRun, ExternalAction, RunStatus, RunSummary } from "@/lib/types";

const defaultPrompt = "Research the most important considerations for adopting an enterprise AI assistant.";

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "run.accepted":
      return "Run durably accepted";
    case "run.started":
      return `Execution started (attempt ${event.attempt})`;
    case "run.resumed":
      return `Execution resumed (attempt ${event.attempt})`;
    case "run.recovered":
      return event.detail;
    case "step.started":
      return `${event.title} (attempt ${event.attempt})`;
    case "step.completed":
      return event.detail ?? `${event.title} completed`;
    case "step.retrying":
      return `${event.title} will retry: ${event.error}`;
    case "step.failed":
      return `${event.title} failed: ${event.error}`;
    case "run.completed":
      return "Run completed";
    case "run.failed":
      return `Run failed: ${event.error}`;
  }
}

function statusLabel(status?: RunStatus): string {
  return status ? `${status[0].toUpperCase()}${status.slice(1)}` : "Ready";
}

export default function Home() {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [documents, setDocuments] = useState<ExternalAction[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    const response = await fetch("/api/fake-tools/documents", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load external documents.");
    const body = (await response.json()) as { documents: ExternalAction[] };
    setDocuments(body.documents);
  }, []);

  const loadRuns = useCallback(async () => {
    const response = await fetch("/api/runs", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load runs.");
    const body = (await response.json()) as { runs: RunSummary[] };
    setRuns(body.runs);
    setSelectedRunId((current) => current ?? body.runs[0]?.id ?? null);
  }, []);

  const loadRun = useCallback(async (runId: string) => {
    const response = await fetch(`/api/runs/${runId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the selected run.");
    const body = (await response.json()) as { run: AgentRun };
    setRun(body.run);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void Promise.all([loadRuns(), loadDocuments()]).catch((error: unknown) => {
        setRequestError(error instanceof Error ? error.message : "Could not load saved state.");
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadDocuments, loadRuns]);

  useEffect(() => {
    if (!selectedRunId) return;

    let active = true;
    const refresh = async () => {
      try {
        await Promise.all([loadRun(selectedRunId), loadRuns(), loadDocuments()]);
        if (active) setRequestError(null);
      } catch (error) {
        if (active) {
          setRequestError(
            error instanceof Error
              ? `${error.message} The backend may be restarting.`
              : "The backend may be restarting.",
          );
        }
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [loadDocuments, loadRun, loadRuns, selectedRunId]);

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || submitting) return;

    setRequestError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `The run request failed with status ${response.status}.`);
      }

      const body = (await response.json()) as { run: AgentRun };
      setRun(body.run);
      setSelectedRunId(body.run.id);
      await loadRuns();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "The run could not be accepted.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resetDocuments() {
    await fetch("/api/fake-tools/documents", { method: "DELETE" });
    await loadDocuments();
  }

  async function terminateBackend() {
    setRequestError("Backend termination requested. Restart it with pnpm dev; this run will recover.");
    try {
      await fetch("/api/debug/crash", { method: "POST" });
    } catch {
      // The endpoint intentionally terminates its own process before the request settles.
    }
  }

  const active = run?.status === "queued" || run?.status === "running";

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="workspace-pill"><span className="brand-orb" aria-hidden="true" />Langdock Platform</div>
        <h1>What are we working on?</h1>
        <form className="composer" onSubmit={startRun}>
          <label className="sr-only" htmlFor="prompt">Agent task</label>
          <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Give the agent a task…" rows={3} />
          <div className="composer-footer">
            <span>5 durable steps · safe to disconnect</span>
            <button aria-label="Start agent run" disabled={submitting || !prompt.trim()} type="submit">
              {submitting ? <span className="spinner" /> : <span aria-hidden="true">↑</span>}
            </button>
          </div>
        </form>
        <p className="connection-note">Runs are persisted before acceptance and continue without this browser connection.</p>
      </section>

      <section className="activity" aria-live="polite">
        <div className="section-heading">
          <div><span className="section-label">Selected run</span>{run && <code>{run.id}</code>}</div>
          <div className="run-controls">
            {process.env.NODE_ENV === "development" && active && (
              <button className="crash-button" onClick={terminateBackend} type="button">Simulate process crash</button>
            )}
            <span className={`status status-${run?.status ?? "ready"}`}><i aria-hidden="true" />{statusLabel(run?.status)}</span>
          </div>
        </div>
        {!run ? <div className="quiet-state">Start a run or select one from run history.</div> : (
          <>
            <div className="progress-summary">
              <span>{run.steps.filter((step) => step.status === "completed").length} / {run.steps.length} steps complete</span>
              <span>Execution attempt {run.attempts || "—"}</span>
            </div>
            <div className="timeline">
              {run.events.map((event) => (
                <div className="timeline-row" key={event.sequence}>
                  <span className={`timeline-dot ${event.type.endsWith("completed") ? "dot-complete" : event.type.endsWith("failed") ? "dot-failed" : ""}`} />
                  <strong>{eventLabel(event)}</strong>
                  <time>{new Date(event.occurredAt).toLocaleTimeString()}</time>
                </div>
              ))}
            </div>
          </>
        )}
        {requestError && <p className="error-message">{requestError}</p>}
        {run?.result && <div className="result">{run.result}</div>}
      </section>

      <section className="run-history">
        <div className="section-heading">
          <div><span className="section-label">Run history</span><p>Persisted runs remain inspectable after refreshes and restarts.</p></div>
        </div>
        {runs.length === 0 ? <div className="quiet-state">No accepted runs yet.</div> : (
          <div className="run-list">
            {runs.map((savedRun) => (
              <button className={savedRun.id === selectedRunId ? "selected" : ""} key={savedRun.id} onClick={() => setSelectedRunId(savedRun.id)} type="button">
                <span><strong>{savedRun.prompt}</strong><small>{savedRun.completedSteps}/{savedRun.totalSteps} steps · {new Date(savedRun.createdAt).toLocaleString()}</small></span>
                <em className={`status-${savedRun.status}`}>{statusLabel(savedRun.status)}</em>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="external-system">
        <div className="section-heading">
          <div><span className="section-label">Fake external system</span><p>Documents persist across restarts; each run uses an idempotency key to prevent replay duplicates.</p></div>
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
