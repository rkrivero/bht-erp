import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import {
  checkAuthRateLimit,
  clearAuthFailures,
  computeSessionVersion,
  hashPin,
  hashPinLegacySha256,
  recordAuthFailure,
  resetAuthRateLimitStore,
  signSessionToken,
  verifyPin,
  verifySessionToken,
  validatePersonalPassword,
} from "../src/lib/auth";
import type { SessionUser } from "../src/lib/types";

describe("Auth Hardening (scrypt PINs, Session TTL, Rate Limiter, Production Secret)", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSecret = process.env.BHT_SESSION_SECRET;

  beforeEach(() => {
    resetAuthRateLimitStore();
  });

  afterEach(() => {
    resetAuthRateLimitStore();
    vi.unstubAllEnvs();
    if (prevSecret === undefined) {
      delete process.env.BHT_SESSION_SECRET;
    } else {
      process.env.BHT_SESSION_SECRET = prevSecret;
    }
    if (prevNodeEnv !== undefined) {
      vi.stubEnv("NODE_ENV", prevNodeEnv);
    }
  });

  it("hashes PINs with random scrypt salts while staying compatible with legacy SHA-256 hashes", () => {
    const h1 = hashPin("1234");
    const h2 = hashPin("1234");
    expect(h1).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect(h2).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect(h1).not.toBe(h2);
    expect(verifyPin("1234", h1)).toBe(true);
    expect(verifyPin("9999", h1)).toBe(false);

    const legacy = hashPinLegacySha256("5678");
    expect(verifyPin("5678", legacy)).toBe(true);
    expect(verifyPin("5679", legacy)).toBe(false);
    expect(verifyPin("1234", "invalid-format")).toBe(false);
    expect(verifyPin("1234", "")).toBe(false);
  });

  it("requires a usable personal password with a letter and number", () => {
    expect(validatePersonalPassword("corta1")).toMatch(/10/);
    expect(validatePersonalPassword("solamentetexto")).toMatch(/letra y un número/);
    expect(validatePersonalPassword("12345678901")).toMatch(/letra y un número/);
    expect(validatePersonalPassword("Horizonte2026")).toBeNull();
  });

  it("rejects expired session tokens and invalidates sessionVersion when PIN or role changes", () => {
    const baseUser: SessionUser = {
      userId: 10,
      username: "socio_test",
      fullName: "Socio Test",
      role: "PARTNER_ADMIN",
      defaultCashAccountId: 1,
      sessionVersion: computeSessionVersion(hashPin("1111"), "PARTNER_ADMIN"),
    };

    const validToken = signSessionToken(baseUser, 600);
    const verified = verifySessionToken(validToken);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(10);
    expect(verified?.sessionVersion).toBe(baseUser.sessionVersion);

    // Already-expired token (exp in past) must be rejected
    const expiredToken = signSessionToken({
      ...baseUser,
      exp: Math.floor(Date.now() / 1000) - 5,
    });
    expect(verifySessionToken(expiredToken)).toBeNull();

    // Tampered payload rejected
    const [, sig] = validToken.split(".");
    const fakePayload = Buffer.from(
      JSON.stringify({ ...baseUser, role: "PARTNER_MANAGER", exp: 9999999999 }),
      "utf8"
    ).toString("base64url");
    expect(verifySessionToken(`${fakePayload}.${sig}`)).toBeNull();

    // Session version changes when PIN hash or role changes
    const svPin1 = computeSessionVersion("hashA", "EXTERNAL_SELLER");
    const svPin2 = computeSessionVersion("hashB", "EXTERNAL_SELLER");
    const svRole = computeSessionVersion("hashA", "PARTNER_ADMIN");
    expect(svPin1).not.toBe(svPin2);
    expect(svPin1).not.toBe(svRole);
  });

  it("requires >=16 char BHT_SESSION_SECRET in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.BHT_SESSION_SECRET;

    const user: SessionUser = {
      userId: 1,
      username: "admin",
      fullName: "Admin",
      role: "PARTNER_ADMIN",
      defaultCashAccountId: 1,
    };

    expect(() => signSessionToken(user)).toThrow(
      /BHT_SESSION_SECRET environment variable is required in production/
    );

    process.env.BHT_SESSION_SECRET = "too-short";
    expect(() => signSessionToken(user)).toThrow(/at least 16 characters/);

    process.env.BHT_SESSION_SECRET = crypto.randomBytes(24).toString("hex");
    const tok = signSessionToken(user);
    expect(verifySessionToken(tok)?.username).toBe("admin");
  });

  it("enforces sliding-window per-user+IP and per-IP brute-force rate limits and resets after window/clear", () => {
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 8; i++) {
      expect(checkAuthRateLimit("10.0.0.5", "renzo", t0 + i * 1000).allowed).toBe(true);
      recordAuthFailure("10.0.0.5", "renzo", t0 + i * 1000);
    }
    const blockedUser = checkAuthRateLimit("10.0.0.5", "renzo", t0 + 10_000);
    expect(blockedUser.allowed).toBe(false);
    expect(blockedUser.retryAfterSec).toBeGreaterThan(0);

    // Different username from same IP stays allowed until IP cap (25)
    expect(checkAuthRateLimit("10.0.0.5", "almacen", t0 + 10_000).allowed).toBe(true);

    // Clear per-user lock works
    clearAuthFailures("10.0.0.5", "renzo");
    expect(checkAuthRateLimit("10.0.0.5", "renzo", t0 + 11_000).allowed).toBe(true);

    // Per-IP cap across 25 failures blocks all usernames on that IP
    for (let i = 0; i < 18; i++) {
      recordAuthFailure("10.0.0.5", `user_${i}`, t0 + 20_000 + i * 100);
    }
    const blockedIp = checkAuthRateLimit("10.0.0.5", "other_user", t0 + 25_000);
    expect(blockedIp.allowed).toBe(false);

    // After 15 minutes window passes, entries prune cleanly
    expect(
      checkAuthRateLimit("10.0.0.5", "other_user", t0 + 16 * 60 * 1000).allowed
    ).toBe(true);
  });
});

// Minimal React hook & browser transport harness for real src/lib/realtime/useLiveSync.ts
describe("useLiveSync Hook Unit Tests (heartbeat, failed refresh retry, BroadcastChannel)", () => {
  it("keeps lastCheckedMs updated on heartbeat, preserves versionRef on failed onRemoteChange, and handles BroadcastChannel mutations", async () => {
    vi.resetModules();

    // Minimal React hook runtime for single-component mount in Node
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
          stateValues[idx] = typeof init === "function" ? (init as () => unknown)() : init;
          stateSetters[idx] = (next: unknown) => {
            stateValues[idx] =
              typeof next === "function" ? (next as (prev: unknown) => unknown)(stateValues[idx]) : next;
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
        onRemoteChange: async (scopes) => {
          deliveredCalls.push(scopes);
          if (shouldFailRemoteChange) {
            throw new Error("Transient UI reload failure");
          }
        },
      });

      // Run mounted effects cleanly
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
