import { getRun } from "@/lib/run-store";
import { ensureRunWorker } from "@/lib/run-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  await ensureRunWorker();
  const { runId } = await context.params;
  const run = await getRun(runId);

  if (!run) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }

  return Response.json(
    { run },
    { headers: { "Cache-Control": "no-store" } },
  );
}
