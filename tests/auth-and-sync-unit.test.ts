import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as getErpSession } from "../src/app/api/erp/session/route";
import {
  signTestSessionToken,
  verifyTestSessionToken,
} from "../src/lib/auth/test-session";
import * as dbMod from "../src/lib/db";
import { normalizeDatabaseUrl } from "../src/lib/db";
import { resolveHttpError } from "../src/lib/http-errors";
import { assertRole, projectOrderForRole } from "../src/lib/rbac";
import type { RawOrderWithLines, SessionUser } from "../src/lib/types";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ValidationError,
} from "../src/lib/types";

describe("Server Error, Transport & Test-session Hardening", () => {
  const prevNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (prevNodeEnv !== undefined) {
      vi.stubEnv("NODE_ENV", prevNodeEnv);
    }
    vi.restoreAllMocks();
  });

  it("signs test fixtures, rejects tampering, and rejects expiration", () => {
    const baseUser: SessionUser = {
      userId: 10,
      username: "socio_test",
      fullName: "Socio Test",
      role: "PARTNER_ADMIN",
      defaultCashAccountId: 1,
    };

    const validToken = signTestSessionToken(baseUser, 600);
    const verified = verifyTestSessionToken(validToken);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(10);
    expect(verifyTestSessionToken(`${validToken}tampered`)).toBeNull();

    const expiredToken = signTestSessionToken({
      ...baseUser,
      exp: Math.floor(Date.now() / 1000) - 5,
    });
    expect(verifyTestSessionToken(expiredToken)).toBeNull();
  });

  it("does not make test-session helpers usable in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      signTestSessionToken({
        userId: 1,
        username: "fixture",
        fullName: "Fixture",
        role: "PARTNER_ADMIN",
        defaultCashAccountId: null,
      })
    ).toThrow(/unavailable outside the test runtime/);
    expect(() => verifyTestSessionToken("fixture.token")).toThrow(
      /unavailable outside the test runtime/
    );
  });

  it("sanitizes unexpected errors and emits a traceable errorId", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = resolveHttpError(
      new Error("postgres password is secret-123"),
      "No se pudo completar la operación",
      "unit-test"
    );
    expect(result.status).toBe(500);
    expect(result.error).toBe("No se pudo completar la operación");
    expect(result.error).not.toContain("secret-123");
    expect(result.errorId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(result.errorId!),
      expect.any(Error)
    );
  });

  it("preserves known domain status codes and maps closed-period PG 23514 to 409 Conflict", () => {
    expect(resolveHttpError(new ValidationError("Dato inválido"), "fallback")).toEqual({
      status: 400,
      error: "Dato inválido",
    });
    expect(
      resolveHttpError(new AuthenticationError("Sesión no iniciada"), "fallback")
    ).toEqual({
      status: 401,
      error: "Sesión no iniciada",
    });
    expect(resolveHttpError(new AuthorizationError("Sin permiso"), "fallback")).toEqual(
      {
        status: 403,
        error: "Sin permiso",
      }
    );
    expect(resolveHttpError(new ConflictError("Conflicto"), "fallback")).toEqual(
      expect.objectContaining({
        status: 409,
        error: "Conflicto",
      })
    );

    const closedPeriodPgErr = Object.assign(
      new Error(
        "Periodo cerrado (2026-11-18): no se permiten modificaciones sin corrección auditada de cierre diario"
      ),
      { code: "23514" }
    );
    expect(resolveHttpError(closedPeriodPgErr, "fallback")).toEqual({
      status: 409,
      error:
        "Periodo cerrado (2026-11-18): no se permiten modificaciones sin corrección auditada de cierre diario",
      code: "CLOSED_PERIOD",
    });
  });

  it("separates 401 AuthenticationError vs 403 AuthorizationError in assertRole and /api/erp/session", async () => {
    expect(() => assertRole(null, ["PARTNER_ADMIN"])).toThrow(AuthenticationError);

    const sellerActor: SessionUser = {
      userId: 3,
      username: "vendedor1",
      fullName: "Vendedor",
      role: "EXTERNAL_SELLER",
      defaultCashAccountId: 1,
    };
    expect(() => assertRole(sellerActor, ["PARTNER_ADMIN"])).toThrow(
      AuthorizationError
    );

    // proyectOrderForRole includes credit_limit_exceeded_flag for seller and partner
    const sampleOrder: RawOrderWithLines = {
      order_id: 1,
      order_code: "SO-20261122-0001",
      order_date: "2026-11-22",
      customer_name: "CLIENTE TEST",
      operational_status: "PENDING_PARTNER_APPROVAL",
      payment_mode: "CREDIT",
      total_pen: 2500,
      paid_pen: 0,
      balance_due_pen: 2500,
      is_settled: false,
      credit_limit_exceeded_flag: true,
      created_by_name: "Vendedor",
      picked_by_name: null,
      delivered_by_name: null,
      lines: [],
    };
    expect(
      projectOrderForRole(sampleOrder, "EXTERNAL_SELLER").credit_limit_exceeded_flag
    ).toBe(true);
    expect(
      projectOrderForRole(sampleOrder, "PARTNER_ADMIN").credit_limit_exceeded_flag
    ).toBe(true);

    // /api/erp/session returns 401 when no session exists
    let mockNeonSessionResult: { data: unknown; error: unknown } = {
      data: null,
      error: null,
    };
    vi.doMock("../src/lib/auth/server", () => ({
      auth: {
        getSession: async () => mockNeonSessionResult,
      },
    }));

    const unauthRes = await getErpSession(
      new NextRequest("http://localhost:3000/api/erp/session")
    );
    expect(unauthRes.status).toBe(401);

    // /api/erp/session returns 403 when Neon Auth session exists but email is not enabled in erp.app_users
    mockNeonSessionResult = {
      data: {
        user: {
          id: "neon-user-unprovisioned",
          email: "no-autorizado@bht.test",
          emailVerified: true,
        },
      },
      error: null,
    };
    vi.spyOn(dbMod, "withClient").mockImplementationOnce(async (fn) => {
      const fakeClient = {
        query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
      };
      return fn(fakeClient as never);
    });

    const forbiddenRes = await getErpSession(
      new NextRequest("http://localhost:3000/api/erp/session")
    );
    expect(forbiddenRes.status).toBe(403);
    const forbiddenBody = await forbiddenRes.json();
    expect(forbiddenBody.error).toContain("no está habilitado");
    vi.doUnmock("../src/lib/auth/server");
  });

  it("upgrades Neon connections to verify-full", () => {
    expect(
      normalizeDatabaseUrl(
        "postgresql://user:pass@ep-example.us-east-2.aws.neon.tech/db?sslmode=require"
      )
    ).toBe(
      "postgresql://user:pass@ep-example.us-east-2.aws.neon.tech/db?sslmode=verify-full"
    );
  });

  it("leaves local and malformed database URLs untouched", () => {
    const local = "postgresql://postgres:postgres@127.0.0.1:5432/bht?sslmode=disable";
    expect(normalizeDatabaseUrl(local)).toBe(local);
    expect(normalizeDatabaseUrl("not-a-url")).toBe("not-a-url");
  });
});

// Minimal React hook & browser transport harness for real src/lib/realtime/useLiveSync.ts
describe("useLiveSync Hook Unit Tests (default efficient transport & opt-in SSE)", () => {
  it("uses efficient transport by default (no EventSource, 45s focus cooldown, BroadcastChannel invalidation)", async () => {
    vi.resetModules();

    const stateValues: unknown[] = [];
    const stateSetters: Array<(v: unknown) => void> = [];
    let stateIdx = 0;
    const refSlots: Array<{ current: unknown }> = [];
    let refIdx = 0;
    const cleanups: Array<() => void> = [];
    let pendingEffects: Array<() => void | (() => void)> = [];

    vi.doMock("react", () => ({
      useState: (init: unknown) => {
        const idx = stateIdx++;
        if (!(idx in stateValues)) {
          stateValues[idx] =
            typeof init === "function" ? (init as () => unknown)() : init;
          stateSetters[idx] = (next: unknown) => {
            stateValues[idx] =
              typeof next === "function"
                ? (next as (prev: unknown) => unknown)(stateValues[idx])
                : next;
          };
        }
        return [stateValues[idx], stateSetters[idx]];
      },
      useRef: (init: unknown) => {
        const idx = refIdx++;
        if (!refSlots[idx]) refSlots[idx] = { current: init };
        return refSlots[idx];
      },
      useCallback: (fn: unknown) => fn,
      useEffect: (fn: () => void | (() => void)) => {
        pendingEffects.push(fn);
      },
    }));

    type Listener = (ev?: unknown) => void;
    const winListeners = new Map<string, Set<Listener>>();
    const docListeners = new Map<string, Set<Listener>>();
    const fakeWindow = {
      addEventListener: (t: string, l: Listener) => {
        if (!winListeners.has(t)) winListeners.set(t, new Set());
        winListeners.get(t)!.add(l);
      },
      removeEventListener: (t: string, l: Listener) => {
        winListeners.get(t)?.delete(l);
      },
      dispatchEvent: () => true,
      emit: (t: string) => {
        winListeners.get(t)?.forEach((l) => l());
      },
    };
    const fakeDocument = {
      visibilityState: "visible",
      addEventListener: (t: string, l: Listener) => {
        if (!docListeners.has(t)) docListeners.set(t, new Set());
        docListeners.get(t)!.add(l);
      },
      removeEventListener: (t: string, l: Listener) => {
        docListeners.get(t)?.delete(l);
      },
    };

    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      constructor() {
        FakeEventSource.instances.push(this);
      }
      close() {}
    }

    class FakeBroadcastChannel {
      static channels = new Map<string, Set<FakeBroadcastChannel>>();
      name: string;
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      constructor(name: string) {
        this.name = name;
        if (!FakeBroadcastChannel.channels.has(name)) {
          FakeBroadcastChannel.channels.set(name, new Set());
        }
        FakeBroadcastChannel.channels.get(name)!.add(this);
      }
      postMessage(data: unknown) {
        FakeBroadcastChannel.channels.get(this.name)?.forEach((ch) => {
          if (ch !== this && ch.onmessage) ch.onmessage({ data });
        });
      }
      close() {
        FakeBroadcastChannel.channels.get(this.name)?.delete(this);
      }
    }

    const fetchedUrls: string[] = [];
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchedUrls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            version: "v1.p.10",
            allowedScopes: ["orders", "inventory"],
            changedScopes: [],
            serverTime: new Date().toISOString(),
          }),
        };
      })
    );

    try {
      const mod = await import("../src/lib/realtime/useLiveSync");
      expect(mod.DEFAULT_POLL_INTERVAL_MS).toBe(60_000);
      expect(mod.RESUME_COOLDOWN_MS).toBe(45_000);

      const invalidatedScopes: string[][] = [];
      const unsub = mod.registerSyncScopeInvalidator((scopes) => {
        invalidatedScopes.push(scopes);
      });

      mod.useLiveSync({
        scopes: ["orders", "inventory"],
        enabled: true,
        onRemoteChange: async () => {},
      });

      for (const eff of pendingEffects) {
        const c = eff();
        if (typeof c === "function") cleanups.push(c);
      }
      pendingEffects = [];

      await new Promise((r) => setTimeout(r, 30));
      // Default transport is "efficient": 0 EventSource connections, 1 initial JSON snapshot
      expect(FakeEventSource.instances.length).toBe(0);
      expect(fetchedUrls.length).toBe(1);

      // Immediate focus within 45s cooldown must NOT trigger another fetch
      fakeWindow.emit("focus");
      await new Promise((r) => setTimeout(r, 150));
      expect(fetchedUrls.length).toBe(1);

      // Local BroadcastChannel notification invalidates registered scope listeners and fetches catch-up
      mod.notifyLocalSync(["orders"]);
      await new Promise((r) => setTimeout(r, 30));
      expect(invalidatedScopes).toContainEqual(["orders"]);
      expect(fetchedUrls.length).toBe(2);
      unsub();
    } finally {
      for (const fn of cleanups) fn();
      vi.unstubAllGlobals();
      vi.doUnmock("react");
      vi.resetModules();
    }
  });

  it("keeps lastCheckedMs updated on heartbeat, preserves versionRef on failed onRemoteChange, and handles BroadcastChannel mutations in opt-in SSE mode", async () => {
    vi.resetModules();

    const stateValues: unknown[] = [];
    const stateSetters: Array<(v: unknown) => void> = [];
    let stateIdx = 0;
    const refSlots: Array<{ current: unknown }> = [];
    let refIdx = 0;
    const cleanups: Array<() => void> = [];
    let pendingEffects: Array<() => void | (() => void)> = [];

    vi.doMock("react", () => ({
      useState: (init: unknown) => {
        const idx = stateIdx++;
        if (stateSlotsNotInitialized(idx)) {
          stateValues[idx] =
            typeof init === "function" ? (init as () => unknown)() : init;
          stateSetters[idx] = (next: unknown) => {
            stateValues[idx] =
              typeof next === "function"
                ? (next as (prev: unknown) => unknown)(stateValues[idx])
                : next;
          };
        }
        return [stateValues[idx], stateSetters[idx]];
      },
      useRef: (init: unknown) => {
        const idx = refIdx++;
        if (!refSlots[idx]) refSlots[idx] = { current: init };
        return refSlots[idx];
      },
      useCallback: (fn: unknown) => fn,
      useEffect: (fn: () => void | (() => void)) => {
        pendingEffects.push(fn);
      },
    }));

    function stateSlotsNotInitialized(idx: number) {
      return !(idx in stateValues);
    }

    type Listener = (ev?: unknown) => void;
    const winListeners = new Map<string, Set<Listener>>();
    const docListeners = new Map<string, Set<Listener>>();
    const fakeWindow = {
      addEventListener: (t: string, l: Listener) => {
        if (!winListeners.has(t)) winListeners.set(t, new Set());
        winListeners.get(t)!.add(l);
      },
      removeEventListener: (t: string, l: Listener) => {
        winListeners.get(t)?.delete(l);
      },
      dispatchEvent: () => true,
      emit: (t: string) => {
        winListeners.get(t)?.forEach((l) => l());
      },
    };
    const fakeDocument = {
      visibilityState: "visible",
      addEventListener: (t: string, l: Listener) => {
        if (!docListeners.has(t)) docListeners.set(t, new Set());
        docListeners.get(t)!.add(l);
      },
      removeEventListener: (t: string, l: Listener) => {
        docListeners.get(t)?.delete(l);
      },
    };

    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      url: string;
      listeners = new Map<string, Set<Listener>>();
      closed = false;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
      }
      addEventListener(type: string, cb: Listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(cb);
      }
      emit(type: string, data?: unknown) {
        this.listeners.get(type)?.forEach((cb) => cb({ data }));
      }
      close() {
        this.closed = true;
      }
    }

    class FakeBroadcastChannel {
      static channels = new Map<string, Set<FakeBroadcastChannel>>();
      name: string;
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      constructor(name: string) {
        this.name = name;
        if (!FakeBroadcastChannel.channels.has(name)) {
          FakeBroadcastChannel.channels.set(name, new Set());
        }
        FakeBroadcastChannel.channels.get(name)!.add(this);
      }
      postMessage(data: unknown) {
        FakeBroadcastChannel.channels.get(this.name)?.forEach((ch) => {
          if (ch !== this && ch.onmessage) ch.onmessage({ data });
        });
      }
      close() {
        FakeBroadcastChannel.channels.get(this.name)?.delete(this);
      }
    }

    const fetchedUrls: string[] = [];
    let fetchResponder: (url: string) => unknown = () => ({
      version: "v1.p.10",
      allowedScopes: ["orders", "inventory"],
      changedScopes: [],
      serverTime: new Date().toISOString(),
    });

    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchedUrls.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => fetchResponder(url),
        };
      })
    );

    try {
      const mod = await import("../src/lib/realtime/useLiveSync");

      let shouldFailRemoteChange = true;
      const deliveredCalls: string[][] = [];
      const hookRes = mod.useLiveSync({
        scopes: ["orders", "inventory"],
        enabled: true,
        transport: "sse",
        onRemoteChange: async (scopes) => {
          deliveredCalls.push(scopes);
          if (shouldFailRemoteChange) {
            throw new Error("Transient UI reload failure");
          }
        },
      });

      for (const eff of pendingEffects) {
        const c = eff();
        if (typeof c === "function") cleanups.push(c);
      }
      pendingEffects = [];

      expect(FakeEventSource.instances.length).toBe(1);
      const es = FakeEventSource.instances[0];

      // 1. Emit initial baseline sync event (changedScopes = [])
      es.emit(
        "sync",
        JSON.stringify({
          version: "v1.p.1",
          allowedScopes: ["orders", "inventory"],
          changedScopes: [],
          serverTime: new Date().toISOString(),
        })
      );

      // 2. Emit heartbeat -> updates lastCheckedMs so immediate focus event won't fire redundant HTTP snapshot
      es.emit("heartbeat", "{}");
      fakeWindow.emit("focus");
      await new Promise((r) => setTimeout(r, 150));
      expect(fetchedUrls.length).toBe(0);

      // 3. Emit sync with remote change v1.p.2 while onRemoteChange throws -> versionRef must STAY at v1.p.1
      es.emit(
        "sync",
        JSON.stringify({
          version: "v1.p.2",
          allowedScopes: ["orders", "inventory"],
          changedScopes: ["orders"],
          serverTime: new Date().toISOString(),
        })
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(deliveredCalls).toEqual([["orders"]]);

      // 4. BroadcastChannel mutation from sibling tab triggers catch-up fetch with since=v1.p.1 (NOT v1.p.2!)
      shouldFailRemoteChange = false;
      fetchResponder = () => ({
        version: "v1.p.3",
        allowedScopes: ["orders", "inventory"],
        changedScopes: ["orders"],
        serverTime: new Date().toISOString(),
      });
      mod.notifyLocalSync(["orders"]);
      await new Promise((r) => setTimeout(r, 30));

      expect(fetchedUrls.length).toBe(1);
      expect(fetchedUrls[0]).toContain("since=v1.p.1");
      expect(deliveredCalls).toEqual([["orders"], ["orders"]]);

      // 5. After successful delivery, versionRef advanced to v1.p.3
      await hookRes.triggerSync();
      expect(fetchedUrls[1]).toContain("since=v1.p.3");
    } finally {
      for (const fn of cleanups) fn();
      vi.unstubAllGlobals();
      vi.doUnmock("react");
      vi.resetModules();
    }
  });
});
