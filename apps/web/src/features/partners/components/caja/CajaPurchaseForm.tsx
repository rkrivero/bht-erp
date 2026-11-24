"use client";

import React, { useCallback, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { PlusIcon } from "@/components/ui/Icons";
import { Button, Card, FieldLabel, INPUT_CLASS } from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { formatDocTypeEs } from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import {
  formatPen,
  type CashAccountItem,
  type PartnerCatalogItem,
  type PendingOnDemandItem,
  type SupplierItem,
} from "../types";
import { PurchaseLineRow, PurchaseOnDemandSection } from "./PurchaseLineRow";
import {
  calculatePurchaseTotals,
  getTodayLimaIso,
  type PurchaseLineDraft,
} from "./caja-utils";

const SupplierFormModal = dynamic(
  () => import("@/components/directory/SupplierFormModal"),
  { ssr: false }
);

export function CajaPurchaseForm({
  catalog,
  accounts,
  suppliers,
  pendingOnDemand,
  defaultAccountId,
  items,
  setItems,
  fulfillOrderLineIds,
  setFulfillOrderLineIds,
  onClose,
  onRefresh,
  onFeedback,
  onSupplierModalOpenChange,
}: {
  catalog: PartnerCatalogItem[];
  accounts: CashAccountItem[];
  suppliers: SupplierItem[];
  pendingOnDemand: PendingOnDemandItem[];
  defaultAccountId: string;
  items: PurchaseLineDraft[];
  setItems: React.Dispatch<React.SetStateAction<PurchaseLineDraft[]>>;
  fulfillOrderLineIds: number[];
  setFulfillOrderLineIds: React.Dispatch<React.SetStateAction<number[]>>;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onFeedback: (msg: string, isError?: boolean) => void;
  onSupplierModalOpenChange?: (open: boolean) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [docType, setDocType] = useState<
    "FACTURA" | "NOTA_VENTA" | "BOLETA" | "RECIBO"
  >("FACTURA");
  const [docSeries, setDocSeries] = useState("F001");
  const [docNumber, setDocNumber] = useState("");
  const [issueDate, setIssueDate] = useState(getTodayLimaIso());
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState<"PEN" | "USD">("PEN");
  const [exchangeRate, setExchangeRate] = useState("3.75");
  const [taxMode, setTaxMode] = useState<"NONE" | "INCLUDED" | "EXCLUDED">("NONE");
  const [paymentCond, setPaymentCond] = useState<"CASH" | "CREDIT" | "PARTIAL">("CASH");
  const [paidNow, setPaidNow] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [notes, setNotes] = useState("");
  const [busyPurchase, setBusyPurchase] = useState(false);

  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [localSuppliers, setLocalSuppliers] = useState<SupplierItem[]>([]);

  const mergedSuppliers = useMemo(() => {
    const byId = new Map<number, SupplierItem>();
    for (const s of suppliers) byId.set(s.party_id, s);
    for (const s of localSuppliers) byId.set(s.party_id, s);
    return Array.from(byId.values()).sort((a, b) =>
      (a.trade_name || a.legal_name).localeCompare(b.trade_name || b.legal_name)
    );
  }, [suppliers, localSuppliers]);

  const effectiveAccountId = accountId || defaultAccountId;

  const selectedProductIds = useMemo(
    () =>
      items
        .map((it) => Number(it.productId))
        .filter((id) => Number.isFinite(id) && id > 0),
    [items]
  );

  const matchingOnDemandLines = useMemo(
    () => pendingOnDemand.filter((od) => selectedProductIds.includes(od.product_id)),
    [pendingOnDemand, selectedProductIds]
  );

  const otherOnDemandLines = useMemo(
    () => pendingOnDemand.filter((od) => !selectedProductIds.includes(od.product_id)),
    [pendingOnDemand, selectedProductIds]
  );

  const effectiveExchangeRate = useMemo(() => {
    if (currency !== "USD") return 1;
    const n = Number(exchangeRate || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [currency, exchangeRate]);

  const totals = useMemo(
    () => calculatePurchaseTotals(items, currency, effectiveExchangeRate, taxMode),
    [items, currency, effectiveExchangeRate, taxMode]
  );

  const paidNowComputed = useMemo(() => {
    if (paymentCond === "CASH") return totals.totalPen;
    if (paymentCond === "CREDIT") return 0;
    const partial = Number(paidNow || 0);
    return Number.isFinite(partial) ? Math.max(0, partial) : 0;
  }, [paymentCond, totals.totalPen, paidNow]);

  const creditBalancePen = Math.max(
    0,
    Number((totals.totalPen - paidNowComputed).toFixed(2))
  );

  const handleSelectProductForLine = useCallback(
    (key: string, productIdStr: string) => {
      const pid = productIdStr ? Number(productIdStr) : "";
      const prod = pid ? catalog.find((p) => p.product_id === pid) : undefined;
      setItems((prev) =>
        prev.map((row) =>
          row.key === key
            ? {
                ...row,
                productId: pid,
                unitCostPen:
                  prod?.ref_cost_pen != null
                    ? currency === "USD" && effectiveExchangeRate > 0
                      ? `${Number((prod.ref_cost_pen / effectiveExchangeRate).toFixed(4))}`
                      : `${prod.ref_cost_pen}`
                    : row.unitCostPen,
              }
            : row
        )
      );
    },
    [catalog, currency, effectiveExchangeRate, setItems]
  );

  const handleLineSearchChange = useCallback(
    (key: string, value: string) => {
      setItems((prev) =>
        prev.map((it) => (it.key === key ? { ...it, search: value } : it))
      );
    },
    [setItems]
  );

  const handleLineQuantityChange = useCallback(
    (key: string, value: string) => {
      setItems((prev) =>
        prev.map((it) => (it.key === key ? { ...it, quantity: value } : it))
      );
    },
    [setItems]
  );

  const handleLineUnitCostChange = useCallback(
    (key: string, value: string) => {
      setItems((prev) =>
        prev.map((it) => (it.key === key ? { ...it, unitCostPen: value } : it))
      );
    },
    [setItems]
  );

  const handleRemovePurchaseLine = useCallback(
    (key: string) => {
      setItems((prev) => prev.filter((it) => it.key !== key));
    },
    [setItems]
  );

  function handleAddOnDemandProductToPurchase(od: PendingOnDemandItem) {
    const prod = catalog.find((p) => p.product_id === od.product_id);
    setItems((prev) => {
      const hasBlankOnly = prev.length === 1 && prev[0].productId === "";
      const newLine: PurchaseLineDraft = {
        key: `od-${od.order_line_id}-${Date.now()}`,
        productId: od.product_id,
        search: `${od.sku} ${od.product_name}`,
        quantity: String(Number(od.quantity || 1)),
        unitCostPen:
          prod && prod.ref_cost_pen !== null ? String(prod.ref_cost_pen) : "",
      };
      return hasBlankOnly ? [newLine] : [...prev, newLine];
    });
    setFulfillOrderLineIds((prev) => Array.from(new Set([...prev, od.order_line_id])));
  }

  async function handleRegisterPurchase(e: FormEvent) {
    e.preventDefault();
    if (busyPurchase) return;
    if (!supplierId) {
      onFeedback("Selecciona un proveedor antes de guardar la compra.", true);
      return;
    }
    if (currency === "USD" && effectiveExchangeRate <= 0) {
      onFeedback("Ingresa un tipo de cambio USD válido mayor a 0.", true);
      return;
    }
    const validItems = items
      .filter((it) => it.productId !== "" && Number(it.quantity) > 0)
      .map((it) => ({
        productId: Number(it.productId),
        quantity: Number(it.quantity),
        unitCostPen: Number(it.unitCostPen || 0),
      }));
    if (validItems.length === 0) {
      onFeedback("Agrega al menos un producto con cantidad mayor a 0.", true);
      return;
    }

    if (paymentCond === "PARTIAL") {
      const paidVal = Number(paidNow || 0);
      const msg =
        "En pago parcial, el adelanto debe ser mayor a S/ 0.00 y menor al total.";
      if (!Number.isFinite(paidVal) || paidVal <= 0 || paidVal >= totals.totalPen) {
        onFeedback(msg, true);
        return;
      }
    }

    setBusyPurchase(true);
    try {
      const res = await fetchJson<{ totalPen?: number }>("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register_purchase",
          supplierPartyId: Number(supplierId),
          docType,
          docSeries: docSeries.trim() || "001",
          docNumber: docNumber.trim(),
          issueDate: issueDate || undefined,
          dueDate: dueDate || undefined,
          currency,
          exchangeRate: currency === "USD" ? effectiveExchangeRate : undefined,
          taxMode,
          paymentCondition: paymentCond,
          paidNowPen: paymentCond === "PARTIAL" ? Number(paidNow || 0) : undefined,
          accountId:
            paymentCond !== "CREDIT" && effectiveAccountId
              ? Number(effectiveAccountId)
              : undefined,
          notes: notes || undefined,
          items: validItems,
          fulfillOrderLineIds:
            fulfillOrderLineIds.length > 0 ? fulfillOrderLineIds : undefined,
        }),
      });
      onFeedback(
        `Compra ${formatDocTypeEs(
          docType
        )} ${docSeries}-${docNumber} registrada (${formatPen(
          res.totalPen ?? totals.totalPen
        )}). Inventario actualizado${
          fulfillOrderLineIds.length > 0
            ? ` y ${fulfillOrderLineIds.length} línea(s) bajo pedido marcadas listas.`
            : "."
        }`
      );
      setDocNumber("");
      setDueDate("");
      setCurrency("PEN");
      setExchangeRate("3.75");
      setTaxMode("NONE");
      setPaidNow("");
      setNotes("");
      setItems([
        {
          key: `line-${Date.now()}`,
          productId: "",
          search: "",
          quantity: "1",
          unitCostPen: "",
        },
      ]);
      setFulfillOrderLineIds([]);
      notifyLocalSync(["purchases", "inventory", "treasury", "orders", "partners"]);
      onClose();
      await onRefresh();
    } catch (err) {
      onFeedback(
        err instanceof ApiClientError
          ? err.message
          : "Error de red al registrar la compra.",
        true
      );
    } finally {
      setBusyPurchase(false);
    }
  }

  return (
    <>
      <Card padding="lg" className="border-bht-navy-deep">
        <form onSubmit={handleRegisterPurchase} className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-bht-line pb-3">
            <div>
              <h3 className="text-base font-semibold text-bht-ink-strong">
                Registrar Compra / Ingreso de Mercadería
              </h3>
              <p className="mt-0.5 text-xs text-bht-ink-soft">
                Ingresa mercadería al almacén, actualiza costo ref., genera CxP si es
                crédito/parcial y cierra líneas bajo pedido.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cerrar
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="pur-supplier" required>
                  Proveedor
                </FieldLabel>
                <button
                  type="button"
                  data-compact="true"
                  onClick={() => {
                    setShowNewSupplier(true);
                    onSupplierModalOpenChange?.(true);
                  }}
                  className="text-xs font-semibold text-bht-navy-mid hover:underline cursor-pointer"
                >
                  + Nuevo Proveedor
                </button>
              </div>
              <select
                id="pur-supplier"
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className={`${INPUT_CLASS} mt-1.5 font-medium`}
              >
                <option value="">-- Seleccionar proveedor --</option>
                {mergedSuppliers.map((s) => (
                  <option key={s.party_id} value={String(s.party_id)}>
                    {s.trade_name || s.legal_name}
                    {s.doc_number ? ` (${s.doc_number})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel htmlFor="pur-doctype" required>
                Tipo comprobante
              </FieldLabel>
              <select
                id="pur-doctype"
                value={docType}
                onChange={(e) => setDocType(e.target.value as typeof docType)}
                className={`${INPUT_CLASS} mt-1.5 font-medium`}
              >
                <option value="FACTURA">Factura</option>
                <option value="NOTA_VENTA">Nota de Venta</option>
                <option value="BOLETA">Boleta</option>
                <option value="RECIBO">Recibo</option>
              </select>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <FieldLabel htmlFor="pur-series" required>
                  Serie
                </FieldLabel>
                <input
                  id="pur-series"
                  type="text"
                  required
                  value={docSeries}
                  onChange={(e) => setDocSeries(e.target.value.toUpperCase())}
                  placeholder="F001"
                  className={`${INPUT_CLASS} mt-1.5 font-semibold`}
                />
              </div>
              <div className="col-span-2">
                <FieldLabel htmlFor="pur-number" required>
                  Número
                </FieldLabel>
                <input
                  id="pur-number"
                  type="text"
                  required
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder="000123"
                  className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="pur-issue-date">Fecha emisión</FieldLabel>
              <input
                id="pur-issue-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </div>

            <div>
              <FieldLabel htmlFor="pur-due-date">
                Fecha vencimiento (crédito)
              </FieldLabel>
              <input
                id="pur-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </div>

            <div>
              <FieldLabel htmlFor="pur-currency">Moneda y Tipo de Cambio</FieldLabel>
              <div className="mt-1.5 flex gap-2">
                <select
                  id="pur-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as "PEN" | "USD")}
                  className={`${INPUT_CLASS} w-28 font-semibold`}
                >
                  <option value="PEN">PEN (S/)</option>
                  <option value="USD">USD ($)</option>
                </select>
                {currency === "USD" && (
                  <input
                    id="pur-exchange-rate"
                    type="number"
                    step="0.001"
                    min="0.01"
                    aria-label="Tipo de cambio USD a PEN"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(e.target.value)}
                    placeholder="3.750"
                    className={`${INPUT_CLASS} flex-1 font-semibold tabular-nums`}
                  />
                )}
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="pur-tax-mode">Régimen IGV (18%)</FieldLabel>
              <select
                id="pur-tax-mode"
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value as typeof taxMode)}
                className={`${INPUT_CLASS} mt-1.5`}
              >
                <option value="NONE">Sin IGV / Exonerado</option>
                <option value="INCLUDED">Precios incluyen IGV 18%</option>
                <option value="EXCLUDED">Precios + IGV 18% (agregar)</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <FieldLabel required>Condición de pago</FieldLabel>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {[
                  { id: "CASH", label: "Contado" },
                  { id: "CREDIT", label: "Crédito" },
                  { id: "PARTIAL", label: "Parcial" },
                ].map((c) => {
                  const active = paymentCond === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setPaymentCond(c.id as typeof paymentCond)}
                      className={`rounded-xl border px-2 py-2.5 text-xs font-semibold transition cursor-pointer ${
                        active
                          ? "border-bht-navy-deep bg-bht-navy-deep text-white"
                          : "border-bht-line bg-bht-paper text-bht-ink-soft hover:bg-bht-mist hover:text-bht-navy-deep"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {paymentCond === "PARTIAL" && (
              <div>
                <FieldLabel htmlFor="pur-paid-now" required>
                  Monto pagado hoy (S/)
                </FieldLabel>
                <input
                  id="pur-paid-now"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={paidNow}
                  onChange={(e) => setPaidNow(e.target.value)}
                  placeholder="Mayor a 0 y menor al total"
                  className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
                />
              </div>
            )}

            {paymentCond !== "CREDIT" && (
              <div>
                <FieldLabel htmlFor="pur-account">Cuenta de salida</FieldLabel>
                <select
                  id="pur-account"
                  value={effectiveAccountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className={`${INPUT_CLASS} mt-1.5 font-medium`}
                >
                  {accounts.map((acc) => (
                    <option key={acc.account_id} value={String(acc.account_id)}>
                      {acc.name} ({acc.code})
                      {acc.current_balance_pen !== undefined &&
                      acc.current_balance_pen !== null &&
                      Number.isFinite(Number(acc.current_balance_pen))
                        ? ` · Saldo: ${formatPen(Number(acc.current_balance_pen))}`
                        : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="sm:col-span-2">
              <FieldLabel htmlFor="pur-notes">Notas de compra</FieldLabel>
              <input
                id="pur-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. Reposición campaña / recojo en tienda proveedor"
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </div>
          </div>

          <div className="space-y-2.5 rounded-xl border border-bht-line bg-bht-paper p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-bht-ink-strong">
                Ítems de Compra (Ingreso a Almacén Principal)
              </h4>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setItems((prev) => [
                    ...prev,
                    {
                      key: `line-${Date.now()}-${prev.length}`,
                      productId: "",
                      search: "",
                      quantity: "1",
                      unitCostPen: "",
                    },
                  ])
                }
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Agregar Producto
              </Button>
            </div>

            {items.map((row, idx) => (
              <PurchaseLineRow
                key={row.key}
                row={row}
                idx={idx}
                catalog={catalog}
                canRemove={items.length > 1}
                onSearchChange={handleLineSearchChange}
                onSelectProduct={handleSelectProductForLine}
                onQuantityChange={handleLineQuantityChange}
                onUnitCostChange={handleLineUnitCostChange}
                onRemove={handleRemovePurchaseLine}
              />
            ))}
          </div>

          <PurchaseOnDemandSection
            matchingOnDemandLines={matchingOnDemandLines}
            otherOnDemandLines={otherOnDemandLines}
            fulfillOrderLineIds={fulfillOrderLineIds}
            onSelectAllMatching={setFulfillOrderLineIds}
            onToggleLineId={(id, checked) =>
              setFulfillOrderLineIds((prev) =>
                checked
                  ? Array.from(new Set([...prev, id]))
                  : prev.filter((x) => x !== id)
              )
            }
            onAddOnDemandProduct={handleAddOnDemandProductToPurchase}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bht-navy-deep px-4 py-3.5 text-white">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums">
              {taxMode !== "NONE" && (
                <>
                  <div>
                    <span className="text-white/60">Base Imponible:</span>{" "}
                    <strong>{formatPen(totals.subtotalPen)}</strong>
                  </div>
                  <div>
                    <span className="text-white/60">IGV 18%:</span>{" "}
                    <strong>{formatPen(totals.igvPen)}</strong>
                  </div>
                </>
              )}
              <div>
                <span className="text-white/60">Total Compra:</span>{" "}
                <strong className="text-sm font-semibold">
                  {formatPen(totals.totalPen)}
                  {currency === "USD" && (
                    <span className="ml-1.5 text-xs text-white/75">
                      ($ {totals.origTotal.toFixed(2)})
                    </span>
                  )}
                </strong>
              </div>
              <div>
                <span className="text-white/60">Pago Hoy:</span>{" "}
                <strong className="text-emerald-400">
                  {formatPen(paidNowComputed)}
                </strong>
              </div>
              <div>
                <span className="text-white/60">A Cuentas por Pagar:</span>{" "}
                <strong className="text-amber-400">
                  {formatPen(creditBalancePen)}
                </strong>
              </div>
            </div>
            <Button
              type="submit"
              variant="success"
              size="md"
              disabled={busyPurchase}
              className="w-full sm:w-auto"
            >
              {busyPurchase ? "Registrando Compra..." : "Confirmar Compra e Ingreso"}
            </Button>
          </div>
        </form>
      </Card>

      {showNewSupplier && (
        <SupplierFormModal
          open
          mode="create"
          onClose={() => {
            setShowNewSupplier(false);
            onSupplierModalOpenChange?.(false);
          }}
          onSaved={(saved) => {
            setLocalSuppliers((prev) => [
              ...prev.filter((s) => s.party_id !== saved.party_id),
              {
                party_id: saved.party_id,
                legal_name: saved.legal_name,
                trade_name: saved.trade_name,
                doc_type: saved.doc_type,
                doc_number: saved.doc_number,
                phone: saved.phone,
                address: saved.address,
                open_ap_balance_pen: saved.open_ap_balance_pen,
                open_docs_count: saved.open_docs_count,
              },
            ]);
            setSupplierId(String(saved.party_id));
            onFeedback(`Proveedor "${saved.display_name}" agregado y seleccionado.`);
            void onRefresh();
          }}
        />
      )}
    </>
  );
}
