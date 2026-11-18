"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ChevronRightIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { formatApStatusEs, formatDocTypeEs, normalizeUiNoteEs } from "@/lib/labels-es";
import {
  formatPen,
  type ApObligationItem,
  type CashAccountItem,
  type PartnerCatalogItem,
  type PendingOnDemandItem,
  type RecentPurchaseItem,
  type SupplierItem,
} from "../types";
import {
  ApObligationDetailModal,
  ApPaymentModal,
  PurchaseDetailModal,
} from "./CajaDetailModals";
import { CajaPurchaseForm } from "./CajaPurchaseForm";
import type { PurchaseLineDraft } from "./caja-utils";

export function CajaComprasTab({
  catalog,
  accounts,
  apObligations,
  suppliers,
  recentPurchases,
  pendingOnDemand,
  defaultAccountId,
  preselectedTarget,
  onClearPreselectedTarget,
  onOpenDirectory,
  onRefresh,
  onFeedback,
  onEditingChange,
}: {
  catalog: PartnerCatalogItem[];
  accounts: CashAccountItem[];
  apObligations: ApObligationItem[];
  suppliers: SupplierItem[];
  recentPurchases: RecentPurchaseItem[];
  pendingOnDemand: PendingOnDemandItem[];
  defaultAccountId: string;
  preselectedTarget: {
    productId: number;
    quantity?: number;
    orderLineId?: number;
  } | null;
  onClearPreselectedTarget: () => void;
  onOpenDirectory: () => void;
  onRefresh: () => Promise<void>;
  onFeedback: (msg: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purItems, setPurItems] = useState<PurchaseLineDraft[]>([
    { key: "line-1", productId: "", search: "", quantity: "1", unitCostPen: "" },
  ]);
  const [fulfillOrderLineIds, setFulfillOrderLineIds] = useState<number[]>([]);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);

  const [apStatusFilter, setApStatusFilter] = useState<
    "UNPAID" | "OPEN" | "PARTIAL" | "PAID" | "ALL"
  >("UNPAID");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [apSearch, setApSearch] = useState("");
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const deferredApSearch = useDeferredValue(apSearch);
  const deferredPurchaseSearch = useDeferredValue(purchaseSearch);

  const [detailAp, setDetailAp] = useState<ApObligationItem | null>(null);
  const [payingAp, setPayingAp] = useState<ApObligationItem | null>(null);
  const [detailPurchase, setDetailPurchase] = useState<RecentPurchaseItem | null>(null);

  useEffect(() => {
    onEditingChange?.(Boolean(showPurchaseForm || supplierModalOpen || payingAp));
    return () => onEditingChange?.(false);
  }, [showPurchaseForm, supplierModalOpen, payingAp, onEditingChange]);

  useEffect(() => {
    if (!preselectedTarget) return;
    const prod = catalog.find((p) => p.product_id === preselectedTarget.productId);
    if (prod) {
      const nextQty =
        preselectedTarget.quantity && preselectedTarget.quantity > 0
          ? preselectedTarget.quantity
          : 1;
      setShowPurchaseForm(true);
      setPurItems([
        {
          key: `pre-${Date.now()}`,
          productId: prod.product_id,
          search: `${prod.sku} ${prod.name}`,
          quantity: String(nextQty),
          unitCostPen: prod.ref_cost_pen !== null ? String(prod.ref_cost_pen) : "",
        },
      ]);
      if (
        preselectedTarget.orderLineId &&
        pendingOnDemand.some((od) => od.order_line_id === preselectedTarget.orderLineId)
      ) {
        setFulfillOrderLineIds([preselectedTarget.orderLineId]);
      } else {
        setFulfillOrderLineIds([]);
      }
    }
    onClearPreselectedTarget();
  }, [preselectedTarget, catalog, pendingOnDemand, onClearPreselectedTarget]);

  function handleQuickPurchaseOnDemand(od: PendingOnDemandItem) {
    const prod = catalog.find((p) => p.product_id === od.product_id);
    setShowPurchaseForm(true);
    setPurItems((prev) => {
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

  const filteredApObligations = useMemo(() => {
    const q = deferredApSearch.trim().toLowerCase();
    return apObligations.filter((ap) => {
      if (
        selectedSupplierId &&
        Number(ap.supplier_party_id) !== Number(selectedSupplierId)
      ) {
        return false;
      }
      if (apStatusFilter === "UNPAID") {
        if (ap.status !== "OPEN" && ap.status !== "PARTIAL") return false;
      } else if (apStatusFilter !== "ALL" && ap.status !== apStatusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        ap.supplier_name.toLowerCase().includes(q) ||
        ap.doc_ref.toLowerCase().includes(q) ||
        (ap.notes ? ap.notes.toLowerCase().includes(q) : false)
      );
    });
  }, [apObligations, apStatusFilter, selectedSupplierId, deferredApSearch]);

  const filteredRecentPurchases = useMemo(() => {
    const q = deferredPurchaseSearch.trim().toLowerCase();
    if (!q) return recentPurchases;
    return recentPurchases.filter((pur) => {
      const doc = `${pur.doc_series}-${pur.doc_number}`.toLowerCase();
      const sup = (pur.supplier_name || pur.supplier_ruc || "").toLowerCase();
      return (
        doc.includes(q) ||
        sup.includes(q) ||
        formatDocTypeEs(pur.doc_type).toLowerCase().includes(q)
      );
    });
  }, [recentPurchases, deferredPurchaseSearch]);

  return (
    <div className="space-y-4">
      <Card padding="md" className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
            Compras de Mercadería y Cuentas por Pagar (CxP)
          </h3>
          <p className="text-xs text-bht-ink-soft">
            Registra ingresos de almacén, controla facturas por pagar y abona desde
            cualquier cuenta.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onOpenDirectory}>
            Proveedores en Directorio →
          </Button>
          <Button
            variant={showPurchaseForm ? "secondary" : "primary"}
            size="md"
            onClick={() => setShowPurchaseForm((prev) => !prev)}
          >
            {showPurchaseForm ? (
              <>
                <CloseIcon className="h-3.5 w-3.5" />
                Cerrar Compra
              </>
            ) : (
              <>
                <PlusIcon className="h-3.5 w-3.5" />
                Registrar Compra / Ingreso
              </>
            )}
          </Button>
        </div>
      </Card>

      {pendingOnDemand.length > 0 && !showPurchaseForm && (
        <Card tone="warning" padding="sm" className="space-y-2">
          <p className="text-xs font-semibold text-bht-ink-strong">
            Pedidos bajo pedido pendientes por surtir ({pendingOnDemand.length}):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {pendingOnDemand.slice(0, 6).map((od) => (
              <Button
                key={od.order_line_id}
                variant="outline"
                size="sm"
                onClick={() => handleQuickPurchaseOnDemand(od)}
              >
                <PlusIcon className="h-3 w-3" />
                {od.sku} (×{Number(od.quantity)} {od.unit_of_measure || "NIU"} ·{" "}
                {od.order_code})
              </Button>
            ))}
          </div>
        </Card>
      )}

      {showPurchaseForm && (
        <CajaPurchaseForm
          catalog={catalog}
          accounts={accounts}
          suppliers={suppliers}
          pendingOnDemand={pendingOnDemand}
          defaultAccountId={defaultAccountId}
          items={purItems}
          setItems={setPurItems}
          fulfillOrderLineIds={fulfillOrderLineIds}
          setFulfillOrderLineIds={setFulfillOrderLineIds}
          onClose={() => setShowPurchaseForm(false)}
          onRefresh={onRefresh}
          onFeedback={onFeedback}
          onSupplierModalOpenChange={setSupplierModalOpen}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
              Obligaciones por Pagar (CxP) ({filteredApObligations.length})
            </h3>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
                <SearchIcon className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={apSearch}
                onChange={(e) => setApSearch(e.target.value)}
                aria-label="Buscar proveedor o comprobante en cuentas por pagar"
                placeholder="Buscar comprobante o nota..."
                className={`${INPUT_CLASS} py-2 pl-10 pr-8 text-xs`}
              />
              {apSearch && (
                <button
                  type="button"
                  data-compact="true"
                  aria-label="Limpiar búsqueda de cuentas por pagar"
                  onClick={() => setApSearch("")}
                  className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <select
              aria-label="Filtrar CxP por proveedor"
              value={selectedSupplierId}
              onChange={(e) => setSelectedSupplierId(e.target.value)}
              className={`${INPUT_CLASS} py-2 text-xs font-medium`}
            >
              <option value="">Todos los proveedores ({suppliers.length})</option>
              {suppliers.map((s) => (
                <option key={s.party_id} value={String(s.party_id)}>
                  {s.trade_name || s.legal_name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "UNPAID", label: "Todas por pagar" },
              { id: "OPEN", label: "Sin abonos" },
              { id: "PARTIAL", label: "Con abono parcial" },
              { id: "PAID", label: "Pagadas" },
              { id: "ALL", label: "Todas" },
            ].map((f) => {
              const active = apStatusFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setApStatusFilter(f.id as typeof apStatusFilter)}
                  className={`min-h-[36px] sm:min-h-0 rounded-full border px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                    active
                      ? "border-bht-navy-deep bg-bht-navy-deep text-white"
                      : "border-bht-line bg-white text-bht-ink-soft hover:bg-bht-mist hover:text-bht-navy-deep"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="space-y-2.5 md:max-h-[34rem] md:overflow-y-auto md:pr-1">
            {filteredApObligations.length === 0 ? (
              <EmptyState title="No hay obligaciones en este filtro" />
            ) : (
              filteredApObligations.map((ap) => {
                const canPay = ap.status === "OPEN" || ap.status === "PARTIAL";
                const statusTone =
                  ap.status === "PAID"
                    ? "success"
                    : ap.status === "PARTIAL"
                      ? "warning"
                      : "danger";
                const itemCount = Array.isArray(ap.lines)
                  ? ap.lines.length
                  : Number(ap.line_count ?? 0);
                return (
                  <div
                    key={ap.ap_id}
                    className="space-y-2 rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs transition hover:border-bht-line-blue"
                  >
                    <button
                      type="button"
                      onClick={() => setDetailAp(ap)}
                      aria-label={`Ver detalle de lo pedido y deuda de ${ap.doc_ref} (${ap.supplier_name})`}
                      className="w-full space-y-2 rounded-lg text-left transition hover:bg-bht-mist/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep/45 cursor-pointer"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-bht-ink-strong">
                            {ap.supplier_name}
                          </p>
                          <p className="mt-0.5 text-xs font-medium text-bht-navy-mid tabular-nums">
                            {ap.doc_ref} · Emisión: {ap.issue_date}
                            {ap.due_date ? ` · Vence: ${ap.due_date}` : ""}
                          </p>
                        </div>
                        <Badge tone={statusTone}>{formatApStatusEs(ap.status)}</Badge>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-bht-ink-soft tabular-nums">
                        <span>
                          Original:{" "}
                          <strong className="text-bht-ink-strong">
                            {formatPen(ap.original_amount_pen)}
                          </strong>{" "}
                          · Pagado:{" "}
                          <strong className="text-bht-ink-strong">
                            {formatPen(ap.paid_amount_pen)}
                          </strong>
                        </span>
                        <span className="font-semibold text-bht-danger">
                          Saldo: {formatPen(ap.balance_due_pen)}
                        </span>
                      </div>

                      {ap.notes && (
                        <p className="text-xs text-bht-ink-muted">
                          Nota: {normalizeUiNoteEs(ap.notes)}
                        </p>
                      )}

                      <span className="inline-flex items-center gap-1 text-xs font-medium text-bht-navy-mid">
                        Ver detalle ({itemCount} {itemCount === 1 ? "ítem" : "ítems"}) y
                        pagos
                        <ChevronRightIcon className="h-3 w-3" />
                      </span>
                    </button>

                    {canPay && (
                      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bht-line/80 pt-2">
                        <Button
                          variant="success"
                          size="sm"
                          aria-label={`Pagar o amortizar ${ap.doc_ref} de ${ap.supplier_name}`}
                          onClick={() => setPayingAp(ap)}
                        >
                          <PlusIcon className="h-3.5 w-3.5" />
                          Pagar / Amortizar
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card padding="md" className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
              Historial de Compras Registradas ({filteredRecentPurchases.length}
              {purchaseSearch ? ` / ${recentPurchases.length}` : ""})
            </h3>
            <p className="text-xs text-bht-ink-soft">
              Toca cualquier comprobante para ver los ítems ingresados y montos.
            </p>
          </div>

          {recentPurchases.length > 0 && (
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
                <SearchIcon className="h-4 w-4" />
              </span>
              <input
                type="text"
                value={purchaseSearch}
                onChange={(e) => setPurchaseSearch(e.target.value)}
                aria-label="Filtrar compras recientes"
                placeholder="Buscar compra por comprobante o proveedor..."
                className={`${INPUT_CLASS} py-2 pl-10 pr-8 text-xs`}
              />
              {purchaseSearch && (
                <button
                  type="button"
                  data-compact="true"
                  aria-label="Limpiar búsqueda de compras"
                  onClick={() => setPurchaseSearch("")}
                  className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {filteredRecentPurchases.length === 0 ? (
            <EmptyState
              title={
                purchaseSearch
                  ? "No hay compras que coincidan con tu búsqueda"
                  : "Sin compras recientes registradas"
              }
            />
          ) : (
            <div className="md:max-h-[34rem] md:overflow-y-auto md:pr-1">
              <div className="space-y-2 md:hidden">
                {filteredRecentPurchases.map((pur) => (
                  <button
                    key={pur.purchase_id}
                    type="button"
                    onClick={() => setDetailPurchase(pur)}
                    aria-label={`Ver detalle de compra ${pur.doc_series}-${pur.doc_number}`}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper p-3 text-left text-xs transition hover:border-bht-line-blue hover:bg-bht-mist/70 cursor-pointer"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-bht-ink-strong">
                        {formatDocTypeEs(pur.doc_type)} {pur.doc_series}-
                        {pur.doc_number}
                      </p>
                      <p className="truncate text-bht-ink-soft">
                        {pur.supplier_name || pur.supplier_ruc || "-"} ·{" "}
                        {pur.issue_date}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right tabular-nums">
                      <p className="font-semibold text-bht-ink-strong">
                        {formatPen(pur.total_pen)}
                      </p>
                      <p className="text-xs font-medium text-bht-navy-mid">
                        {Number(pur.line_count ?? 0)} ítem(s) →
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              <div
                tabIndex={0}
                role="region"
                aria-label="Compras recientes a proveedores"
                className="table-wrapper hidden md:block"
              >
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-bht-line bg-bht-paper text-xs font-semibold uppercase tracking-wide text-bht-ink-soft">
                    <tr>
                      <th scope="col" className="whitespace-nowrap p-2">
                        Comprobante / Fecha
                      </th>
                      <th scope="col" className="whitespace-nowrap p-2">
                        Proveedor
                      </th>
                      <th scope="col" className="whitespace-nowrap p-2 text-right">
                        Ítems
                      </th>
                      <th scope="col" className="whitespace-nowrap p-2 text-right">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bht-line">
                    {filteredRecentPurchases.map((pur) => (
                      <tr
                        key={pur.purchase_id}
                        onClick={() => setDetailPurchase(pur)}
                        className="cursor-pointer transition hover:bg-bht-mist/70"
                      >
                        <td className="whitespace-nowrap p-2 font-semibold text-bht-navy-mid">
                          <button
                            type="button"
                            data-compact="true"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDetailPurchase(pur);
                            }}
                            className="text-left hover:underline cursor-pointer"
                          >
                            {formatDocTypeEs(pur.doc_type)} {pur.doc_series}-
                            {pur.doc_number}
                          </button>
                          <span className="block text-xs font-normal text-bht-ink-muted tabular-nums">
                            {pur.issue_date}
                          </span>
                        </td>
                        <td className="p-2 font-medium text-bht-ink-soft">
                          {pur.supplier_name || pur.supplier_ruc || "-"}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {Number(pur.line_count ?? 0)}
                        </td>
                        <td className="p-2 text-right font-semibold text-bht-ink-strong tabular-nums">
                          {formatPen(pur.total_pen)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>

      <ApObligationDetailModal
        obligation={detailAp}
        onClose={() => setDetailAp(null)}
        onRequestPay={(ap) => setPayingAp(ap)}
      />

      <ApPaymentModal
        payingAp={payingAp}
        accounts={accounts}
        defaultAccountId={defaultAccountId}
        onClose={() => setPayingAp(null)}
        onFeedback={onFeedback}
        onRefresh={onRefresh}
      />

      <PurchaseDetailModal
        purchase={detailPurchase}
        onClose={() => setDetailPurchase(null)}
      />
    </div>
  );
}
