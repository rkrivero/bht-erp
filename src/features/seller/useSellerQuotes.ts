"use client";

import { useState } from "react";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { SellerData } from "@/features/seller/useSellerData";
import type {
  SellerFeedbackSetter,
  SellerQuoteConvertResultDto,
} from "@/features/seller/types";
import { apiErrorMessage, postJson } from "@/features/seller/seller-utils";

/** Quote actions available from the quotes tab (create lives in the order flow). */
export function useSellerQuotes(data: SellerData, setFeedback: SellerFeedbackSetter) {
  const { loadAll, loadOrdersAndCatalog } = data;
  const [busyQuoteId, setBusyQuoteId] = useState<number | null>(null);

  async function handleConvertQuote(quoteId: number, mode: "CASH" | "CREDIT") {
    if (busyQuoteId === quoteId) return;
    setFeedback(null);
    setBusyQuoteId(quoteId);
    try {
      const converted = await postJson<SellerQuoteConvertResultDto>("/api/quotes", {
        action: "convert_to_order",
        quoteId,
        paymentMode: mode,
        collectOnDelivery: mode === "CASH",
        creditDays: mode === "CREDIT" ? 7 : undefined,
      });
      setFeedback({
        type: converted.order?.requiresApproval ? "warn" : "ok",
        msg: converted.order?.requiresApproval
          ? `Cotización convertida a ${converted.order.orderCode} (pendiente de aprobación de Socio).`
          : `Cotización convertida en pedido ${converted.order?.orderCode} y enviada a Almacén.`,
      });
      notifyLocalSync(["orders", "inventory", "collections", "treasury", "partners"]);
      await loadAll({ silent: true });
    } catch (error) {
      setFeedback({
        type: "err",
        msg: apiErrorMessage(error, "Error de conexión al convertir la cotización."),
      });
    } finally {
      setBusyQuoteId(null);
    }
  }

  async function handleUpdateQuoteStatus(
    quoteId: number,
    nextStatus: "EXPIRED" | "CANCELLED"
  ) {
    if (busyQuoteId === quoteId) return;
    setBusyQuoteId(quoteId);
    try {
      await postJson<object>("/api/quotes", {
        action: "update_status",
        quoteId,
        nextStatus,
      });
      notifyLocalSync(["orders", "partners"]);
      await loadOrdersAndCatalog({ silent: true });
    } catch (error) {
      setFeedback({
        type: "err",
        msg: apiErrorMessage(error, "Error de conexión al actualizar la cotización."),
      });
    } finally {
      setBusyQuoteId(null);
    }
  }

  return { busyQuoteId, handleConvertQuote, handleUpdateQuoteStatus };
}
