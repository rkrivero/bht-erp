import { describe, expect, it } from "vitest";
import { hashMutationRequest } from "../src/lib/idempotency";

describe("offline mutation idempotency", () => {
  it("produces the same hash regardless of object key order", () => {
    expect(hashMutationRequest({ action: "create", nested: { b: 2, a: 1 } })).toBe(
      hashMutationRequest({ nested: { a: 1, b: 2 }, action: "create" })
    );
  });

  it("distinguishes requests whose business content changed", () => {
    expect(hashMutationRequest({ amountPen: 10 })).not.toBe(
      hashMutationRequest({ amountPen: 11 })
    );
  });
});
