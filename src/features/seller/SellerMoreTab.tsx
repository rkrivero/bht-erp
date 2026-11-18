"use client";

import type { FormEvent } from "react";
import { ReceiptIcon } from "@/components/ui/Icons";
import { Button, Card, FieldLabel, INPUT_CLASS } from "@/components/ui/Primitives";
import { OUTFLOW_CATEGORIES_BY_BUCKET } from "@/lib/treasury-constants";

interface SellerMoreTabProps {
  liveStatus: "live" | "syncing" | "offline" | "paused";
  userName: string;
  onSync: () => void;
  expenseDate: string;
  setExpenseDate: (value: string) => void;
  expenseCategory: string;
  setExpenseCategory: (value: string) => void;
  expenseAmount: string;
  setExpenseAmount: (value: string) => void;
  expenseDesc: string;
  setExpenseDesc: (value: string) => void;
  busyExpense: boolean;
  onSubmitExpense: (event: FormEvent) => void;
}

export default function SellerMoreTab(props: SellerMoreTabProps) {
  const statusLabel =
    props.liveStatus === "live"
      ? "en vivo"
      : props.liveStatus === "syncing"
        ? "sincronizando"
        : props.liveStatus === "offline"
          ? "sin conexión"
          : "en pausa";
  return (
    <section aria-label="Más opciones" className="mx-auto max-w-2xl space-y-4">
      <Card padding="sm" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[var(--bg-subtle)] p-3">
          <p className="text-xs font-semibold text-[var(--bht-navy)]">Sincronización</p>
          <p className="mt-1 text-xs text-[var(--ink-secondary)]">
            Estado: {statusLabel}.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onSync}
            className="mt-3 w-full"
          >
            Sincronizar ahora
          </Button>
        </div>
        <div className="rounded-xl bg-[var(--bg-subtle)] p-3">
          <p className="text-xs font-semibold text-[var(--bht-navy)]">
            Datos personales
          </p>
          <p className="mt-1 text-xs text-[var(--ink-secondary)]">{props.userName}</p>
        </div>
      </Card>
      <Card accent="horizon" padding="lg">
        <form onSubmit={props.onSubmitExpense} className="space-y-4">
          <div className="flex items-center gap-2.5 border-b border-bht-line pb-3">
            <div
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-bht-mist text-bht-navy-deep"
            >
              <ReceiptIcon className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-bht-ink-strong">
                Registrar Gasto Diario
              </h2>
              <p className="text-xs text-bht-ink-soft">
                Registra combustible, peajes y otros gastos diarios de ruta. Puedes
                elegir una fecha anterior si olvidaste registrarlo.
              </p>
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="expense-date" required>
              Fecha del gasto
            </FieldLabel>
            <input
              id="expense-date"
              type="date"
              required
              value={props.expenseDate}
              onChange={(event) => props.setExpenseDate(event.target.value)}
              className={`${INPUT_CLASS} mt-1.5 font-medium`}
            />
          </div>
          <div>
            <FieldLabel htmlFor="expense-category">Categoría</FieldLabel>
            <select
              id="expense-category"
              value={props.expenseCategory}
              onChange={(event) => props.setExpenseCategory(event.target.value)}
              className={`${INPUT_CLASS} mt-1.5 font-medium`}
            >
              {OUTFLOW_CATEGORIES_BY_BUCKET.ROUTE_OPEX.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="expense-amount" required>
              Monto en Soles (S/)
            </FieldLabel>
            <input
              id="expense-amount"
              type="number"
              step="0.01"
              min="0.10"
              required
              value={props.expenseAmount}
              onChange={(event) => props.setExpenseAmount(event.target.value)}
              placeholder="0.00"
              className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
            />
          </div>
          <div>
            <FieldLabel htmlFor="expense-desc" required>
              Detalle breve
            </FieldLabel>
            <input
              id="expense-desc"
              type="text"
              required
              value={props.expenseDesc}
              onChange={(event) => props.setExpenseDesc(event.target.value)}
              placeholder="Ej. Gasolina unidad placa X"
              className={`${INPUT_CLASS} mt-1.5`}
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={props.busyExpense}
            className="w-full"
          >
            {props.busyExpense ? "Guardando..." : "Guardar Gasto Diario"}
          </Button>
        </form>
      </Card>
    </section>
  );
}
