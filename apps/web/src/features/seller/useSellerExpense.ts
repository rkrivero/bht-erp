"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import { submitOfflineCapable } from "@/lib/offline/outbox";
import type {
  SellerExpenseMutationResultDto,
  SellerExpensePayload,
  SellerFeedbackSetter,
} from "@/features/seller/types";
import { isAuthError } from "@/features/seller/seller-utils";

/** Route-expense form state and (offline-capable) submission. */
export function useSellerExpense(
  actorUsername: string | undefined,
  setFeedback: SellerFeedbackSetter
) {
  const router = useRouter();
  const [expenseCategory, setExpenseCategory] = useState("COMBUSTIBLE");
  const [expenseDate, setExpenseDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  );
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDesc, setExpenseDesc] = useState("");
  const [busyExpense, setBusyExpense] = useState(false);

  async function handleSubmitExpense(e: React.FormEvent) {
    e.preventDefault();
    if (busyExpense) return;
    setFeedback(null);
    setBusyExpense(true);
    try {
      const payload: SellerExpensePayload = {
        amountPen: Number(expenseAmount),
        expenseBucket: "ROUTE_OPEX",
        expenseCategory,
        txDate: expenseDate,
        description: expenseDesc,
      };
      const result = await submitOfflineCapable<SellerExpenseMutationResultDto>({
        kind: "ROUTE_EXPENSE",
        actorUsername: actorUsername || "",
        url: "/api/treasury",
        body: payload,
      });
      setExpenseAmount("");
      setExpenseDesc("");
      setFeedback(
        result.queued
          ? {
              type: "warn",
              msg: "Gasto guardado en este dispositivo. Se sincronizará al recuperar Internet.",
            }
          : { type: "ok", msg: "Gasto operativo registrado." }
      );
      if (result.queued) return;
      notifyLocalSync(["treasury", "partners"]);
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
            : "Error de conexión al guardar el gasto.",
      });
    } finally {
      setBusyExpense(false);
    }
  }

  return {
    expenseCategory,
    setExpenseCategory,
    expenseDate,
    setExpenseDate,
    expenseAmount,
    setExpenseAmount,
    expenseDesc,
    setExpenseDesc,
    busyExpense,
    handleSubmitExpense,
  };
}
