import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

// Exercise the production build on a local ephemeral port, without external services.
const socket = createServer();
socket.listen(0, "127.0.0.1");
await once(socket, "listening");
const { port } = socket.address();
await new Promise((resolve) => socket.close(resolve));
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  env: { ...process.env, NODE_ENV: "production", AGENT_STEP_DELAY_MS: "1", AGENT_STEP_TRANSITION_DELAY_MS: "1" },
  stdio: "inherit",
});
const exited = once(server, "exit");
const request = (path, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
  ...options,
  signal: AbortSignal.timeout(10_000),
});

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(server.exitCode, null, "Production server exited during startup");
    try {
      const response = await request("/");
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Long-Running Agent Execution/);
      ready = true;
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(ready, "Production server did not become ready");
  for (const body of ["{}", '{"prompt":"  "}', "invalid json"]) {
    const response = await request("/api/runs", { method: "POST", body });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "A prompt is required." });
  }
  const response = await request("/api/runs", {
    method: "POST", body: JSON.stringify({ prompt: "Dependency upgrade smoke check" }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const events = (await response.text()).trim().split("\n\n").map((line) => JSON.parse(line.slice(6)));
  assert.equal(events[0].type, "run.started");
  assert.equal(events.at(-1).type, "run.completed");
  assert.equal(events.filter((event) => event.type === "step.completed").length, 5);
  const documents = await request("/api/fake-tools/documents");
  assert.equal(documents.status, 200);
  assert.equal((await documents.json()).documents.filter((doc) => doc.runId === events[0].runId).length, 1);
  const crash = await request("/api/debug/crash", { method: "POST" });
  assert.equal(crash.status, 404);
  assert.match((await crash.json()).error, /only available in development/);
  console.log("Production smoke checks passed");
} finally {
  server.kill("SIGTERM");
  await exited;
}
