import type { Dispatch, SetStateAction } from "react";
import type { CashAccountItem } from "@/components/socios/types";
import type { RawOrderWithLines } from "@/lib/types";

export type SellerPaymentMode = "CASH" | "CREDIT" | "YAPE_PLIN" | "TRANSFER";
export type SellerOrderStep = "client" | "products" | "payment" | "confirmation";

export interface SellerCustomerDto {
  party_id: number;
  name: string;
  legal_name?: string | null;
  trade_name?: string | null;
  doc_type?: string | null;
  doc_number?: string | null;
  is_generic_doc?: boolean;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city_zone?: string | null;
  notes?: string | null;
  geo_lat?: number | null;
  geo_lng?: number | null;
  has_orders?: boolean;
  aliases?: string[];
}

export interface SellerCatalogItemDto {
  product_id: number;
  sku: string;
  name: string;
  unit_of_measure: string;
  fulfillment_mode: "STOCKED" | "ON_DEMAND";
  stock_on_hand: number;
  list_sale_price_pen: number | null;
  min_sale_price_pen: number | null;
}

export interface SellerCartLine {
  product: SellerCatalogItemDto;
  quantity: number;
  quantityInput: string;
  unitDiscountPen: number;
}

export interface SellerOrderDraft {
  customerNameRaw: string;
  selectedCustomer: SellerCustomerDto | null;
  paymentMode: SellerPaymentMode;
  collectOnDelivery: boolean;
  creditDays: number;
  customPromiseDate: string;
  initialPaidPen: string;
  notes: string;
  cart: SellerCartLine[];
  orderStep: SellerOrderStep;
  showCustomPromiseDate: boolean;
}

export type SellerOrderDto = RawOrderWithLines;

export interface SellerQuoteLineDto {
  quote_line_id: number;
  line_no: number;
  product_id: number | null;
  sku: string | null;
  unit_of_measure: string;
  raw_description: string;
  quantity: number;
  unit_price_pen: number;
  line_total_pen: number;
}

export interface SellerQuoteDto {
  quote_id: number;
  quote_code: string;
  issue_date: string;
  customer_party_id: number | null;
  customer_name: string;
  currency: string;
  tax_regime: string;
  total_pen: number;
  status: "OPEN" | "CONVERTED" | "EXPIRED" | "CANCELLED";
  related_cpe: string | null;
  seller_name: string | null;
  notes: string | null;
  converted_order_code: string | null;
  lines: SellerQuoteLineDto[];
}

export interface SellerPaymentTimelineEntryDto {
  arPaymentId: number;
  paymentDate: string;
  paymentMode: SellerPaymentMode;
  collectedByName: string | null;
  amountPen: number;
}

export interface SellerOrderMutationResultDto {
  orderCode: string;
  requiresApproval?: boolean;
}

export interface SellerCollectionMutationResultDto {
  allocations?: Array<{ orderId?: number; amountPen?: number }>;
  isSettled?: boolean;
  newBalanceDuePen?: number;
}

export interface SellerExpenseMutationResultDto {
  expenseId?: number;
}

export type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type SellerCollectionPaymentMode = "CASH" | "YAPE_PLIN" | "TRANSFER";

export interface SellerFeedback {
  type: "ok" | "warn" | "err";
  msg: string;
}

export type SellerFeedbackSetter = (feedback: SellerFeedback | null) => void;

export interface SellerOfflineReferenceSnapshot {
  catalog: SellerCatalogItemDto[];
  customers: SellerCustomerDto[];
  accounts: CashAccountItem[];
  savedAt: string;
}

export interface SellerQuoteCreateResultDto {
  quoteCode: string;
  totalPen?: number;
}

export interface SellerQuoteConvertResultDto {
  order?: { orderCode: string; requiresApproval?: boolean };
}

export interface SellerPaymentTimelineResponseDto {
  timeline?: SellerPaymentTimelineEntryDto[];
}

export interface SellerCancelledDraftItemPayload {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitDiscountPen: number;
}

export type SellerCancelledDraftPayload = {
  action: "log_cancelled_draft";
  customerPartyId: number | null;
  customerName: string;
  paymentMode: SellerPaymentMode;
  estimatedTotalPen: number;
  itemCount: number;
  items: SellerCancelledDraftItemPayload[];
  reasonCode: string;
  reasonLabel: string;
  notes: string | null;
};

export type SellerOrderLinePayload = {
  productId: number;
  quantity: number;
  unitDiscountPen: number;
};

export type SellerOrderPayload = {
  action: "create" | "update";
  orderId: number | undefined;
  reason: string | undefined;
  customerPartyId: number | null;
  customerNameRaw: string;
  paymentMode: SellerPaymentMode;
  collectOnDelivery: boolean | undefined;
  creditDays: number | undefined;
  promisedPaymentDate: string | null;
  initialPaidPen: number | undefined;
  notes: string;
  lines: SellerOrderLinePayload[];
};

export type SellerQuoteCreatePayload = {
  action: "create_quote";
  customerPartyId: number | null;
  customerNameRaw: string | undefined;
  notes: string | undefined;
  lines: Array<{
    productId: number;
    rawDescription: string;
    quantity: number;
    unitPricePen: number;
  }>;
};

export type SellerCollectionPayload =
  | {
      mode: "fifo_customer";
      customerPartyId: number | null;
      totalAmountPen: number;
      paymentMode: SellerCollectionPaymentMode;
      accountId: number | undefined;
      nextCollectionDays: number | null;
      notes: string;
    }
  | {
      mode: "single_order";
      orderId: number;
      amountPen: number;
      paymentMode: SellerCollectionPaymentMode;
      accountId: number | undefined;
      nextCollectionDays: number | null;
      notes: string;
    };

export type SellerExpensePayload = {
  amountPen: number;
  expenseBucket: "ROUTE_OPEX";
  expenseCategory: string;
  txDate: string;
  description: string;
};

export type SellerDebtDetailTarget =
  | {
      mode: "customer";
      customerKey: string;
      customerName: string;
      customerPartyId: number | null;
    }
  | { mode: "order"; orderId: number };
