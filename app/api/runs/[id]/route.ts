import { getRun } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const run = await getRun(id);
  if (!run) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }
  return Response.json({ run });
}
