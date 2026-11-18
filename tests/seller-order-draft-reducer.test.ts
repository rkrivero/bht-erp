import { describe, expect, it } from "vitest";
import {
  initialSellerOrderDraft,
  sellerOrderDraftReducer,
} from "@/features/seller/order-draft-reducer";

describe("seller order draft reducer", () => {
  it("applies field transitions without discarding the rest of the draft", () => {
    const state = sellerOrderDraftReducer(initialSellerOrderDraft, {
      type: "update",
      update: (current) => ({
        creditDays: current.creditDays + 7,
        orderStep: "payment",
      }),
    });

    expect(state).toMatchObject({
      paymentMode: "CASH",
      creditDays: 14,
      orderStep: "payment",
    });
  });

  it("hydrates a saved offline draft and resets it explicitly", () => {
    const hydrated = sellerOrderDraftReducer(initialSellerOrderDraft, {
      type: "hydrate",
      draft: { customerNameRaw: "Ferretería Sol", notes: "Entregar por la tarde" },
    });

    expect(hydrated.customerNameRaw).toBe("Ferretería Sol");
    expect(hydrated.notes).toBe("Entregar por la tarde");
    expect(sellerOrderDraftReducer(hydrated, { type: "reset" })).toEqual(
      initialSellerOrderDraft
    );
  });
});
