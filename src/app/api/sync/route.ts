import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "@/lib/auth";
import { withClient } from "@/lib/db";
import {
  computeSyncSnapshot,
  getSessionUser,
  parseRequestedScopes,
} from "@/lib/realtime/sync-engine";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
} as const;

const SSE_POLL_INTERVAL_MS = 2000;
const SSE_HEARTBEAT_INTERVAL_MS = 15000;
const SSE_MAX_LIFETIME_MS = 55000;

export async function GET(req: NextRequest) {
  try {
    const actor = await getSessionUser();
    if (!actor) {
      return NextResponse.json(
        { error: "No autenticado" },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const sinceParam = req.nextUrl.searchParams.get("since");
    const requestedScopes = parseRequestedScopes(
      req.nextUrl.searchParams.get("scopes"),
      actor.role
    );

    const acceptHeader = req.headers.get("accept") || "";
    const wantsStream =
      acceptHeader.includes("text/event-stream") ||
      req.nextUrl.searchParams.get("stream") === "1";

    if (!wantsStream) {
      const snapshot = await withClient(async (client) => {
        const verifiedActor = await requireActiveSession(client, actor);
        return await computeSyncSnapshot(
          client,
          verifiedActor,
          sinceParam,
          requestedScopes
        );
      });
      return NextResponse.json(snapshot, {
        status: 200,
        headers: NO_STORE_HEADERS,
      });
    }

    const activeActor = await withClient((client) =>
      requireActiveSession(client, actor)
    );

    const encoder = new TextEncoder();
    let cleanupStream = () => {};

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        let pollTimer: ReturnType<typeof setTimeout> | null = null;
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
        let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
        let lastVersion: string | null = sinceParam?.trim() || null;

        const closeAll = () => {
          if (closed) return;
          closed = true;
          if (pollTimer) clearTimeout(pollTimer);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (lifetimeTimer) clearTimeout(lifetimeTimer);
          req.signal.removeEventListener("abort", closeAll);
          try {
            controller.close();
          } catch {
            // Stream may already be closed
          }
        };
        cleanupStream = closeAll;
        req.signal.addEventListener("abort", closeAll);

        const pushEvent = (eventName: string, payload: unknown) => {
          if (closed) return;
          const chunk = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        };

        const runCycle = async (emitUnchanged: boolean) => {
          if (closed) return;
          const snapshot = await withClient(async (client) => {
            const verifiedActor = await requireActiveSession(client, activeActor);
            return await computeSyncSnapshot(
              client,
              verifiedActor,
              lastVersion,
              requestedScopes
            );
          });
          if (closed) return;
          const versionChanged = lastVersion !== snapshot.version;
          lastVersion = snapshot.version;
          if (emitUnchanged || versionChanged || snapshot.changedScopes.length > 0) {
            pushEvent("sync", snapshot);
          }
        };

        try {
          await runCycle(true);
        } catch {
          closeAll();
          return;
        }

        const schedulePoll = () => {
          if (closed) return;
          pollTimer = setTimeout(async () => {
            if (closed) return;
            try {
              await runCycle(false);
            } catch {
              // Emit clean reconnect signal on transient DB error and let client backoff
              closeAll();
              return;
            }
            schedulePoll();
          }, SSE_POLL_INTERVAL_MS);
        };
        schedulePoll();

        heartbeatTimer = setInterval(() => {
          if (closed) return;
          try {
            pushEvent("heartbeat", { ts: Date.now(), version: lastVersion });
          } catch {
            closeAll();
          }
        }, SSE_HEARTBEAT_INTERVAL_MS);

        lifetimeTimer = setTimeout(() => {
          if (closed) return;
          try {
            pushEvent("reconnect", { version: lastVersion });
          } catch {
            // ignore write after close
          }
          closeAll();
        }, SSE_MAX_LIFETIME_MS);
      },
      cancel() {
        cleanupStream();
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const status =
      err instanceof AuthenticationError
        ? 401
        : err instanceof AuthorizationError
        ? 403
        : err instanceof ValidationError
        ? 400
        : 500;
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Error verificando sincronización en vivo",
      },
      { status, headers: NO_STORE_HEADERS }
    );
  }
}
