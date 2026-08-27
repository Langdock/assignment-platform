import { createRun, listRuns } from "@/lib/run-store";
import { ensureRunWorker } from "@/lib/run-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  await ensureRunWorker();
  return Response.json(
    { runs: await listRuns() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return Response.json({ error: "A prompt is required." }, { status: 400 });
  }

  // Persist acceptance before replying. From this point the run is discoverable
  // and restart recovery can execute it even if this request is disconnected.
  const run = await createRun(prompt);
  await ensureRunWorker();

  return Response.json({ run }, {
    status: 202,
    headers: {
      "Cache-Control": "no-store",
      Location: `/api/runs/${run.id}`,
    },
  });
}
