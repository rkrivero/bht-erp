import type {
  SellerCancelledDraftPayload,
  SellerCartLine,
  SellerCatalogItemDto,
  SellerCustomerDto,
  SellerOrderDto,
  SellerPaymentMode,
  SellerQuoteCreatePayload,
  SellerQuoteDto,
  SellerQuoteUpdatePayload,
} from "@/features/seller/types";
import {
  isFractionalUom,
  normalizeOrderQuantity,
} from "@/features/seller/seller-utils";

export function buildCancelledDraftPayload(params: {
  selectedCustomer: SellerCustomerDto | null;
  customerNameRaw: string;
  paymentMode: SellerPaymentMode;
  cartTotalPen: number;
  cart: SellerCartLine[];
  reasonCode: string;
  reasonLabel: string;
  cancelCustomNote: string;
  notes: string;
}): SellerCancelledDraftPayload {
  return {
    action: "log_cancelled_draft",
    customerPartyId: params.selectedCustomer?.party_id ?? null,
    customerName: params.customerNameRaw,
    paymentMode: params.paymentMode,
    estimatedTotalPen: Number(params.cartTotalPen.toFixed(2)),
    itemCount: params.cart.length,
    items: params.cart.map((c) => ({
      productId: c.product.product_id,
      sku: c.product.sku,
      name: c.product.name,
      quantity: c.quantity,
      unitPricePen: c.unitPricePen,
    })),
    reasonCode: params.reasonCode,
    reasonLabel: params.reasonLabel,
    notes: params.cancelCustomNote.trim() || params.notes.trim() || null,
  };
}

export function buildQuoteSubmitPayload(params: {
  editingQuoteId: number | null;
  selectedCustomer: SellerCustomerDto | null;
  customerNameRaw: string;
  parsedGlobalDiscountPen: number;
  notes: string;
  quoteEditReason: string;
  cart: SellerCartLine[];
}): SellerQuoteCreatePayload | SellerQuoteUpdatePayload {
  const lines = params.cart.map((c) => {
    const fractional = isFractionalUom(c.product.unit_of_measure);
    return {
      productId: c.product.product_id,
      rawDescription: c.product.name,
      quantity: normalizeOrderQuantity(c.quantity, fractional),
      unitPricePen: Number(c.unitPricePen.toFixed(4)),
    };
  });
  const base = {
    customerPartyId: params.selectedCustomer ? params.selectedCustomer.party_id : null,
    customerNameRaw: params.customerNameRaw.trim() || params.selectedCustomer?.name,
    globalDiscountPen: params.parsedGlobalDiscountPen,
    notes: params.notes.trim() || undefined,
    lines,
  };
  if (params.editingQuoteId !== null) {
    return {
      action: "update_quote",
      quoteId: params.editingQuoteId,
      reason: params.quoteEditReason.trim() || "Ajuste de cotización",
      ...base,
    };
  }
  return { action: "create_quote", ...base };
}

export function validateSellerCartLines(
  cart: SellerCartLine[],
  cartSubtotalPen: number,
  parsedGlobalDiscountPen: number
): string | null {
  if (cart.length === 0) {
    return "Agrega al menos un producto.";
  }
  const invalidQtyLine = cart.find((c) => {
    const fractional = isFractionalUom(c.product.unit_of_measure);
    if (!Number.isFinite(c.quantity) || c.quantity <= 0) return true;
    if (!fractional && !Number.isInteger(c.quantity)) return true;
    return false;
  });
  if (invalidQtyLine) {
    const fractional = isFractionalUom(invalidQtyLine.product.unit_of_measure);
    return fractional
      ? `Revisa la cantidad de "${invalidQtyLine.product.name}" (debe ser mayor a 0).`
      : `Revisa la cantidad de "${invalidQtyLine.product.name}" (entero mínimo 1 para ${
          invalidQtyLine.product.unit_of_measure || "NIU"
        }).`;
  }
  const invalidPriceLine = cart.find(
    (c) => !Number.isFinite(c.unitPricePen) || c.unitPricePen <= 0
  );
  if (invalidPriceLine) {
    return `El precio unitario de "${invalidPriceLine.product.name}" debe ser mayor a S/ 0.00.`;
  }
  if (parsedGlobalDiscountPen >= cartSubtotalPen) {
    return "El descuento global debe ser menor al subtotal.";
  }
  return null;
}

export function buildCartLinesFromOrder(
  order: SellerOrderDto,
  catalog: SellerCatalogItemDto[]
): { lines: SellerCartLine[]; error: string | null } {
  const nextCart: SellerCartLine[] = [];
  for (const line of order.lines) {
    const product = catalog.find((item) => item.product_id === Number(line.product_id));
    if (!product) {
      return {
        lines: [],
        error: "Uno de los productos ya no está disponible en el catálogo.",
      };
    }
    const quantity = Number(line.quantity);
    const unitPricePen = Number(
      line.unit_price_pen ?? product.list_sale_price_pen ?? 0
    );
    nextCart.push({
      product,
      quantity,
      quantityInput: String(quantity),
      unitPricePen,
      unitPriceInput: unitPricePen.toFixed(2),
    });
  }
  return { lines: nextCart, error: null };
}

export function buildCartLinesFromQuote(
  quote: SellerQuoteDto,
  catalog: SellerCatalogItemDto[]
): { lines: SellerCartLine[]; error: string | null } {
  const nextCart: SellerCartLine[] = [];
  for (const line of quote.lines) {
    const product = catalog.find((item) => item.product_id === Number(line.product_id));
    if (!product) {
      return {
        lines: [],
        error: `El producto "${line.raw_description}" no está vinculado o ya no está activo en el catálogo.`,
      };
    }
    const quantity = Number(line.quantity);
    const unitPricePen = Number(
      line.unit_price_pen ?? product.list_sale_price_pen ?? 0
    );
    nextCart.push({
      product,
      quantity,
      quantityInput: String(quantity),
      unitPricePen,
      unitPriceInput: unitPricePen.toFixed(2),
    });
  }
  return { lines: nextCart, error: null };
}
