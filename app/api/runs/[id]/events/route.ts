import { waitForRunEvent } from "@/lib/run-bus";
import { getRun, isTerminalStatus } from "@/lib/store";
import type { AgentEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serialize(event: AgentEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}

function eventsAfter(events: AgentEvent[], lastEventId: string | null): AgentEvent[] {
  if (!lastEventId) {
    return events;
  }
  const index = events.findIndex((event) => event.id === lastEventId);
  return index === -1 ? events : events.slice(index + 1);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const existing = await getRun(id);
  if (!existing) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }

  const lastEventId = request.headers.get("last-event-id");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          controller.close();
        } catch {
          // The client already disconnected.
        }
      };

      const sendRaw = (chunk: string) => {
        if (closed || request.signal.aborted) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      sendRaw(": connected\n\n");

      void (async () => {
        let cursor = lastEventId;
        while (!closed && !request.signal.aborted) {
          const run = await getRun(id);
          if (!run) {
            close();
            return;
          }

          const nextEvents = eventsAfter(run.events, cursor);
          for (const event of nextEvents) {
            sendRaw(serialize(event));
            cursor = event.id;
          }

          if (isTerminalStatus(run.status) && nextEvents.length === 0) {
            close();
            return;
          }

          await Promise.race([
            waitForRunEvent(id, request.signal),
            new Promise<void>((resolve) => setTimeout(resolve, 750)),
          ]);
        }
        close();
      })().catch(() => {
        close();
      });

      request.signal.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
