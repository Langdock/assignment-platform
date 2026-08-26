import { createRun, listRuns } from "@/lib/store";
import { notifyWorker } from "@/lib/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { prompt?: unknown } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

  if (!prompt) {
    return Response.json({ error: "A prompt is required." }, { status: 400 });
  }

  const run = await createRun(prompt);
  notifyWorker();

  return Response.json(
    {
      run: {
        id: run.id,
        prompt: run.prompt,
        status: run.status,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        recoveryCount: run.recoveryCount,
        currentStep: null,
      },
    },
    { status: 202 },
  );
}

export async function GET(): Promise<Response> {
  return Response.json({ runs: await listRuns() });
}
