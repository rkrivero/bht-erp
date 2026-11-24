import { describe, expect, it } from "vitest";
import type { PartnerCatalogItem } from "@/features/partners/components/types";
import { summarizeInventory } from "@/features/partners/useInventoryFlow";

function product(
  overrides: Partial<PartnerCatalogItem> & Pick<PartnerCatalogItem, "product_id">
): PartnerCatalogItem {
  const { product_id: productId, ...rest } = overrides;
  return {
    product_id: productId,
    sku: `SKU-${productId}`,
    name: `Producto ${productId}`,
    unit_of_measure: "UND",
    fulfillment_mode: "STOCKED",
    stock_on_hand: 10,
    list_sale_price_pen: 20,
    min_sale_price_pen: 15,
    ref_cost_pen: 10,
    ...rest,
  };
}

describe("summarizeInventory", () => {
  it("separates exhausted products from low stock and counts data risks", () => {
    const catalog = [
      product({ product_id: 1, stock_on_hand: 0 }),
      product({ product_id: 2, stock_on_hand: 5 }),
      product({ product_id: 3, ref_cost_pen: null }),
      product({ product_id: 4, ref_cost_pen: 12, min_sale_price_pen: 12 }),
      product({
        product_id: 5,
        fulfillment_mode: "ON_DEMAND",
        stock_on_hand: 0,
      }),
    ];

    expect(summarizeInventory(catalog)).toEqual({
      outOfStock: 1,
      lowStock: 1,
      noCost: 1,
      marginRisk: 1,
    });
  });
});
