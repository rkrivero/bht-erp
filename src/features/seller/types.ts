import type { Dispatch, SetStateAction } from "react";
import type { RawOrderWithLines } from "@/lib/types";

export type SellerPaymentMode = "CASH" | "CREDIT" | "YAPE_PLIN" | "TRANSFER";
export type SellerOrderStep = "client" | "products" | "payment" | "confirmation";

export interface SellerCustomerDto {
  party_id: number;
  name: string;
  doc_number?: string | null;
  phone?: string | null;
  address?: string | null;
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
