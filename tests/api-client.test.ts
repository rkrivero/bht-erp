import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, fetchJson, hasTopLevelKeys } from "../src/lib/api-client";

interface ExampleResponse {
  items: unknown[];
}

describe("fetchJson", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves AbortSignal and returns a validated response", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    const result = await fetchJson<ExampleResponse>(
      "/api/example",
      { signal: controller.signal },
      hasTopLevelKeys<ExampleResponse>("items")
    );
    expect(result.items).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/example",
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("rejects non-JSON and consistently maps API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("gateway error", {
        status: 502,
        headers: { "content-type": "text/plain" },
      })
    );
    await expect(fetchJson("/api/example")).rejects.toMatchObject({
      name: "ApiClientError",
      status: 502,
    });

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "Conflicto de edición",
          code: "STALE_WRITE",
          entityRef: "order:42",
          errorId: "trace-id",
        }),
        { status: 409, headers: { "content-type": "application/json" } }
      )
    );
    await expect(fetchJson("/api/example")).rejects.toMatchObject({
      message: "Conflicto de edición",
      status: 409,
      code: "STALE_WRITE",
      entityRef: "order:42",
      errorId: "trace-id",
    });
  });

  it("does not allow an invalid DTO to replace valid UI state", async () => {
    let state: ExampleResponse = { items: ["válido"] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ wrong: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    try {
      state = await fetchJson<ExampleResponse>(
        "/api/example",
        undefined,
        hasTopLevelKeys<ExampleResponse>("items")
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
    }
    expect(state).toEqual({ items: ["válido"] });
  });
});
