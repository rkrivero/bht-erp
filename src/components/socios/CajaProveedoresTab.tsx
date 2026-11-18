"use client";

import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ChevronRightIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import {
  formatApStatusEs,
  formatCashDirectionEs,
  formatDocTypeEs,
  formatExpenseCategoryEs,
  formatFulfillmentModeEs,
  normalizeUiNoteEs,
} from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import {
  OUTFLOW_CATEGORIES_BY_BUCKET,
  type OutflowBucket,
} from "@/lib/treasury-constants";
import {
  type ApObligationItem,
  type CashAccountItem,
  type CashLedgerEntry,
  type PartnerCatalogItem,
  type PendingOnDemandItem,
  type PurchaseInvoiceLineItem,
  type RecentPurchaseItem,
  type SupplierItem,
  formatPen,
} from "./types";

interface PurchaseLineDraft {
  key: string;
  productId: number | "";
  search: string;
  quantity: string;
  unitCostPen: string;
}

interface CajaProveedoresTabProps {
  catalog: PartnerCatalogItem[];
  accounts: CashAccountItem[];
  ledger: CashLedgerEntry[];
  apObligations: ApObligationItem[];
  suppliers: SupplierItem[];
  recentPurchases: RecentPurchaseItem[];
  pendingOnDemand: PendingOnDemandItem[];
  preselectedTarget: {
    productId: number;
    quantity?: number;
    orderLineId?: number;
  } | null;
  onClearPreselectedTarget: () => void;
  onRefresh: () => Promise<void>;
  onFeedback: (msg: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}

function getTodayLimaIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
  }).format(new Date());
}

function InvoiceLinesBreakdown({
  lines,
  emptyMessage,
}: {
  lines?: PurchaseInvoiceLineItem[];
  emptyMessage: string;
}) {
  const safeLines = Array.isArray(lines) ? lines : [];
  if (safeLines.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-bht-line-strong bg-bht-paper px-3 py-2.5 text-xs text-bht-ink-soft">
        {emptyMessage}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {safeLines.map((ln, idx) => (
        <div
          key={ln.purchase_line_id || `${ln.line_no}-${idx}`}
          className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper px-3 py-2 text-xs"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-bht-ink-strong">{ln.raw_description}</p>
            <p className="mt-0.5 text-xs text-bht-ink-soft tabular-nums">
              {ln.sku ? `${ln.sku} · ` : ""}
              {Number(ln.quantity)} {ln.unit_of_measure || "NIU"} ×{" "}
              {formatPen(ln.unit_cost_pen)}
            </p>
          </div>
          <span className="flex-shrink-0 font-semibold text-bht-ink-strong tabular-nums">
            {formatPen(ln.line_total_pen)}
          </span>
        </div>
      ))}
    </div>
  );
}

const PurchaseLineRow = React.memo(function PurchaseLineRow({
  row,
  idx,
  catalog,
  canRemove,
  onSearchChange,
  onSelectProduct,
  onQuantityChange,
  onUnitCostChange,
  onRemove,
}: {
  row: PurchaseLineDraft;
  idx: number;
  catalog: PartnerCatalogItem[];
  canRemove: boolean;
  onSearchChange: (key: string, value: string) => void;
  onSelectProduct: (key: string, productIdStr: string) => void;
  onQuantityChange: (key: string, value: string) => void;
  onUnitCostChange: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}) {
  const deferredSearch = useDeferredValue(row.search);

  const filteredProds = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.product_id === row.productId
    );
  }, [catalog, deferredSearch, row.productId]);

  const selectedProd = useMemo(
    () =>
      row.productId ? catalog.find((p) => p.product_id === row.productId) : undefined,
    [catalog, row.productId]
  );

  const lineSubtotal = Number(row.quantity || 0) * Number(row.unitCostPen || 0);
  const searchInputId = `pur-line-search-${row.key}`;
  const selectProdId = `pur-line-prod-${row.key}`;
  const qtyInputId = `pur-line-qty-${row.key}`;
  const costInputId = `pur-line-cost-${row.key}`;

  return (
    <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-bht-line bg-white p-3 sm:grid-cols-12 sm:items-end">
      <div className="sm:col-span-6 space-y-1.5 min-w-0">
        <FieldLabel htmlFor={searchInputId}>
          Producto #{idx + 1} (Filtra por nombre o código)
        </FieldLabel>
        <input
          id={searchInputId}
          type="text"
          value={row.search}
          onChange={(e) => onSearchChange(row.key, e.target.value)}
          placeholder="Buscar código o producto..."
          className={`${INPUT_CLASS} py-2 text-xs`}
        />
        <label htmlFor={selectProdId} className="sr-only">
          Seleccionar producto #{idx + 1}
        </label>
        <select
          id={selectProdId}
          required
          value={row.productId === "" ? "" : String(row.productId)}
          onChange={(e) => onSelectProduct(row.key, e.target.value)}
          className={`${INPUT_CLASS} min-w-0 w-full py-2 text-xs font-medium`}
        >
          <option value="">-- Elegir producto --</option>
          {filteredProds.map((p) => (
            <option key={p.product_id} value={String(p.product_id)}>
              {p.sku} — {p.name} (Stock: {p.stock_on_hand} {p.unit_of_measure} ·{" "}
              {formatFulfillmentModeEs(p.fulfillment_mode)})
            </option>
          ))}
        </select>
        {selectedProd && (
          <p className="text-xs text-bht-ink-soft tabular-nums">
            Stock actual:{" "}
            <strong className="text-bht-ink-strong">
              {selectedProd.stock_on_hand}
            </strong>{" "}
            {selectedProd.unit_of_measure} · Costo ref:{" "}
            {selectedProd.ref_cost_pen !== null
              ? formatPen(selectedProd.ref_cost_pen)
              : "Sin costo"}
          </p>
        )}
      </div>

      <div className="min-w-0 sm:col-span-2">
        <FieldLabel htmlFor={qtyInputId} required>
          Cantidad{selectedProd ? ` (${selectedProd.unit_of_measure})` : ""}
        </FieldLabel>
        <input
          id={qtyInputId}
          type="number"
          step="any"
          min="0.01"
          required
          value={row.quantity}
          onChange={(e) => onQuantityChange(row.key, e.target.value)}
          className={`${INPUT_CLASS} mt-1 font-semibold tabular-nums`}
        />
      </div>

      <div className="sm:col-span-2">
        <FieldLabel htmlFor={costInputId} required>
          Costo Unit. (S/)
        </FieldLabel>
        <input
          id={costInputId}
          type="number"
          step="0.01"
          min="0"
          required
          value={row.unitCostPen}
          onChange={(e) => onUnitCostChange(row.key, e.target.value)}
          placeholder="0.00"
          className={`${INPUT_CLASS} mt-1 font-semibold tabular-nums`}
        />
      </div>

      <div className="flex items-center justify-between gap-2 sm:col-span-2 sm:flex-col sm:items-end">
        <span className="text-xs font-semibold text-bht-ink-strong tabular-nums">
          {formatPen(Number.isFinite(lineSubtotal) ? lineSubtotal : 0)}
        </span>
        {canRemove && (
          <button
            type="button"
            data-compact="true"
            aria-label={`Quitar producto #${idx + 1}`}
            onClick={() => onRemove(row.key)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-bht-danger hover:bg-bht-danger-bg cursor-pointer"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Quitar
          </button>
        )}
      </div>
    </div>
  );
});

export default function CajaProveedoresTab({
  catalog,
  accounts,
  ledger,
  apObligations,
  suppliers,
  recentPurchases,
  pendingOnDemand,
  preselectedTarget,
  onClearPreselectedTarget,
  onRefresh,
  onFeedback,
  onEditingChange,
}: CajaProveedoresTabProps) {
  const [apStatusFilter, setApStatusFilter] = useState<
    "UNPAID" | "OPEN" | "PARTIAL" | "PAID" | "ALL"
  >("UNPAID");
  const [selectedSupplierFilterId, setSelectedSupplierFilterId] = useState<
    number | null
  >(null);
  const [apSearch, setApSearch] = useState("");
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [ledgerSearch, setLedgerSearch] = useState("");
  const deferredApSearch = useDeferredValue(apSearch);
  const deferredPurchaseSearch = useDeferredValue(purchaseSearch);
  const deferredLedgerSearch = useDeferredValue(ledgerSearch);

  // Detail modal state (AP obligation or Recent Purchase)
  const [detailAp, setDetailAp] = useState<ApObligationItem | null>(null);
  const [detailPurchase, setDetailPurchase] = useState<RecentPurchaseItem | null>(null);

  // Pay AP modal state
  const [payingAp, setPayingAp] = useState<ApObligationItem | null>(null);
  const [apPayAmount, setApPayAmount] = useState("");
  const [apPayAccountId, setApPayAccountId] = useState<string>("");
  const [apPayNotes, setApPayNotes] = useState("");
  const [busyApPay, setBusyApPay] = useState(false);
  const [confirmApPayment, setConfirmApPayment] = useState(false);

  // Create Supplier modal state
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [supLegalName, setSupLegalName] = useState("");
  const [supTradeName, setSupTradeName] = useState("");
  const [supDocType, setSupDocType] = useState<
    "RUC" | "DNI" | "CE" | "PASSPORT" | "NONE"
  >("RUC");
  const [supDocNumber, setSupDocNumber] = useState("");
  const [supPhone, setSupPhone] = useState("");
  const [supAddress, setSupAddress] = useState("");
  const [supNotes, setSupNotes] = useState("");
  const [busySupplier, setBusySupplier] = useState(false);

  // Register Purchase form state
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [purSupplierId, setPurSupplierId] = useState<string>("");
  const [purDocType, setPurDocType] = useState<
    "FACTURA" | "NOTA_VENTA" | "BOLETA" | "RECIBO"
  >("FACTURA");
  const [purDocSeries, setPurDocSeries] = useState("F001");
  const [purDocNumber, setPurDocNumber] = useState("");
  const [purIssueDate, setPurIssueDate] = useState(getTodayLimaIso());
  const [purDueDate, setPurDueDate] = useState("");
  const [purCurrency, setPurCurrency] = useState<"PEN" | "USD">("PEN");
  const [purExchangeRate, setPurExchangeRate] = useState("3.75");
  const [purTaxMode, setPurTaxMode] = useState<"NONE" | "INCLUDED" | "EXCLUDED">(
    "NONE"
  );
  const [purPaymentCond, setPurPaymentCond] = useState<"CASH" | "CREDIT" | "PARTIAL">(
    "CASH"
  );
  const [purPaidNow, setPurPaidNow] = useState("");
  const [purAccountId, setPurAccountId] = useState<string>("");
  const [purNotes, setPurNotes] = useState("");
  const [purItems, setPurItems] = useState<PurchaseLineDraft[]>([
    { key: "line-1", productId: "", search: "", quantity: "1", unitCostPen: "" },
  ]);
  const [fulfillOrderLineIds, setFulfillOrderLineIds] = useState<number[]>([]);
  const [busyPurchase, setBusyPurchase] = useState(false);

  // Treasury Outflow state
  const [outflowIsTransfer, setOutflowIsTransfer] = useState(false);
  const [outflowBucket, setOutflowBucket] = useState<OutflowBucket>("ROUTE_OPEX");
  const [outflowCategory, setOutflowCategory] = useState<string>(
    OUTFLOW_CATEGORIES_BY_BUCKET.ROUTE_OPEX[0].value
  );
  const [outflowDate, setOutflowDate] = useState(getTodayLimaIso());
  const [outflowAmount, setOutflowAmount] = useState("");
  const [outflowAccountId, setOutflowAccountId] = useState<string>("");
  const [outflowToAccountId, setOutflowToAccountId] = useState<string>("");
  const [outflowDesc, setOutflowDesc] = useState("");
  const [busyOutflow, setBusyOutflow] = useState(false);
  const [confirmOutflow, setConfirmOutflow] = useState(false);

  useEffect(() => {
    onEditingChange?.(
      Boolean(
        showPurchaseForm ||
        showNewSupplier ||
        payingAp ||
        outflowIsTransfer ||
        outflowAmount.trim() ||
        outflowDesc.trim()
      )
    );
  }, [
    showPurchaseForm,
    showNewSupplier,
    payingAp,
    outflowIsTransfer,
    outflowAmount,
    outflowDesc,
    onEditingChange,
  ]);

  useEffect(() => {
    return () => onEditingChange?.(false);
  }, [onEditingChange]);

  useEffect(() => {
    if (accounts.length > 0) {
      const defaultAcc = accounts.find((a) => a.code === "CAJA_RUTA") || accounts[0];
      const defId = String(defaultAcc.account_id);
      if (!apPayAccountId) setApPayAccountId(defId);
      if (!purAccountId) setPurAccountId(defId);
      if (!outflowAccountId) setOutflowAccountId(defId);
      const effectiveFromId = outflowAccountId || defId;
      if (!outflowToAccountId || outflowToAccountId === effectiveFromId) {
        const altAcc = accounts.find((a) => String(a.account_id) !== effectiveFromId);
        if (altAcc) setOutflowToAccountId(String(altAcc.account_id));
      }
    }
  }, [accounts, apPayAccountId, purAccountId, outflowAccountId, outflowToAccountId]);

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

  const selectedProductIds = useMemo(
    () =>
      purItems
        .map((it) => Number(it.productId))
        .filter((id) => Number.isFinite(id) && id > 0),
    [purItems]
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
    if (purCurrency !== "USD") return 1;
    const n = Number(purExchangeRate || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [purCurrency, purExchangeRate]);

  const purchaseOrigBase = useMemo(
    () =>
      purItems.reduce((sum, item) => {
        const qty = Number(item.quantity || 0);
        const cost = Number(item.unitCostPen || 0);
        if (!Number.isFinite(qty) || !Number.isFinite(cost)) return sum;
        return sum + Math.max(0, qty) * Math.max(0, cost);
      }, 0),
    [purItems]
  );

  const { purchaseSubtotalPen, purchaseIgvPen, purchaseTotalPen, purchaseOrigTotal } =
    useMemo(() => {
      const rate = effectiveExchangeRate > 0 ? effectiveExchangeRate : 0;
      const rawNetPen = Number((purchaseOrigBase * rate).toFixed(2));
      if (purTaxMode === "INCLUDED") {
        const tot = rawNetPen;
        const sub = Number((tot / 1.18).toFixed(2));
        const igv = Number((tot - sub).toFixed(2));
        return {
          purchaseSubtotalPen: sub,
          purchaseIgvPen: igv,
          purchaseTotalPen: tot,
          purchaseOrigTotal: Number(purchaseOrigBase.toFixed(2)),
        };
      }
      if (purTaxMode === "EXCLUDED") {
        const sub = rawNetPen;
        const igv = Number((sub * 0.18).toFixed(2));
        const tot = Number((sub + igv).toFixed(2));
        return {
          purchaseSubtotalPen: sub,
          purchaseIgvPen: igv,
          purchaseTotalPen: tot,
          purchaseOrigTotal: Number((purchaseOrigBase * 1.18).toFixed(2)),
        };
      }
      return {
        purchaseSubtotalPen: rawNetPen,
        purchaseIgvPen: 0,
        purchaseTotalPen: rawNetPen,
        purchaseOrigTotal: Number(purchaseOrigBase.toFixed(2)),
      };
    }, [purchaseOrigBase, effectiveExchangeRate, purTaxMode]);

  const purchasePaidNowComputed = useMemo(() => {
    if (purPaymentCond === "CASH") return purchaseTotalPen;
    if (purPaymentCond === "CREDIT") return 0;
    const partial = Number(purPaidNow || 0);
    return Number.isFinite(partial) ? Math.max(0, partial) : 0;
  }, [purPaymentCond, purchaseTotalPen, purPaidNow]);

  const purchaseCreditBalancePen = Math.max(
    0,
    Number((purchaseTotalPen - purchasePaidNowComputed).toFixed(2))
  );

  const totalOpenApPen = useMemo(
    () =>
      apObligations
        .filter((ap) => ap.status === "OPEN" || ap.status === "PARTIAL")
        .reduce((s, ap) => s + Number(ap.balance_due_pen ?? 0), 0),
    [apObligations]
  );

  const openDocsCount = useMemo(
    () =>
      apObligations.filter((ap) => ap.status === "OPEN" || ap.status === "PARTIAL")
        .length,
    [apObligations]
  );

  const apPayAccount = accounts.find(
    (account) => String(account.account_id) === apPayAccountId
  );
  const apPayBalanceAfter = payingAp
    ? Math.max(0, Number(payingAp.balance_due_pen) - Number(apPayAmount || 0))
    : 0;

  const filteredApObligations = useMemo(() => {
    const q = deferredApSearch.trim().toLowerCase();
    return apObligations.filter((ap) => {
      if (
        selectedSupplierFilterId !== null &&
        Number(ap.supplier_party_id) !== selectedSupplierFilterId
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
  }, [apObligations, apStatusFilter, selectedSupplierFilterId, deferredApSearch]);

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

  const filteredLedger = useMemo(() => {
    const q = deferredLedgerSearch.trim().toLowerCase();
    if (!q) return ledger;
    return ledger.filter((mov) => {
      const cat = formatExpenseCategoryEs(mov.expense_category).toLowerCase();
      return (
        mov.description.toLowerCase().includes(q) ||
        mov.account_name.toLowerCase().includes(q) ||
        cat.includes(q) ||
        mov.tx_date.toLowerCase().includes(q)
      );
    });
  }, [ledger, deferredLedgerSearch]);

  const handleSelectProductForLine = useCallback(
    (key: string, productIdStr: string) => {
      const pid = productIdStr ? Number(productIdStr) : "";
      const prod = pid ? catalog.find((p) => p.product_id === pid) : undefined;
      setPurItems((prev) =>
        prev.map((row) =>
          row.key === key
            ? {
                ...row,
                productId: pid,
                unitCostPen:
                  prod && prod.ref_cost_pen !== null
                    ? String(prod.ref_cost_pen)
                    : row.unitCostPen,
              }
            : row
        )
      );
    },
    [catalog]
  );

  const handleLineSearchChange = useCallback((key: string, value: string) => {
    setPurItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, search: value } : it))
    );
  }, []);

  const handleLineQuantityChange = useCallback((key: string, value: string) => {
    setPurItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, quantity: value } : it))
    );
  }, []);

  const handleLineUnitCostChange = useCallback((key: string, value: string) => {
    setPurItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, unitCostPen: value } : it))
    );
  }, []);

  const handleRemovePurchaseLine = useCallback((key: string) => {
    setPurItems((prev) => prev.filter((it) => it.key !== key));
  }, []);

  function handleAddOnDemandProductToPurchase(od: PendingOnDemandItem) {
    setShowPurchaseForm(true);
    const prod = catalog.find((p) => p.product_id === od.product_id);
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

  async function handleCreateSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (busySupplier) return;
    setBusySupplier(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_supplier",
          legalName: supLegalName,
          tradeName: supTradeName || undefined,
          docType: supDocType,
          docNumber: supDocType === "NONE" ? undefined : supDocNumber || undefined,
          phone: supPhone || undefined,
          address: supAddress || undefined,
          notes: supNotes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onFeedback(data.error || "Error al crear proveedor", true);
        return;
      }
      onFeedback(
        `Proveedor "${
          data.supplier?.trade_name || data.supplier?.legal_name || supLegalName
        }" registrado.`
      );
      if (data.supplier?.party_id) {
        setPurSupplierId(String(data.supplier.party_id));
      }
      setSupLegalName("");
      setSupTradeName("");
      setSupDocNumber("");
      setSupPhone("");
      setSupAddress("");
      setSupNotes("");
      setShowNewSupplier(false);
      notifyLocalSync(["purchases", "partners"]);
      await onRefresh();
    } catch {
      onFeedback("Error de red al registrar proveedor.", true);
    } finally {
      setBusySupplier(false);
    }
  }

  async function handleRegisterPurchase(e: React.FormEvent) {
    e.preventDefault();
    if (busyPurchase) return;
    if (!purSupplierId) {
      onFeedback("Selecciona un proveedor antes de guardar la compra.", true);
      return;
    }
    if (purCurrency === "USD" && effectiveExchangeRate <= 0) {
      onFeedback("Ingresa un tipo de cambio USD válido mayor a 0.", true);
      return;
    }
    const validItems = purItems
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

    setBusyPurchase(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register_purchase",
          supplierPartyId: Number(purSupplierId),
          docType: purDocType,
          docSeries: purDocSeries.trim() || "001",
          docNumber: purDocNumber.trim(),
          issueDate: purIssueDate || undefined,
          dueDate: purDueDate || undefined,
          currency: purCurrency,
          exchangeRate: purCurrency === "USD" ? effectiveExchangeRate : undefined,
          taxMode: purTaxMode,
          paymentCondition: purPaymentCond,
          paidNowPen:
            purPaymentCond === "PARTIAL" ? Number(purPaidNow || 0) : undefined,
          accountId:
            purPaymentCond !== "CREDIT" && purAccountId
              ? Number(purAccountId)
              : undefined,
          notes: purNotes || undefined,
          items: validItems,
          fulfillOrderLineIds:
            fulfillOrderLineIds.length > 0 ? fulfillOrderLineIds : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onFeedback(data.error || "Error al registrar compra", true);
        return;
      }
      onFeedback(
        `Compra ${formatDocTypeEs(
          purDocType
        )} ${purDocSeries}-${purDocNumber} registrada (${formatPen(
          data.totalPen ?? purchaseTotalPen
        )}). Inventario actualizado${
          fulfillOrderLineIds.length > 0
            ? ` y ${fulfillOrderLineIds.length} línea(s) bajo pedido marcadas listas.`
            : "."
        }`
      );
      setPurDocNumber("");
      setPurDueDate("");
      setPurCurrency("PEN");
      setPurExchangeRate("3.75");
      setPurTaxMode("NONE");
      setPurPaidNow("");
      setPurNotes("");
      setPurItems([
        {
          key: `line-${Date.now()}`,
          productId: "",
          search: "",
          quantity: "1",
          unitCostPen: "",
        },
      ]);
      setFulfillOrderLineIds([]);
      setShowPurchaseForm(false);
      notifyLocalSync(["purchases", "inventory", "treasury", "orders", "partners"]);
      await onRefresh();
    } catch {
      onFeedback("Error de red al registrar la compra.", true);
    } finally {
      setBusyPurchase(false);
    }
  }

  async function handlePayApObligation(e: React.FormEvent) {
    e.preventDefault();
    if (!payingAp || busyApPay) return;
    const amount = Number(apPayAmount);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > Number(payingAp.balance_due_pen) + 0.005
    ) {
      onFeedback(
        "El monto debe ser mayor que cero y no superar el saldo pendiente.",
        true
      );
      return;
    }
    if (!confirmApPayment) {
      setConfirmApPayment(true);
      return;
    }
    setBusyApPay(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pay_ap_obligation",
          apId: payingAp.ap_id,
          amountPen: Number(apPayAmount),
          accountId: apPayAccountId ? Number(apPayAccountId) : undefined,
          notes: apPayNotes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onFeedback(data.error || "Error al registrar pago de CxP", true);
        return;
      }
      onFeedback(
        `Pago de ${formatPen(apPayAmount)} aplicado a ${payingAp.doc_ref} (${
          payingAp.supplier_name
        }). Nuevo saldo: ${formatPen(data.newBalanceDuePen ?? 0)}.`
      );
      setPayingAp(null);
      setConfirmApPayment(false);
      setApPayAmount("");
      setApPayNotes("");
      notifyLocalSync(["purchases", "treasury", "partners"]);
      await onRefresh();
    } catch {
      onFeedback("Error de red al registrar pago de cuenta por pagar.", true);
    } finally {
      setBusyApPay(false);
    }
  }

  async function handleSaveOutflow(e: React.FormEvent) {
    e.preventDefault();
    if (busyOutflow) return;
    const amount = Number(outflowAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      onFeedback("Ingresa un monto válido mayor que cero.", true);
      return;
    }
    if (outflowIsTransfer) {
      if (!outflowAccountId || !outflowToAccountId) {
        onFeedback(
          "Selecciona la cuenta de origen y la cuenta destino del traslado.",
          true
        );
        return;
      }
      if (outflowAccountId === outflowToAccountId) {
        onFeedback("La cuenta de origen y destino deben ser diferentes.", true);
        return;
      }
    }
    if (!confirmOutflow) {
      setConfirmOutflow(true);
      return;
    }
    setBusyOutflow(true);
    try {
      const res = await fetch("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          outflowIsTransfer
            ? {
                isInternalTransfer: true,
                amountPen: Number(outflowAmount),
                accountId: Number(outflowAccountId),
                toAccountId: Number(outflowToAccountId),
                description: outflowDesc,
              }
            : {
                isInternalTransfer: false,
                amountPen: Number(outflowAmount),
                expenseBucket: outflowBucket,
                expenseCategory: outflowCategory,
                txDate: outflowBucket === "ROUTE_OPEX" ? outflowDate : undefined,
                accountId: outflowAccountId ? Number(outflowAccountId) : undefined,
                description: outflowDesc,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        onFeedback(data.error || "Error al registrar movimiento en caja", true);
        return;
      }
      onFeedback(
        outflowIsTransfer
          ? "Traslado interno registrado (salida e ingreso atómicos)."
          : "Egreso registrado correctamente en Caja."
      );
      setOutflowAmount("");
      setOutflowDesc("");
      setOutflowIsTransfer(false);
      setConfirmOutflow(false);
      notifyLocalSync(["treasury", "purchases", "partners"]);
      await onRefresh();
    } catch {
      onFeedback("Error de red al guardar movimiento de caja.", true);
    } finally {
      setBusyOutflow(false);
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      {/* Top Action & AP Summary Header */}
      <Card
        accent="horizon"
        padding="md"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div>
          <span className="text-xs font-medium text-bht-ink-soft">
            Proveedores y Cuentas por Pagar
          </span>
          <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
            <h2 className="text-2xl font-semibold text-bht-danger tabular-nums">
              {formatPen(totalOpenApPen)}
            </h2>
            <span className="text-xs text-bht-ink-soft tabular-nums">
              en {openDocsCount} obligación(es) pendiente(s) · {suppliers.length}{" "}
              proveedores activos
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <Button variant="outline" size="md" onClick={() => setShowNewSupplier(true)}>
            <PlusIcon className="h-3.5 w-3.5" />
            Nuevo Proveedor
          </Button>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 border-t border-bht-line pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <div
              key={account.account_id}
              className="flex items-center justify-between gap-2 rounded-xl border border-bht-line bg-white/80 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-bht-ink-soft">
                  {account.name}
                </p>
                <p className="text-[10px] text-bht-ink-muted">{account.code}</p>
              </div>
              <strong className="flex-shrink-0 text-xs tabular-nums text-bht-navy-deep">
                {formatPen(Number(account.current_balance_pen ?? 0))}
              </strong>
            </div>
          ))}
        </div>
      </Card>

      {/* Register Purchase + ON_DEMAND Fulfillment Form */}
      {showPurchaseForm && (
        <Card padding="lg" className="border-bht-navy-deep">
          <form onSubmit={handleRegisterPurchase} className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-bht-line pb-3">
              <div>
                <h3 className="text-base font-semibold text-bht-ink-strong">
                  Registrar Compra / Ingreso de Mercadería
                </h3>
                <p className="mt-0.5 text-xs text-bht-ink-soft">
                  Ingresa mercadería al almacén principal, actualiza costo de
                  referencia, genera CxP si es crédito/parcial y cierra líneas bajo
                  pedido.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPurchaseForm(false)}
              >
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
                    onClick={() => setShowNewSupplier(true)}
                    className="text-xs font-semibold text-bht-navy-mid hover:underline cursor-pointer"
                  >
                    + Nuevo Proveedor
                  </button>
                </div>
                <select
                  id="pur-supplier"
                  required
                  value={purSupplierId}
                  onChange={(e) => setPurSupplierId(e.target.value)}
                  className={`${INPUT_CLASS} mt-1.5 font-medium`}
                >
                  <option value="">-- Seleccionar proveedor --</option>
                  {suppliers.map((s) => (
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
                  value={purDocType}
                  onChange={(e) => setPurDocType(e.target.value as typeof purDocType)}
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
                    value={purDocSeries}
                    onChange={(e) => setPurDocSeries(e.target.value.toUpperCase())}
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
                    value={purDocNumber}
                    onChange={(e) => setPurDocNumber(e.target.value)}
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
                  value={purIssueDate}
                  onChange={(e) => setPurIssueDate(e.target.value)}
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
                  value={purDueDate}
                  onChange={(e) => setPurDueDate(e.target.value)}
                  className={`${INPUT_CLASS} mt-1.5`}
                />
              </div>

              <div>
                <FieldLabel htmlFor="pur-currency">Moneda y Tipo de Cambio</FieldLabel>
                <div className="mt-1.5 flex gap-2">
                  <select
                    id="pur-currency"
                    value={purCurrency}
                    onChange={(e) => setPurCurrency(e.target.value as "PEN" | "USD")}
                    className={`${INPUT_CLASS} w-28 font-semibold`}
                  >
                    <option value="PEN">PEN (S/)</option>
                    <option value="USD">USD ($)</option>
                  </select>
                  {purCurrency === "USD" && (
                    <input
                      id="pur-exchange-rate"
                      type="number"
                      step="0.001"
                      min="0.01"
                      aria-label="Tipo de cambio USD a PEN"
                      value={purExchangeRate}
                      onChange={(e) => setPurExchangeRate(e.target.value)}
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
                  value={purTaxMode}
                  onChange={(e) =>
                    setPurTaxMode(e.target.value as "NONE" | "INCLUDED" | "EXCLUDED")
                  }
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
                    const active = purPaymentCond === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPurPaymentCond(c.id as typeof purPaymentCond)}
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

              {purPaymentCond === "PARTIAL" && (
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
                    value={purPaidNow}
                    onChange={(e) => setPurPaidNow(e.target.value)}
                    placeholder="Mayor a 0 y menor al total"
                    className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
                  />
                </div>
              )}

              {purPaymentCond !== "CREDIT" && (
                <div>
                  <FieldLabel htmlFor="pur-account">Cuenta de salida</FieldLabel>
                  <select
                    id="pur-account"
                    value={purAccountId}
                    onChange={(e) => setPurAccountId(e.target.value)}
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
                  value={purNotes}
                  onChange={(e) => setPurNotes(e.target.value)}
                  placeholder="Ej. Reposición campaña / recojo en tienda proveedor"
                  className={`${INPUT_CLASS} mt-1.5`}
                />
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-2.5 rounded-xl border border-bht-line bg-bht-paper p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-bht-ink-strong">
                  Ítems de Compra (Ingreso a Almacén Principal)
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPurItems((prev) => [
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

              {purItems.map((row, idx) => (
                <PurchaseLineRow
                  key={row.key}
                  row={row}
                  idx={idx}
                  catalog={catalog}
                  canRemove={purItems.length > 1}
                  onSearchChange={handleLineSearchChange}
                  onSelectProduct={handleSelectProductForLine}
                  onQuantityChange={handleLineQuantityChange}
                  onUnitCostChange={handleLineUnitCostChange}
                  onRemove={handleRemovePurchaseLine}
                />
              ))}
            </div>

            {matchingOnDemandLines.length > 0 && (
              <Card tone="brand" padding="sm" className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold text-bht-ink-strong">
                    Cierre Automático Bajo Pedido ({matchingOnDemandLines.length}{" "}
                    coincidencia(s))
                  </h4>
                  <Button
                    variant="brand"
                    size="sm"
                    onClick={() =>
                      setFulfillOrderLineIds(
                        matchingOnDemandLines.map((m) => m.order_line_id)
                      )
                    }
                  >
                    Seleccionar todos
                  </Button>
                </div>
                <p className="text-xs text-bht-ink-soft">
                  Marca las líneas de cliente que se surten con esta compra para cerrar
                  la alerta pendiente al instante:
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  {matchingOnDemandLines.map((od) => {
                    const checked = fulfillOrderLineIds.includes(od.order_line_id);
                    return (
                      <label
                        key={od.order_line_id}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-xs transition ${
                          checked
                            ? "border-bht-tone-1d4ed8 bg-white ring-1 ring-bht-tone-1d4ed8"
                            : "border-bht-tone-dbeafe bg-white/80"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFulfillOrderLineIds((prev) =>
                                Array.from(new Set([...prev, od.order_line_id]))
                              );
                            } else {
                              setFulfillOrderLineIds((prev) =>
                                prev.filter((id) => id !== od.order_line_id)
                              );
                            }
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-bht-line-stronger"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-bht-ink-strong">
                            {od.sku} · ×{Number(od.quantity)}{" "}
                            {od.unit_of_measure || "NIU"} — {od.product_name}
                          </p>
                          <p className="text-xs text-bht-ink-soft tabular-nums">
                            {od.order_code} ·{" "}
                            {od.customer_name || od.customer_name_raw || "-"} ·{" "}
                            {formatPen(od.line_total_pen)}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </Card>
            )}

            {otherOnDemandLines.length > 0 && (
              <Card tone="warning" padding="sm" className="space-y-2">
                <p className="text-xs font-semibold text-bht-ink-strong">
                  Otros pedidos bajo pedido pendientes ({otherOnDemandLines.length}):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {otherOnDemandLines.slice(0, 8).map((od) => (
                    <Button
                      key={od.order_line_id}
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddOnDemandProductToPurchase(od)}
                    >
                      <PlusIcon className="h-3 w-3" />
                      {od.sku} (×{Number(od.quantity)} {od.unit_of_measure || "NIU"} ·{" "}
                      {od.order_code})
                    </Button>
                  ))}
                </div>
              </Card>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-bht-navy-deep px-4 py-3.5 text-white">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums">
                {purTaxMode !== "NONE" && (
                  <>
                    <div>
                      <span className="text-white/60">Base Imponible:</span>{" "}
                      <strong>{formatPen(purchaseSubtotalPen)}</strong>
                    </div>
                    <div>
                      <span className="text-white/60">IGV 18%:</span>{" "}
                      <strong>{formatPen(purchaseIgvPen)}</strong>
                    </div>
                  </>
                )}
                <div>
                  <span className="text-white/60">Total Compra:</span>{" "}
                  <strong className="text-sm font-semibold">
                    {formatPen(purchaseTotalPen)}
                    {purCurrency === "USD" && (
                      <span className="ml-1.5 text-xs text-white/75">
                        ($ {purchaseOrigTotal.toFixed(2)})
                      </span>
                    )}
                  </strong>
                </div>
                <div>
                  <span className="text-white/60">Pago Hoy:</span>{" "}
                  <strong className="text-bht-tone-4ade80">
                    {formatPen(purchasePaidNowComputed)}
                  </strong>
                </div>
                <div>
                  <span className="text-white/60">A Cuentas por Pagar:</span>{" "}
                  <strong className="text-bht-tone-fbbf24">
                    {formatPen(purchaseCreditBalancePen)}
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
      )}

      {/* Supplier Summary Cards */}
      <Card padding="md" className="space-y-3">
        <details>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep">
            <div>
              <h3 className="text-sm font-semibold text-bht-ink-strong sm:text-base">
                Resumen por Proveedor ({suppliers.length})
              </h3>
              <p className="text-xs text-bht-ink-soft">
                Filtra CxP por proveedor cuando necesites revisar su detalle.
              </p>
            </div>
            <ChevronRightIcon className="h-4 w-4 text-bht-ink-soft" />
          </summary>
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs text-bht-ink-soft">
                  Toca un proveedor para filtrar sus facturas y cuentas por pagar.
                </p>
              </div>
              {selectedSupplierFilterId !== null && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedSupplierFilterId(null)}
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                  Ver todos
                </Button>
              )}
            </div>
            {suppliers.length === 0 ? (
              <p className="text-xs text-bht-ink-soft">
                No hay proveedores registrados aún.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {suppliers.map((sup) => {
                  const isSelected = selectedSupplierFilterId === sup.party_id;
                  const openBal = Number(sup.open_ap_balance_pen ?? 0);
                  const openDocs = Number(sup.open_docs_count ?? 0);
                  return (
                    <button
                      key={sup.party_id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() =>
                        setSelectedSupplierFilterId((prev) =>
                          prev === sup.party_id ? null : sup.party_id
                        )
                      }
                      className={`flex min-w-0 w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition cursor-pointer ${
                        isSelected
                          ? "border-bht-navy-deep bg-bht-mist ring-1 ring-bht-navy-deep"
                          : "border-bht-line bg-white hover:bg-bht-paper"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-bht-ink-strong">
                          {sup.trade_name || sup.legal_name}
                        </p>
                        <p className="mt-0.5 text-xs text-bht-ink-soft">
                          {sup.doc_type && sup.doc_number
                            ? `${sup.doc_type}: ${sup.doc_number}`
                            : "Sin RUC/DNI"}
                          {sup.phone ? ` · ${sup.phone}` : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-bht-ink-muted tabular-nums">
                          {openDocs} doc(s) pendiente(s)
                        </p>
                      </div>
                      <Badge
                        tone={openBal > 0.05 ? "danger" : "success"}
                        className="flex-shrink-0 tabular-nums"
                      >
                        {formatPen(openBal)}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </details>
      </Card>

      {/* Main Split: AP Obligations & Cash Outflow */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm sm:text-base font-semibold text-bht-ink-strong">
              Obligaciones por Pagar (CxP) ({filteredApObligations.length})
            </h3>
          </div>

          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
              <SearchIcon className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={apSearch}
              onChange={(e) => setApSearch(e.target.value)}
              aria-label="Buscar proveedor o comprobante en cuentas por pagar"
              placeholder="Buscar por proveedor o comprobante..."
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
                    className="rounded-xl border border-bht-line bg-bht-paper/60 p-3 text-xs space-y-2 transition hover:border-bht-line-blue"
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

                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 tabular-nums text-xs text-bht-ink-soft">
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
                        Ver detalle ({itemCount}{" "}
                        {itemCount === 1 ? "ítem pedido" : "ítems pedidos"}) y pagos
                        <ChevronRightIcon className="h-3 w-3" />
                      </span>
                    </button>

                    {canPay && (
                      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bht-line/80 pt-2">
                        <Button
                          variant="success"
                          size="sm"
                          aria-label={`Pagar o amortizar ${ap.doc_ref} de ${ap.supplier_name}`}
                          onClick={() => {
                            setPayingAp(ap);
                            setConfirmApPayment(false);
                            setApPayAmount(String(Number(ap.balance_due_pen)));
                            setApPayNotes("");
                          }}
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

        {/* Registrar Egreso / Retiro / Gasto de Caja */}
        <Card padding="md">
          <form onSubmit={handleSaveOutflow} className="space-y-3.5">
            <h3 className="text-sm sm:text-base font-semibold text-bht-ink-strong">
              {outflowIsTransfer
                ? "Registrar Traslado entre Cuentas"
                : outflowBucket === "ROUTE_OPEX"
                  ? "Registrar Gasto Diario"
                  : "Registrar Egreso No Operativo"}
            </h3>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-bht-line-blue bg-bht-mist/70 px-3 py-2 text-xs font-medium text-bht-navy-deep">
              <input
                type="checkbox"
                checked={outflowIsTransfer}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setOutflowIsTransfer(checked);
                  setConfirmOutflow(false);
                  if (checked) {
                    const altAcc = accounts.find(
                      (a) => String(a.account_id) !== outflowAccountId
                    );
                    if (
                      altAcc &&
                      (!outflowToAccountId || outflowToAccountId === outflowAccountId)
                    ) {
                      setOutflowToAccountId(String(altAcc.account_id));
                    }
                  }
                }}
                className="h-4 w-4 rounded border-bht-navy-deep"
              />
              <span>Traslado interno entre cuentas propias (atómico OUT + IN)</span>
            </label>

            {outflowIsTransfer ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="outflow-account" required>
                    Cuenta origen (sale dinero)
                  </FieldLabel>
                  <select
                    id="outflow-account"
                    value={outflowAccountId}
                    onChange={(e) => {
                      const nextFrom = e.target.value;
                      setOutflowAccountId(nextFrom);
                      setConfirmOutflow(false);
                      if (outflowToAccountId === nextFrom) {
                        const altAcc = accounts.find(
                          (a) => String(a.account_id) !== nextFrom
                        );
                        setOutflowToAccountId(altAcc ? String(altAcc.account_id) : "");
                      }
                    }}
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
                <div>
                  <FieldLabel htmlFor="outflow-to-account" required>
                    Cuenta destino (ingresa dinero)
                  </FieldLabel>
                  <select
                    id="outflow-to-account"
                    required
                    value={outflowToAccountId}
                    onChange={(e) => {
                      setOutflowToAccountId(e.target.value);
                      setConfirmOutflow(false);
                    }}
                    className={`${INPUT_CLASS} mt-1.5 font-medium`}
                  >
                    <option value="">-- Elegir cuenta destino --</option>
                    {accounts
                      .filter((acc) => String(acc.account_id) !== outflowAccountId)
                      .map((acc) => (
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
              </div>
            ) : (
              <>
                <div>
                  <FieldLabel htmlFor="outflow-bucket">Tipo de salida</FieldLabel>
                  <select
                    id="outflow-bucket"
                    value={outflowBucket}
                    onChange={(e) => {
                      const nextBucket = e.target.value as OutflowBucket;
                      setOutflowBucket(nextBucket);
                      setConfirmOutflow(false);
                      const firstCat =
                        OUTFLOW_CATEGORIES_BY_BUCKET[nextBucket]?.[0]?.value ??
                        "COMBUSTIBLE";
                      setOutflowCategory(firstCat);
                    }}
                    className={`${INPUT_CLASS} mt-1.5 font-medium`}
                  >
                    <option value="ROUTE_OPEX">Gasto Operativo de Ruta</option>
                    <option value="NON_OPEX_OR_CAPEX">
                      Retiro (Socio / Gerencia) / No Operativo
                    </option>
                  </select>
                </div>

                {outflowBucket === "ROUTE_OPEX" && (
                  <div>
                    <FieldLabel htmlFor="outflow-date" required>
                      Fecha del gasto diario
                    </FieldLabel>
                    <input
                      id="outflow-date"
                      type="date"
                      required
                      value={outflowDate}
                      onChange={(e) => {
                        setOutflowDate(e.target.value);
                        setConfirmOutflow(false);
                      }}
                      className={`${INPUT_CLASS} mt-1.5 font-medium`}
                    />
                    <p className="mt-1 text-xs text-bht-ink-muted">
                      Puedes elegir una fecha anterior para registrar un gasto olvidado.
                    </p>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <FieldLabel htmlFor="outflow-account">
                      Cuenta de caja / banco
                    </FieldLabel>
                    <select
                      id="outflow-account"
                      value={outflowAccountId}
                      onChange={(e) => {
                        setOutflowAccountId(e.target.value);
                        setConfirmOutflow(false);
                      }}
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
                  <div>
                    <FieldLabel htmlFor="outflow-category" required>
                      Categoría
                    </FieldLabel>
                    <select
                      id="outflow-category"
                      required
                      value={outflowCategory}
                      onChange={(e) => {
                        setOutflowCategory(e.target.value);
                        setConfirmOutflow(false);
                      }}
                      className={`${INPUT_CLASS} mt-1.5 font-medium`}
                    >
                      {OUTFLOW_CATEGORIES_BY_BUCKET[outflowBucket].map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}
            <div>
              <FieldLabel htmlFor="outflow-amount" required>
                Monto en Soles (S/)
              </FieldLabel>
              <input
                id="outflow-amount"
                type="number"
                step="0.01"
                min="0.10"
                required
                value={outflowAmount}
                onChange={(e) => {
                  setOutflowAmount(e.target.value);
                  setConfirmOutflow(false);
                }}
                placeholder="0.00"
                className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
              />
            </div>
            <div>
              <FieldLabel htmlFor="outflow-desc" required>
                Descripción detallada
              </FieldLabel>
              <input
                id="outflow-desc"
                type="text"
                required
                value={outflowDesc}
                onChange={(e) => {
                  setOutflowDesc(e.target.value);
                  setConfirmOutflow(false);
                }}
                placeholder={
                  outflowIsTransfer
                    ? "Ej. Entrega de efectivo de ruta a banco o socio"
                    : "Descripción del gasto o retiro"
                }
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </div>
            {Number(outflowAmount) > 0 && (
              <div className="space-y-1.5 rounded-xl border border-bht-line-blue bg-bht-mist/70 p-3 text-xs text-bht-ink-soft tabular-nums">
                <p className="font-semibold text-bht-navy-deep">
                  {confirmOutflow
                    ? "Confirma el movimiento"
                    : "Revisa antes de guardar"}
                </p>
                {outflowIsTransfer
                  ? (() => {
                      const source = accounts.find(
                        (a) => String(a.account_id) === outflowAccountId
                      );
                      const destination = accounts.find(
                        (a) => String(a.account_id) === outflowToAccountId
                      );
                      return (
                        <>
                          <p>
                            Sale de {source?.name ?? "cuenta de origen"} y entra a{" "}
                            {destination?.name ?? "cuenta destino"} ·{" "}
                            {formatPen(Number(outflowAmount))}
                          </p>
                          {source?.current_balance_pen != null && (
                            <p>
                              Saldo origen después:{" "}
                              {formatPen(
                                Number(source.current_balance_pen) -
                                  Number(outflowAmount)
                              )}
                            </p>
                          )}
                          {destination?.current_balance_pen != null && (
                            <p>
                              Saldo destino después:{" "}
                              {formatPen(
                                Number(destination.current_balance_pen) +
                                  Number(outflowAmount)
                              )}
                            </p>
                          )}
                        </>
                      );
                    })()
                  : (() => {
                      const source = accounts.find(
                        (a) => String(a.account_id) === outflowAccountId
                      );
                      return (
                        <>
                          <p>
                            Sale de {source?.name ?? "cuenta seleccionada"} ·{" "}
                            {outflowCategory} · {formatPen(Number(outflowAmount))}
                          </p>
                          {source?.current_balance_pen != null && (
                            <p>
                              Saldo de la cuenta después:{" "}
                              {formatPen(
                                Number(source.current_balance_pen) -
                                  Number(outflowAmount)
                              )}
                            </p>
                          )}
                        </>
                      );
                    })()}
                {outflowDesc.trim() && (
                  <p className="break-words">{outflowDesc.trim()}</p>
                )}
              </div>
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={busyOutflow}
              className="w-full"
            >
              {busyOutflow
                ? "Guardando..."
                : confirmOutflow
                  ? "Confirmar y registrar movimiento"
                  : "Revisar movimiento"}
            </Button>
          </form>
        </Card>
      </div>

      {/* Recent Purchases & Cash Ledger */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <details>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep">
              <h3 className="text-sm sm:text-base font-semibold text-bht-ink-strong">
                Historial de Compras Registradas ({filteredRecentPurchases.length}
                {purchaseSearch ? ` / ${recentPurchases.length}` : ""})
              </h3>
              <ChevronRightIcon className="h-4 w-4 text-bht-ink-soft" />
            </summary>
            <div className="mt-3 space-y-3">
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
                <>
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
                          <p className="text-xs text-bht-navy-mid font-medium">
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
                </>
              )}
            </div>
          </details>
        </Card>

        <Card padding="md" className="space-y-3">
          <details>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bht-navy-deep">
              <h3 className="text-sm sm:text-base font-semibold text-bht-ink-strong">
                Movimientos de Caja ({filteredLedger.length}
                {ledgerSearch ? ` / ${ledger.length}` : ""})
              </h3>
              <ChevronRightIcon className="h-4 w-4 text-bht-ink-soft" />
            </summary>
            <div className="mt-3 space-y-3">
              {ledger.length > 0 && (
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-bht-ink-muted">
                    <SearchIcon className="h-4 w-4" />
                  </span>
                  <input
                    type="text"
                    value={ledgerSearch}
                    onChange={(e) => setLedgerSearch(e.target.value)}
                    aria-label="Filtrar movimientos de caja"
                    placeholder="Filtrar caja por descripción, cuenta o categoría..."
                    className={`${INPUT_CLASS} py-2 pl-10 pr-8 text-xs`}
                  />
                  {ledgerSearch && (
                    <button
                      type="button"
                      data-compact="true"
                      aria-label="Limpiar búsqueda de movimientos de caja"
                      onClick={() => setLedgerSearch("")}
                      className="absolute inset-y-0 right-2.5 flex items-center text-bht-ink-muted hover:text-bht-ink-strong cursor-pointer"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
              <div className="space-y-2 md:max-h-96 md:overflow-y-auto md:pr-1">
                {filteredLedger.length === 0 ? (
                  <EmptyState
                    title={
                      ledgerSearch
                        ? "No hay movimientos que coincidan con tu filtro"
                        : "No hay movimientos recientes en caja"
                    }
                  />
                ) : (
                  filteredLedger.map((mov) => {
                    const isIn = mov.direction === "IN";
                    const badgeTone = mov.is_internal_transfer
                      ? "brand"
                      : isIn
                        ? "success"
                        : "danger";
                    return (
                      <div
                        key={mov.ledger_id}
                        className="flex items-start justify-between gap-2.5 rounded-xl border border-bht-line bg-bht-paper/60 p-2.5 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={badgeTone}>
                              {formatCashDirectionEs(
                                mov.direction,
                                mov.is_internal_transfer
                              )}
                            </Badge>
                            <span className="font-semibold text-bht-ink-strong">
                              {formatExpenseCategoryEs(mov.expense_category)}
                            </span>
                            <span className="text-xs text-bht-ink-muted">
                              · {mov.account_name} · {mov.tx_date}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-bht-ink-soft">
                            {mov.description}
                          </p>
                        </div>
                        <span
                          className={`flex-shrink-0 font-semibold tabular-nums ${
                            mov.is_internal_transfer
                              ? "text-bht-navy-mid"
                              : isIn
                                ? "text-bht-success"
                                : "text-bht-danger"
                          }`}
                        >
                          {isIn ? "+" : "-"}
                          {formatPen(mov.amount_pen)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </details>
        </Card>
      </div>

      {/* Create Supplier Modal */}
      <ModalSheet
        open={showNewSupplier}
        onClose={() => setShowNewSupplier(false)}
        title="Nuevo Proveedor"
        subtitle="Registra un proveedor para vincular compras y cuentas por pagar."
        maxWidth="2xl"
      >
        <form onSubmit={handleCreateSupplier} className="space-y-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="sup-legal-name" required>
                Razón social / Nombre legal
              </FieldLabel>
              <input
                id="sup-legal-name"
                type="text"
                required
                value={supLegalName}
                onChange={(e) => setSupLegalName(e.target.value)}
                placeholder="Ej. IMPORTADORA ANDINA S.A.C."
                className={`${INPUT_CLASS} mt-1 font-medium`}
              />
            </div>
            <div>
              <FieldLabel htmlFor="sup-trade-name">
                Nombre comercial (opcional)
              </FieldLabel>
              <input
                id="sup-trade-name"
                type="text"
                value={supTradeName}
                onChange={(e) => setSupTradeName(e.target.value)}
                placeholder="Ej. Ferretería Central"
                className={`${INPUT_CLASS} mt-1`}
              />
            </div>
            <div>
              <FieldLabel htmlFor="sup-doc-type">Tipo de documento</FieldLabel>
              <select
                id="sup-doc-type"
                value={supDocType}
                onChange={(e) => setSupDocType(e.target.value as typeof supDocType)}
                className={`${INPUT_CLASS} mt-1 font-medium`}
              >
                <option value="RUC">RUC</option>
                <option value="DNI">DNI</option>
                <option value="CE">CE</option>
                <option value="PASSPORT">Pasaporte</option>
                <option value="NONE">Sin Doc</option>
              </select>
            </div>
            <div>
              <FieldLabel htmlFor="sup-doc-num">N° Documento</FieldLabel>
              <input
                id="sup-doc-num"
                type="text"
                disabled={supDocType === "NONE"}
                value={supDocNumber}
                onChange={(e) => setSupDocNumber(e.target.value)}
                placeholder={supDocType === "RUC" ? "20xxxxxxxxx" : "DNI"}
                className={`${INPUT_CLASS} mt-1 tabular-nums`}
              />
            </div>
            <div>
              <FieldLabel htmlFor="sup-phone">Teléfono / WhatsApp</FieldLabel>
              <input
                id="sup-phone"
                type="text"
                value={supPhone}
                onChange={(e) => setSupPhone(e.target.value)}
                placeholder="999 888 777"
                className={`${INPUT_CLASS} mt-1`}
              />
            </div>
            <div>
              <FieldLabel htmlFor="sup-address">Dirección (opcional)</FieldLabel>
              <input
                id="sup-address"
                type="text"
                value={supAddress}
                onChange={(e) => setSupAddress(e.target.value)}
                placeholder="Av. Argentina / Lima"
                className={`${INPUT_CLASS} mt-1`}
              />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="sup-notes">Notas</FieldLabel>
              <input
                id="sup-notes"
                type="text"
                value={supNotes}
                onChange={(e) => setSupNotes(e.target.value)}
                placeholder="Condiciones o contacto"
                className={`${INPUT_CLASS} mt-1`}
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => setShowNewSupplier(false)}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busySupplier}
              className="flex-[2]"
            >
              {busySupplier ? "Guardando..." : "Guardar Proveedor"}
            </Button>
          </div>
        </form>
      </ModalSheet>

      {/* AP Payment Modal */}
      <ModalSheet
        open={Boolean(payingAp)}
        onClose={() => {
          setPayingAp(null);
          setConfirmApPayment(false);
        }}
        title="Registrar Pago a Proveedor"
        subtitle={
          payingAp ? `${payingAp.supplier_name} · ${payingAp.doc_ref}` : undefined
        }
      >
        {payingAp && (
          <form onSubmit={handlePayApObligation} className="space-y-4">
            <div className="rounded-xl border border-bht-line bg-bht-paper p-3 text-xs text-bht-ink-soft tabular-nums">
              Original:{" "}
              <strong className="text-bht-ink-strong">
                {formatPen(payingAp.original_amount_pen)}
              </strong>{" "}
              · Saldo pendiente:{" "}
              <strong className="text-bht-danger">
                {formatPen(payingAp.balance_due_pen)}
              </strong>
            </div>

            <div>
              <FieldLabel htmlFor="ap-pay-amount" required>
                Monto a pagar (S/)
              </FieldLabel>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <input
                  id="ap-pay-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={apPayAmount}
                  onChange={(e) => {
                    setApPayAmount(e.target.value);
                    setConfirmApPayment(false);
                  }}
                  placeholder="0.00"
                  className={`${INPUT_CLASS} flex-1 min-w-[140px] font-semibold tabular-nums`}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setApPayAmount(String(Number(payingAp.balance_due_pen)));
                    setConfirmApPayment(false);
                  }}
                >
                  Todo ({formatPen(payingAp.balance_due_pen)})
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setApPayAmount((Number(payingAp.balance_due_pen) / 2).toFixed(2));
                    setConfirmApPayment(false);
                  }}
                >
                  Mitad
                </Button>
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="ap-pay-account" required>
                Cuenta de origen
              </FieldLabel>
              <select
                id="ap-pay-account"
                value={apPayAccountId}
                onChange={(e) => {
                  setApPayAccountId(e.target.value);
                  setConfirmApPayment(false);
                }}
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

            <div>
              <FieldLabel htmlFor="ap-pay-notes">Nota / N° Operación</FieldLabel>
              <input
                id="ap-pay-notes"
                type="text"
                value={apPayNotes}
                onChange={(e) => setApPayNotes(e.target.value)}
                placeholder="Ej. Transferencia Interbank OP-123"
                className={`${INPUT_CLASS} mt-1.5`}
              />
            </div>

            {confirmApPayment && (
              <div className="space-y-2 rounded-xl border border-bht-amber-line bg-bht-amber-bg p-3 text-xs text-bht-ink-soft tabular-nums">
                <p className="font-semibold text-bht-ink-strong">
                  Revisa el movimiento antes de registrarlo
                </p>
                <p>
                  {payingAp.supplier_name} · {payingAp.doc_ref}
                </p>
                <p>
                  Sale de:{" "}
                  <strong>{apPayAccount?.name ?? "Cuenta seleccionada"}</strong>
                </p>
                <p>
                  Pago: <strong>{formatPen(Number(apPayAmount))}</strong> · Saldo CxP
                  después: {formatPen(apPayBalanceAfter)}
                </p>
                {apPayAccount?.current_balance_pen !== undefined && (
                  <p>
                    Saldo de la cuenta después:{" "}
                    {formatPen(
                      Number(apPayAccount.current_balance_pen) -
                        Number(apPayAmount || 0)
                    )}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => {
                  if (confirmApPayment) setConfirmApPayment(false);
                  else setPayingAp(null);
                }}
                className="flex-1"
              >
                {confirmApPayment ? "Volver" : "Cancelar"}
              </Button>
              <Button
                type="submit"
                variant="success"
                disabled={busyApPay}
                className="flex-[2]"
              >
                {busyApPay
                  ? "Procesando..."
                  : confirmApPayment
                    ? "Confirmar y registrar pago"
                    : "Revisar pago"}
              </Button>
            </div>
          </form>
        )}
      </ModalSheet>

      {/* AP Obligation Detail Modal */}
      <ModalSheet
        open={Boolean(detailAp)}
        onClose={() => setDetailAp(null)}
        title={
          detailAp
            ? `Detalle de Cuenta por Pagar · ${detailAp.doc_ref}`
            : "Detalle de Cuenta por Pagar"
        }
        subtitle={
          detailAp
            ? `${detailAp.supplier_name}${
                detailAp.doc_type ? ` · ${formatDocTypeEs(detailAp.doc_type)}` : ""
              }`
            : undefined
        }
        maxWidth="2xl"
      >
        {detailAp && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 tabular-nums">
              <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                <span className="block text-xs text-bht-ink-muted">
                  Total facturado / pedido
                </span>
                <strong className="mt-0.5 block text-base text-bht-ink-strong">
                  {formatPen(detailAp.original_amount_pen)}
                </strong>
              </div>
              <div className="rounded-xl border border-bht-line bg-bht-paper p-3">
                <span className="block text-xs text-bht-ink-muted">
                  Pagado / amortizado
                </span>
                <strong className="mt-0.5 block text-base text-bht-success">
                  {formatPen(detailAp.paid_amount_pen)}
                </strong>
              </div>
              <div className="rounded-xl border border-bht-tone-fee2e2 bg-bht-danger-bg/60 p-3">
                <span className="block text-xs text-bht-danger-strong">
                  Saldo que se debe
                </span>
                <strong className="mt-0.5 block text-base text-bht-danger">
                  {formatPen(detailAp.balance_due_pen)}
                </strong>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-white px-3 py-2.5 text-bht-ink-soft tabular-nums">
              <span>
                Emisión:{" "}
                <strong className="text-bht-ink-strong">{detailAp.issue_date}</strong>
                {detailAp.due_date ? ` · Vence: ${detailAp.due_date}` : ""}
              </span>
              <Badge
                tone={
                  detailAp.status === "PAID"
                    ? "success"
                    : detailAp.status === "PARTIAL"
                      ? "warning"
                      : "danger"
                }
              >
                {formatApStatusEs(detailAp.status)}
              </Badge>
            </div>

            {detailAp.notes && (
              <p className="rounded-xl border border-bht-line bg-bht-paper px-3 py-2 text-xs text-bht-ink-soft">
                Nota: {normalizeUiNoteEs(detailAp.notes)}
              </p>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-bht-navy-deep">
                Todo lo pedido en este comprobante ({detailAp.lines?.length ?? 0}{" "}
                {(detailAp.lines?.length ?? 0) === 1 ? "ítem" : "ítems"})
              </p>
              <InvoiceLinesBreakdown
                lines={detailAp.lines}
                emptyMessage="Este comprobante no tiene líneas de producto detalladas en el sistema."
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-bht-navy-deep">
                Historial de pagos y abonos
              </p>
              {detailAp.payments && detailAp.payments.length > 0 ? (
                <div className="space-y-1.5">
                  {detailAp.payments.map((pay) => (
                    <div
                      key={pay.ledger_id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-white px-3 py-2 tabular-nums"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-bht-ink-strong">
                          {pay.description || "Pago a proveedor"}
                        </p>
                        <p className="text-xs text-bht-ink-muted">
                          {pay.tx_date} · {pay.account_name}
                        </p>
                      </div>
                      <span className="font-semibold text-bht-success">
                        {formatPen(pay.amount_pen)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : Number(detailAp.paid_amount_pen) > 0 ? (
                <p className="rounded-xl border border-bht-warning-line bg-bht-warning-bg px-3 py-2 text-xs text-bht-warning-text tabular-nums">
                  Abono previo conciliado por{" "}
                  <strong>{formatPen(detailAp.paid_amount_pen)}</strong> (registro
                  anterior al control en vivo; saldo restante:{" "}
                  <strong>{formatPen(detailAp.balance_due_pen)}</strong>).
                </p>
              ) : (
                <p className="rounded-xl border border-dashed border-bht-line-strong bg-bht-paper px-3 py-2 text-xs text-bht-ink-soft">
                  Aún no se han registrado pagos para este comprobante.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-bht-line pt-3">
              <Button
                variant="outline"
                onClick={() => setDetailAp(null)}
                className="flex-1"
              >
                Cerrar
              </Button>
              {(detailAp.status === "OPEN" || detailAp.status === "PARTIAL") &&
                Number(detailAp.balance_due_pen) > 0 && (
                  <Button
                    variant="success"
                    onClick={() => {
                      const target = detailAp;
                      setDetailAp(null);
                      setPayingAp(target);
                      setConfirmApPayment(false);
                      setApPayAmount(String(Number(target.balance_due_pen)));
                      setApPayNotes("");
                    }}
                    className="flex-[2]"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Pagar / Amortizar ({formatPen(detailAp.balance_due_pen)})
                  </Button>
                )}
            </div>
          </div>
        )}
      </ModalSheet>

      {/* Recent Purchase Detail Modal */}
      <ModalSheet
        open={Boolean(detailPurchase)}
        onClose={() => setDetailPurchase(null)}
        title={
          detailPurchase
            ? `Detalle de Compra · ${detailPurchase.doc_series}-${detailPurchase.doc_number}`
            : "Detalle de Compra"
        }
        subtitle={
          detailPurchase
            ? `${detailPurchase.supplier_name || detailPurchase.supplier_ruc || "Proveedor"} · ${detailPurchase.issue_date}`
            : undefined
        }
        maxWidth="2xl"
      >
        {detailPurchase && (
          <div className="space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-bht-paper px-3 py-2.5 tabular-nums">
              <span className="text-bht-ink-soft">
                Tipo:{" "}
                <strong className="text-bht-ink-strong">
                  {formatDocTypeEs(detailPurchase.doc_type)}
                </strong>
                {detailPurchase.due_date ? ` · Vence: ${detailPurchase.due_date}` : ""}
              </span>
              <span className="font-semibold text-bht-ink-strong">
                Total: {formatPen(detailPurchase.total_pen)}
              </span>
            </div>

            {detailPurchase.raw_notes && (
              <p className="rounded-xl border border-bht-line bg-white px-3 py-2 text-xs text-bht-ink-soft">
                Nota: {normalizeUiNoteEs(detailPurchase.raw_notes)}
              </p>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-bht-navy-deep">
                Ítems de la compra ({detailPurchase.lines?.length ?? 0})
              </p>
              <InvoiceLinesBreakdown
                lines={detailPurchase.lines}
                emptyMessage="Esta compra se registró sin líneas individuales."
              />
            </div>

            <div className="flex justify-end border-t border-bht-line pt-3">
              <Button variant="outline" onClick={() => setDetailPurchase(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </ModalSheet>
    </div>
  );
}
