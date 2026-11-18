"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import type { CustomerDebtDto } from "@/lib/contracts";
import type { SellerOrderDto } from "@/features/seller/types";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import {
  mutationErrorMessage,
  postJson,
  type DebtDetailTarget,
  type PartnerAbonoOrder,
  type ShowFeedback,
} from "./partnerShared";
import type { PartnerData } from "./usePartnerData";

type AbonoPaymentMode = "CASH" | "YAPE_PLIN" | "TRANSFER";

interface CollectionsFlowDeps {
  debtorsByOrder: PartnerData["debtorsByOrder"];
  debtorsByCustomer: PartnerData["debtorsByCustomer"];
  setFeedback: PartnerData["setFeedback"];
  showFeedback: ShowFeedback;
  refreshDashboard: PartnerData["refreshDashboard"];
}

/** Debtor filters, summaries and the shared abono (payment) draft + submit. */
export function useCollectionsFlow({
  debtorsByOrder,
  debtorsByCustomer,
  setFeedback,
  showFeedback,
  refreshDashboard,
}: CollectionsFlowDeps) {
  const [promiseFilter, setPromiseFilter] = useState("ALL");
  const [debtorSearch, setDebtorSearch] = useState("");
  const deferredDebtorSearch = useDeferredValue(debtorSearch);
  const [abonoOrder, setAbonoOrder] = useState<PartnerAbonoOrder | null>(null);
  const [fifoCustomer, setFifoCustomer] = useState<CustomerDebtDto | null>(null);
  const [debtDetailTarget, setDebtDetailTarget] = useState<DebtDetailTarget>(null);
  const [abonoAmount, setAbonoAmount] = useState("");
  const [abonoMode, setAbonoMode] = useState<AbonoPaymentMode>("CASH");
  const [abonoNextDays, setAbonoNextDays] = useState<number>(7);
  const [abonoAccountId, setAbonoAccountId] = useState<string>("");
  const [busyAbono, setBusyAbono] = useState(false);

  const openAbonoForOrderRecord = useCallback((o: SellerOrderDto) => {
    const totalPen = Number(o.total_pen ?? 0);
    const balanceDuePen = Math.max(0, Number(o.balance_due_pen ?? 0));
    const paidPen = Number(o.paid_pen ?? Math.max(0, totalPen - balanceDuePen));
    setFifoCustomer(null);
    setAbonoOrder({
      orderId: Number(o.order_id),
      orderCode: String(o.order_code ?? ""),
      customerName: String(o.customer_name ?? ""),
      totalPen,
      paidPen,
      balanceDuePen,
    });
    setAbonoAmount(balanceDuePen.toFixed(2));
    setAbonoAccountId("");
  }, []);

  async function handleSaveAbono(e: React.FormEvent) {
    e.preventDefault();
    if ((!abonoOrder && !fifoCustomer) || busyAbono) return;
    setFeedback(null);
    setBusyAbono(true);
    try {
      const activeBalanceDue = fifoCustomer
        ? Number(fifoCustomer.totalBalanceDuePen ?? 0)
        : Number(abonoOrder?.balanceDuePen ?? 0);
      const parsedAbono = Number(abonoAmount);
      const isFullSettlement =
        Number.isFinite(parsedAbono) &&
        activeBalanceDue > 0 &&
        parsedAbono >= activeBalanceDue - 0.05;
      const selectedAccId = abonoAccountId ? Number(abonoAccountId) : undefined;
      const payload = fifoCustomer
        ? {
            mode: "fifo_customer",
            customerPartyId: Number(fifoCustomer.customerPartyId),
            totalAmountPen: parsedAbono,
            paymentMode: abonoMode,
            accountId: selectedAccId,
            nextCollectionDays: isFullSettlement ? null : abonoNextDays,
            notes:
              "Abono general a cuenta registrado por Socio o Gerencia (deudas más antiguas)",
          }
        : {
            mode: "single_order",
            orderId: Number(abonoOrder?.orderId),
            amountPen: parsedAbono,
            paymentMode: abonoMode,
            accountId: selectedAccId,
            nextCollectionDays: isFullSettlement ? null : abonoNextDays,
            notes: "Cobro registrado por Socio o Gerencia",
          };
      await postJson("/api/collections", payload);
      showFeedback("Abono registrado correctamente.");
      setAbonoOrder(null);
      setFifoCustomer(null);
      setAbonoAmount("");
      setAbonoAccountId("");
      notifyLocalSync(["collections", "orders", "treasury", "partners"]);
      await refreshDashboard(["collections", "orders", "treasury", "partners"]);
    } catch (error) {
      showFeedback(
        mutationErrorMessage(
          error,
          "Error al registrar abono",
          "Error de red al registrar abono."
        ),
        true
      );
    } finally {
      setBusyAbono(false);
    }
  }

  const filteredDebtorsByCustomer = useMemo(() => {
    const q = deferredDebtorSearch.trim().toLowerCase();
    if (!q) return debtorsByCustomer;
    return debtorsByCustomer.filter((c) =>
      String(c.customerName ?? "")
        .toLowerCase()
        .includes(q)
    );
  }, [debtorsByCustomer, deferredDebtorSearch]);

  const filteredDebtorsByOrder = useMemo(() => {
    const q = deferredDebtorSearch.trim().toLowerCase();
    return debtorsByOrder.filter((o) => {
      if (promiseFilter !== "ALL" && o.promiseStatus !== promiseFilter) {
        return false;
      }
      if (!q) return true;
      return (
        String(o.customerName ?? "")
          .toLowerCase()
          .includes(q) ||
        String(o.orderCode ?? "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [debtorsByOrder, promiseFilter, deferredDebtorSearch]);

  const collectionSummary = useMemo(() => {
    const total = debtorsByOrder.reduce(
      (sum, order) => sum + Number(order.balanceDuePen || 0),
      0
    );
    const dueSoon = debtorsByOrder
      .filter((order) => order.promiseStatus === "DUE_TODAY_OR_TOMORROW")
      .reduce((sum, order) => sum + Number(order.balanceDuePen || 0), 0);
    const overdue = debtorsByOrder
      .filter((order) => order.promiseStatus === "PROMISE_BROKEN")
      .reduce((sum, order) => sum + Number(order.balanceDuePen || 0), 0);
    return { total, dueSoon, overdue };
  }, [debtorsByOrder]);

  const prioritizedDebtorsByOrder = useMemo(() => {
    const priority = (status: string) =>
      status === "PROMISE_BROKEN" ? 0 : status === "DUE_TODAY_OR_TOMORROW" ? 1 : 2;
    return [...filteredDebtorsByOrder].sort(
      (a, b) =>
        priority(String(a.promiseStatus)) - priority(String(b.promiseStatus)) ||
        Number(b.balanceDuePen) - Number(a.balanceDuePen)
    );
  }, [filteredDebtorsByOrder]);

  return {
    promiseFilter,
    setPromiseFilter,
    debtorSearch,
    setDebtorSearch,
    abonoOrder,
    setAbonoOrder,
    fifoCustomer,
    setFifoCustomer,
    debtDetailTarget,
    setDebtDetailTarget,
    abonoAmount,
    setAbonoAmount,
    abonoMode,
    setAbonoMode,
    abonoNextDays,
    setAbonoNextDays,
    abonoAccountId,
    setAbonoAccountId,
    busyAbono,
    openAbonoForOrderRecord,
    handleSaveAbono,
    filteredDebtorsByCustomer,
    filteredDebtorsByOrder,
    collectionSummary,
    prioritizedDebtorsByOrder,
  };
}

export type CollectionsFlow = ReturnType<typeof useCollectionsFlow>;
