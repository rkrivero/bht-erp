"use client";

import React, { useDeferredValue, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/api-client";
import type { CustomerDebtDto, DebtOrderDto } from "@/lib/contracts";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import { submitOfflineCapable } from "@/lib/offline/outbox";
import type { SellerData } from "@/features/seller/useSellerData";
import type {
  SellerCollectionMutationResultDto,
  SellerCollectionPaymentMode,
  SellerCollectionPayload,
  SellerDebtDetailTarget,
  SellerFeedbackSetter,
  SellerPaymentTimelineEntryDto,
  SellerPaymentTimelineResponseDto,
} from "@/features/seller/types";
import {
  apiErrorMessage,
  isAuthError,
  normalizeSearchText,
} from "@/features/seller/seller-utils";

/** Cobranza: debtor filters, payment timeline and the abono (payment) flow. */
export function useSellerCollections(
  data: SellerData,
  setFeedback: SellerFeedbackSetter
) {
  const router = useRouter();
  const { currentUser, debtorsByOrder, debtorsByCustomer, loadAll } = data;
  const [debtorView, setDebtorView] = useState<"orders" | "customers">("orders");
  const [promiseFilter, setPromiseFilter] = useState<string>("ALL");
  const [debtorSearch, setDebtorSearch] = useState("");
  const deferredDebtorSearch = useDeferredValue(debtorSearch);
  const [selectedOrderForAbono, setSelectedOrderForAbono] =
    useState<DebtOrderDto | null>(null);
  const [selectedCustomerForFifo, setSelectedCustomerForFifo] =
    useState<CustomerDebtDto | null>(null);
  const [debtDetailTarget, setDebtDetailTarget] =
    useState<SellerDebtDetailTarget | null>(null);
  const [abonoAmount, setAbonoAmount] = useState("");
  const [abonoMode, setAbonoMode] = useState<SellerCollectionPaymentMode>("CASH");
  const [abonoNextDays, setAbonoNextDays] = useState<number>(7);
  const [abonoAccountId, setAbonoAccountId] = useState<string>("");
  const [busyAbono, setBusyAbono] = useState(false);
  const [timelineOrderId, setTimelineOrderId] = useState<number | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<
    SellerPaymentTimelineEntryDto[]
  >([]);
  const [timelineLoadingId, setTimelineLoadingId] = useState<number | null>(null);

  const isAbonoModalOpen = Boolean(selectedOrderForAbono || selectedCustomerForFifo);

  const filteredDebtOrders = useMemo(() => {
    const q = normalizeSearchText(deferredDebtorSearch);
    const tokens = q.split(/\s+/).filter(Boolean);
    return debtorsByOrder.filter((o) => {
      if (promiseFilter !== "ALL" && o.promiseStatus !== promiseFilter) {
        return false;
      }
      if (tokens.length === 0) return true;
      const haystack = normalizeSearchText(`${o.customerName} ${o.orderCode}`);
      return tokens.every((tok) => haystack.includes(tok));
    });
  }, [debtorsByOrder, promiseFilter, deferredDebtorSearch]);

  const filteredDebtorsByCustomer = useMemo(() => {
    const q = normalizeSearchText(deferredDebtorSearch);
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return debtorsByCustomer;
    return debtorsByCustomer.filter((c) => {
      const haystack = normalizeSearchText(c.customerName);
      return tokens.every((tok) => haystack.includes(tok));
    });
  }, [debtorsByCustomer, deferredDebtorSearch]);

  const collectionSummary = useMemo(() => {
    const total = debtorsByOrder.reduce((sum, order) => sum + order.balanceDuePen, 0);
    const dueSoon = debtorsByOrder
      .filter((order) => order.promiseStatus === "DUE_TODAY_OR_TOMORROW")
      .reduce((sum, order) => sum + order.balanceDuePen, 0);
    const overdue = debtorsByOrder
      .filter((order) => order.promiseStatus === "PROMISE_BROKEN")
      .reduce((sum, order) => sum + order.balanceDuePen, 0);
    return { total, dueSoon, overdue };
  }, [debtorsByOrder]);

  const prioritizedDebtOrders = useMemo(() => {
    const priority = (status: string) =>
      status === "PROMISE_BROKEN" ? 0 : status === "DUE_TODAY_OR_TOMORROW" ? 1 : 2;
    return [...filteredDebtOrders].sort(
      (a, b) =>
        priority(a.promiseStatus) - priority(b.promiseStatus) ||
        b.balanceDuePen - a.balanceDuePen
    );
  }, [filteredDebtOrders]);

  function startOrderAbono(order: DebtOrderDto) {
    setSelectedCustomerForFifo(null);
    setSelectedOrderForAbono(order);
    setAbonoAmount(String(order.balanceDuePen));
    setAbonoAccountId("");
  }

  function startCustomerAbono(customer: CustomerDebtDto) {
    setSelectedOrderForAbono(null);
    setSelectedCustomerForFifo(customer);
    setAbonoAmount(String(customer.totalBalanceDuePen));
    setAbonoAccountId("");
  }

  function closeAbonoModal() {
    setSelectedOrderForAbono(null);
    setSelectedCustomerForFifo(null);
    setAbonoAccountId("");
  }

  async function handleSubmitAbono(e: React.FormEvent) {
    e.preventDefault();
    if (busyAbono || (!selectedOrderForAbono && !selectedCustomerForFifo)) return;
    setFeedback(null);
    setBusyAbono(true);
    try {
      const activeBalanceDue = selectedCustomerForFifo
        ? selectedCustomerForFifo.totalBalanceDuePen
        : (selectedOrderForAbono?.balanceDuePen ?? 0);
      const parsedAbono = Number(abonoAmount);
      const isFullSettlement =
        Number.isFinite(parsedAbono) && parsedAbono >= activeBalanceDue - 0.05;
      const selectedAccId = abonoAccountId ? Number(abonoAccountId) : undefined;
      const nextCollectionDays = isFullSettlement ? null : abonoNextDays;
      let payload: SellerCollectionPayload;
      if (selectedCustomerForFifo) {
        payload = {
          mode: "fifo_customer",
          customerPartyId: selectedCustomerForFifo.customerPartyId,
          totalAmountPen: parsedAbono,
          paymentMode: abonoMode,
          accountId: selectedAccId,
          nextCollectionDays,
          notes: "Abono general a cuenta (deudas más antiguas)",
        };
      } else if (selectedOrderForAbono) {
        payload = {
          mode: "single_order",
          orderId: selectedOrderForAbono.orderId,
          amountPen: parsedAbono,
          paymentMode: abonoMode,
          accountId: selectedAccId,
          nextCollectionDays,
          notes: "Abono registrado por Vendedor",
        };
      } else {
        return;
      }
      const result = await submitOfflineCapable<SellerCollectionMutationResultDto>({
        kind: "COLLECTION",
        actorUsername: currentUser?.username || "",
        url: "/api/collections",
        body: payload,
      });
      const wasCustomerAbono = Boolean(selectedCustomerForFifo);
      setSelectedOrderForAbono(null);
      setSelectedCustomerForFifo(null);
      setAbonoAmount("");
      setAbonoAccountId("");
      if (result.queued) {
        setFeedback({
          type: "warn",
          msg: "Cobro guardado en este dispositivo. Se validará y sincronizará al recuperar Internet.",
        });
        return;
      }
      const saved = result.data!;
      setFeedback({
        type: "ok",
        msg: wasCustomerAbono
          ? `Abono general aplicado a ${
              Array.isArray(saved.allocations) ? saved.allocations.length : 1
            } pedido(s) más antiguos.`
          : saved.isSettled
            ? "¡Pedido cancelado al 100%!"
            : `Abono registrado. Nuevo saldo pendiente: S/ ${Number(
                saved.newBalanceDuePen
              ).toFixed(2)}`,
      });
      notifyLocalSync(["collections", "orders", "treasury", "partners"]);
      await loadAll({ silent: true });
    } catch (error) {
      if (isAuthError(error)) {
        router.push("/login");
        return;
      }
      setFeedback({
        type: "err",
        msg:
          error instanceof Error
            ? error.message
            : "Error de red al registrar el abono.",
      });
    } finally {
      setBusyAbono(false);
    }
  }

  const timelineAbortRef = useRef<AbortController | null>(null);

  async function handleOpenTimeline(orderId: number) {
    if (timelineOrderId === orderId) {
      timelineAbortRef.current?.abort();
      setTimelineOrderId(null);
      return;
    }
    timelineAbortRef.current?.abort();
    const controller = new AbortController();
    timelineAbortRef.current = controller;
    setTimelineLoadingId(orderId);
    try {
      const response = await fetchJson<SellerPaymentTimelineResponseDto>(
        `/api/collections?orderId=${orderId}`,
        { cache: "no-store", signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      setTimelineOrderId(orderId);
      setTimelineEntries(response.timeline || []);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isAuthError(error)) {
        router.push("/login");
        return;
      }
      setFeedback({
        type: "err",
        msg: apiErrorMessage(error, "Error de red al consultar el historial de pagos."),
      });
    } finally {
      if (!controller.signal.aborted) {
        setTimelineLoadingId(null);
      }
    }
  }

  return {
    debtorsByOrder,
    debtorsByCustomer,
    sellerAccounts: data.sellerAccounts,
    debtorView,
    setDebtorView,
    promiseFilter,
    setPromiseFilter,
    debtorSearch,
    setDebtorSearch,
    selectedOrderForAbono,
    selectedCustomerForFifo,
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
    timelineOrderId,
    timelineEntries,
    timelineLoadingId,
    isAbonoModalOpen,
    filteredDebtOrders,
    filteredDebtorsByCustomer,
    collectionSummary,
    prioritizedDebtOrders,
    startOrderAbono,
    startCustomerAbono,
    closeAbonoModal,
    handleSubmitAbono,
    handleOpenTimeline,
  };
}

export type SellerCollections = ReturnType<typeof useSellerCollections>;
