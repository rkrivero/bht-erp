import { describe, expect, it } from "vitest";
import {
  initialSellerOrderDraft,
  sellerOrderDraftReducer,
} from "@/features/seller/order-draft-reducer";
import { buildSellerOrderPayload } from "@/features/seller/seller-order-helpers";

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

  it("sends explicit globalDiscountPen=0 when editing an existing order and omits it on create", () => {
    const baseParams = {
      editingOrderId: null as number | null,
      editReasonCode: "QTY_ADJUSTMENT",
      editReasonLabel: "Ajuste",
      editReasonNote: "",
      selectedCustomer: null,
      customerNameRaw: "CLIENTE TEST",
      paymentMode: "CASH" as const,
      paymentAccountId: null,
      requiresPartnerApproval: false,
      collectOnDelivery: false,
      creditDays: 7,
      customPromiseDate: "",
      parsedInitialPaid: 0,
      parsedGlobalDiscountPen: 0,
      notes: "",
      cart: [
        {
          product: {
            product_id: 1,
            sku: "SKU-1",
            name: "Producto 1",
            unit_of_measure: "NIU",
            list_sale_price_pen: 20,
            min_sale_price_pen: 18,
            stock_on_hand: 10,
            fulfillment_mode: "STOCKED" as const,
          },
          quantity: 1,
          quantityInput: "1",
          unitPricePen: 20,
          unitPriceInput: "20",
        },
      ],
    };

    const createPayload = buildSellerOrderPayload(baseParams);
    expect(createPayload.globalDiscountPen).toBeUndefined();

    const editPayload = buildSellerOrderPayload({
      ...baseParams,
      editingOrderId: 42,
    });
    expect(editPayload.globalDiscountPen).toBe(0);
  });
});
