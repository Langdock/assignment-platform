# Platform Engineering Challenge: Long-Running Agent Execution

The starter application contains a small simulated AI agent. A user submits a task through the frontend, the backend performs several agent steps, and progress is streamed back to the browser.

The current implementation works while the browser connection and backend process remain alive. This execution model is insufficient as agent runs grow from seconds to minutes or potentially much longer.

## The problem

During a long-running agent execution:

- The user may refresh or close the browser.
- A network connection may be interrupted.
- An application instance may restart during a deployment.
- The process executing the run may crash.
- A transient dependency failure may require work to be retried.

Once the system has accepted a run, it should not simply disappear because one of these things happened.

## Your task

Evolve the starter application into a small prototype for reliable long-running agent execution.

We intentionally do not prescribe an architecture, infrastructure component, or library. Decide how the system should work and demonstrate the most important parts of your design.

Your solution should address these outcomes:

1. Agent execution does not depend on the original browser connection remaining open.
2. A user can refresh or reconnect and inspect the current state of a run.
3. An accepted run is not permanently lost when the component executing it stops unexpectedly.
4. The system has defined recovery behavior for interrupted runs.
5. Completed runs and failures are represented clearly.

You do not need to build a production-ready distributed execution platform. Build a functional prototype that demonstrates your approach, and explain how you would evolve it for production.

## Demonstration scenario

Your submission should make it possible to demonstrate this flow:

1. A user starts an agent run.
2. The run begins executing multiple steps.
3. The browser is refreshed or disconnected.
4. The component executing the run is stopped while execution is in progress.
5. The application is started again.
6. The user can inspect the run, and the system can recover it according to the guarantees described in your design.

How an interrupted run recovers is your decision. It might resume from a checkpoint, repeat part of the computation, or restart completely. We care about why you selected that behavior and its consequences.

One simulated step creates a document in a fake external system. Consider what happens if that action succeeds but the executing process stops before recording success. You may address this in the prototype or in your design document.

## Deliverables

### Functional prototype

Implement the critical path of your architecture. It should run locally and demonstrate the scenario above. You may simplify supporting concerns if you document those simplifications.

### Architecture document and diagram

Replace the prompts in [`DESIGN.md`](./DESIGN.md) with a short description of:

- Your architecture and component boundaries
- The lifecycle and possible states of a run
- What is persisted, and when
- How interrupted runs are detected and recovered
- How the frontend obtains current and previous progress
- The guarantees the prototype provides
- Where work can be lost or executed more than once
- Important tradeoffs and production evolution

Include an architecture diagram in any readable format. Clearly distinguish implemented behavior from proposed production behavior.

### Running instructions

Document how to start the application, initiate a run, simulate an interruption, observe recovery, and run any tests you add.

## Getting started

Requirements: Node.js 20 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). A normal run takes approximately 15 seconds. Set `AGENT_STEP_DELAY_MS` to alter the work delay per step. Set `AGENT_STEP_TRANSITION_DELAY_MS` to alter the short pause between a completed step and the next one:

```bash
AGENT_STEP_DELAY_MS=5000 pnpm dev
```

Runs are accepted immediately and executed by a background worker. Refreshing the browser, closing the tab, or restarting the process no longer loses the run.

### Demonstrate recovery

1. Start the app with `pnpm dev` and submit a task.
2. While steps are still running, refresh the page. The same run, its event log, and live progress come back from the server.
3. Click **Simulate process crash** (development only) or stop the server with `Ctrl+C` while a run is in progress.
4. Start the app again with `pnpm dev`.
5. Refresh if needed. The run is claimed by the new worker, a `run.recovered` event is recorded, and execution resumes at the first incomplete step.

Persisted data lives in `.runtime/`: run records under `.runtime/runs/`, fake external documents in `.runtime/fake-external-actions.json`.

```bash
pnpm test        # recovery, checkpoint, and idempotency tests
pnpm typecheck
```

The crash endpoint is deliberately unavailable when `NODE_ENV=production`. It is local failure-injection tooling, not an application feature.

The starter architecture is described in [`docs/STARTER_ARCHITECTURE.md`](./docs/STARTER_ARCHITECTURE.md).

## Scope and expectations

We expect you to spend approximately **3–4 hours**. We evaluate prioritization and reasoning, not feature count.

You are not expected to implement:

- Kubernetes or deployment configuration
- CI/CD pipelines or cloud infrastructure
- Authentication or multi-tenancy
- A production-grade distributed scheduler
- Every possible concurrency or failure scenario
- Resumption of a model response from an exact token
- A highly polished frontend

You may add, remove, or replace libraries and infrastructure components. You may restructure the application. Hosted services are acceptable if the submission remains straightforward to review locally.

AI development tools are allowed and encouraged. You remain responsible for understanding and explaining the submitted design and implementation.

## Evaluation criteria

### Architecture and systems reasoning

- Clear responsibilities and component boundaries
- Appropriate decisions for reliable long-running work
- Accurate understanding of guarantees and limitations
- Coherence between the proposed architecture and prototype

### Failure and recovery behavior

- Accepted work can be discovered and recovered
- Interrupted and terminal states are represented coherently
- Partial execution and repeated work are considered
- The required failure scenario is reproducible

### Prototype quality

- The critical flow works
- Important state transitions are explicit
- The implementation is reasonably clear and maintainable
- Tests or observability support the most important claims

### Communication and judgment

- The architecture diagram is understandable
- Tradeoffs and alternatives are explained
- Scope is prioritized appropriately for the time limit
- Prototype shortcuts are distinguished from production decisions

## Submission

Create a private repository from this template and invite the GitHub users named in your interview email. Submit the repository at least the evening before your review call.
