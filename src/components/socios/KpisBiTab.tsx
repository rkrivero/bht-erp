"use client";

import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  CloseIcon,
  DownloadIcon,
  EditIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import {
  formatAccountTypeEs,
  formatAuditFlagCodeEs,
  formatAuditFlagStatusEs,
  formatEntityTableEs,
  formatMarginStatusEs,
  formatQualityGapEs,
  formatRoleEs,
} from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import {
  type AppUserItem,
  type AuditFlagCounts,
  type AuditFlagItem,
  type BiSummary,
  type CurrentUserInfo,
  type KpiQ1Summary,
  formatMonthLabel,
  formatPen,
} from "./types";

interface KpisBiTabProps {
  currentUser: CurrentUserInfo | null;
  kpiQ1: KpiQ1Summary;
  openDebtorsCount: number;
  kpiQ2TopSkus: Array<Record<string, unknown>>;
  qualityGaps: Array<Record<string, unknown>>;
  auditFlags?: AuditFlagItem[];
  auditFlagCounts?: AuditFlagCounts;
  biSummary: BiSummary | null;
  users: AppUserItem[];
  onGoToPurchaseProduct: (productId: number) => void;
  onGoToEditProduct: (sku: string) => void;
  onRefresh: () => Promise<void>;
  onFeedback: (msg: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}

const EXPORT_DATASETS = [
  {
    id: "ventas_pedidos",
    title: "1. Ventas y Pedidos",
    subtitle: "Órdenes, clientes, cobros, saldos y responsables",
  },
  {
    id: "deudores_cartera",
    title: "2. Cartera de Deudores",
    subtitle: "Saldos por cobrar, antigüedad y fechas pactadas",
  },
  {
    id: "margen_productos",
    title: "3. Inventario, Costos y Márgenes",
    subtitle: "Catálogo, stock actual, costo ref., margen real y alertas",
  },
  {
    id: "flujo_caja_egresos",
    title: "4. Flujo de Caja y Egresos",
    subtitle: "Ingresos, OpEx ruta, compras, retiros y depósitos",
  },
  {
    id: "proveedores_cxp",
    title: "5. Cuentas por Pagar Proveedores",
    subtitle: "Obligaciones abiertas, parciales y pagadas por proveedor",
  },
] as const;

function formatTeamMemberName(u: AppUserItem): string {
  const name = (u.full_name || "").trim();
  if (u.username === "socio_admin" && /\bsocio\b|admin|asistente/i.test(name)) {
    return "Renzo";
  }
  if (u.username === "socio_gerente" && /\bsocio\b|gerente/i.test(name)) {
    return "Samuel";
  }
  if (u.username === "vendedor1" && /vendedor|externo|ruta/i.test(name)) {
    return "Franco";
  }
  if (u.username === "almacen1" && /almac[eé]n/i.test(name)) {
    return "Manuel";
  }
  if (u.username === "reparto1" && /reparto|chofer|movilidad/i.test(name)) {
    return "Emerson";
  }
  return name || formatRoleEs(u.role);
}

const TEAM_ROLE_LABEL_BY_USERNAME: Record<string, string> = {
  socio_gerente: "Gerencia",
  socio_admin: "Ventas y Control",
  vendedor1: "Vendedor",
  almacen1: "Almacén",
  reparto1: "Almacén y Reparto",
};

function getBiMarginClass(marginPen: unknown, pct: unknown): string {
  const m = Number(marginPen ?? 0);
  const p = Number(pct ?? 0);
  if (m <= 0 || p <= 0) return "text-[#B91C1C]";
  if (p < 20) return "text-[#B45309]";
  return "text-[#15803D]";
}

export default function KpisBiTab({
  currentUser,
  kpiQ1,
  openDebtorsCount,
  kpiQ2TopSkus,
  qualityGaps,
  auditFlags = [],
  auditFlagCounts,
  biSummary,
  users,
  onGoToPurchaseProduct,
  onGoToEditProduct,
  onRefresh,
  onFeedback,
  onEditingChange,
}: KpisBiTabProps) {
  const [downloadingDataset, setDownloadingDataset] = useState<string | null>(null);
  const [editingPinUserId, setEditingPinUserId] = useState<number | null>(null);
  const [newPinValue, setNewPinValue] = useState("");
  const [editingNameUserId, setEditingNameUserId] = useState<number | null>(null);
  const [newFullNameValue, setNewFullNameValue] = useState("");
  const [busyUserActionId, setBusyUserActionId] = useState<number | null>(null);
  const [confirmToggleUser, setConfirmToggleUser] = useState<AppUserItem | null>(null);
  const [skuSearch, setSkuSearch] = useState("");
  const deferredSkuSearch = useDeferredValue(skuSearch);
  const [periodFilter, setPeriodFilter] = useState<string>("ALL");
  const [flagFilter, setFlagFilter] = useState<
    "ALL" | "OPEN" | "ACKNOWLEDGED" | "RESOLVED"
  >("OPEN");
  const [busyFlagId, setBusyFlagId] = useState<number | null>(null);
  const [flagNoteById, setFlagNoteById] = useState<Record<number, string>>({});

  async function handleUpdateAuditFlag(
    flagId: number,
    nextStatus: "OPEN" | "ACKNOWLEDGED" | "RESOLVED"
  ) {
    if (busyFlagId === flagId) return;
    setBusyFlagId(flagId);
    try {
      const res = await fetch("/api/audit-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          flagId,
          nextStatus,
          resolutionNote: flagNoteById[flagId]?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onFeedback(data.error || "No se pudo actualizar la alerta.", true);
        return;
      }
      onFeedback(
        nextStatus === "RESOLVED"
          ? "Alerta operativa marcada como resuelta."
          : nextStatus === "ACKNOWLEDGED"
            ? "Alerta marcada como revisada."
            : "Alerta reabierta correctamente."
      );
      notifyLocalSync(["partners"]);
      await onRefresh();
    } catch {
      onFeedback("Error de red al actualizar alerta operativa.", true);
    } finally {
      setBusyFlagId(null);
    }
  }

  useEffect(() => {
    onEditingChange?.(
      editingPinUserId !== null ||
        editingNameUserId !== null ||
        confirmToggleUser !== null
    );
  }, [editingPinUserId, editingNameUserId, confirmToggleUser, onEditingChange]);

  useEffect(() => {
    return () => onEditingChange?.(false);
  }, [onEditingChange]);

  const monthlyRows = useMemo(
    () => biSummary?.monthlyPerformance || kpiQ1.monthlyRows || [],
    [biSummary?.monthlyPerformance, kpiQ1.monthlyRows]
  );

  const selectedMonthRow = useMemo(() => {
    if (periodFilter === "ALL") return null;
    return monthlyRows.find((r) => String(r.period_month) === periodFilter) ?? null;
  }, [monthlyRows, periodFilter]);

  const visibleMonthlyRows = useMemo(() => {
    if (!selectedMonthRow) return monthlyRows;
    return [selectedMonthRow];
  }, [monthlyRows, selectedMonthRow]);

  const maxMonthlyBarValue = useMemo(
    () =>
      Math.max(
        1,
        ...visibleMonthlyRows.flatMap((r) => [
          Number(r.sales_total_pen ?? 0),
          Number(r.cash_collected_pen ?? 0),
          Number(r.merchandise_outflow_pen ?? 0),
          Number(r.route_opex_pen ?? 0),
          Number(r.non_opex_capex_drain_pen ?? 0),
          Number(r.pre_route_foundational_outflow_pen ?? 0),
        ])
      ),
    [visibleMonthlyRows]
  );

  const totalRouteOpex = useMemo(
    () =>
      selectedMonthRow
        ? Number(selectedMonthRow.route_opex_pen ?? 0)
        : (kpiQ1.route_opex_pen ??
          monthlyRows.reduce((s, r) => s + Number(r.route_opex_pen ?? 0), 0)),
    [selectedMonthRow, kpiQ1.route_opex_pen, monthlyRows]
  );
  const totalMerchOutflow = useMemo(
    () =>
      selectedMonthRow
        ? Number(selectedMonthRow.merchandise_outflow_pen ?? 0)
        : (kpiQ1.merchandise_outflow_pen ??
          monthlyRows.reduce((s, r) => s + Number(r.merchandise_outflow_pen ?? 0), 0)),
    [selectedMonthRow, kpiQ1.merchandise_outflow_pen, monthlyRows]
  );
  const totalNonOpexDrain = useMemo(
    () =>
      selectedMonthRow
        ? Number(selectedMonthRow.non_opex_capex_drain_pen ?? 0)
        : (kpiQ1.non_opex_capex_drain_pen ??
          monthlyRows.reduce((s, r) => s + Number(r.non_opex_capex_drain_pen ?? 0), 0)),
    [selectedMonthRow, kpiQ1.non_opex_capex_drain_pen, monthlyRows]
  );
  const totalInternalDeposits = useMemo(
    () =>
      selectedMonthRow
        ? Number(selectedMonthRow.internal_deposits_pen ?? 0)
        : (kpiQ1.internal_deposits_pen ??
          monthlyRows.reduce((s, r) => s + Number(r.internal_deposits_pen ?? 0), 0)),
    [selectedMonthRow, kpiQ1.internal_deposits_pen, monthlyRows]
  );
  const totalPreRouteFoundational = useMemo(
    () =>
      selectedMonthRow
        ? Number(selectedMonthRow.pre_route_foundational_outflow_pen ?? 0)
        : (kpiQ1.pre_route_foundational_outflow_pen ??
          monthlyRows.reduce(
            (s, r) => s + Number(r.pre_route_foundational_outflow_pen ?? 0),
            0
          )),
    [selectedMonthRow, kpiQ1.pre_route_foundational_outflow_pen, monthlyRows]
  );

  const filteredTopSkus = useMemo(() => {
    const q = deferredSkuSearch.trim().toLowerCase();
    if (!q) return kpiQ2TopSkus;
    return kpiQ2TopSkus.filter(
      (s) =>
        String(s.product_name ?? "")
          .toLowerCase()
          .includes(q) ||
        String(s.sku ?? "")
          .toLowerCase()
          .includes(q)
    );
  }, [kpiQ2TopSkus, deferredSkuSearch]);

  const dynamicOpenDebtorsCount = kpiQ1.open_debtors_count ?? openDebtorsCount;

  async function handleDownloadCsv(dataset: string, title: string) {
    if (downloadingDataset !== null) return;
    setDownloadingDataset(dataset);
    try {
      const res = await fetch(
        `/api/reports?dataset=${encodeURIComponent(dataset)}&format=csv`
      );
      if (!res.ok) {
        let errMsg = `Error descargando ${title}`;
        try {
          const j = await res.json();
          if (j.error) errMsg = j.error;
        } catch {
          // ignore parse failure
        }
        onFeedback(errMsg, true);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const match = cd.match(/filename="?([^"]+)"?/i);
      const filename =
        match?.[1] || `bht_${dataset}_${new Date().toISOString().slice(0, 10)}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onFeedback(`Reporte "${title}" exportado en Excel CSV (${filename}).`);
    } catch {
      onFeedback(`Error de red descargando ${title}.`, true);
    } finally {
      setDownloadingDataset(null);
    }
  }

  async function handleUpdatePin(userId: number, username: string) {
    if (busyUserActionId !== null) return;
    if (
      newPinValue.trim().length < 10 ||
      !/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(newPinValue) ||
      !/\d/.test(newPinValue)
    ) {
      onFeedback(
        "La contraseña temporal debe tener 10 caracteres o más e incluir una letra y un número.",
        true
      );
      return;
    }
    setBusyUserActionId(userId);
    try {
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_user_password",
          userId,
          temporaryPassword: newPinValue.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onFeedback(data.error || "Error reiniciando contraseña", true);
        return;
      }
      onFeedback(
        `Contraseña temporal creada para ${username}. Deberá cambiarla al ingresar.`
      );
      setEditingPinUserId(null);
      setNewPinValue("");
      await onRefresh();
    } catch {
      onFeedback("Error de red al reiniciar la contraseña.", true);
    } finally {
      setBusyUserActionId(null);
    }
  }

  async function handleUpdateName(userId: number, username: string) {
    if (busyUserActionId !== null) return;
    const cleaned = newFullNameValue.trim().replace(/\s+/g, " ");
    if (cleaned.length < 2 || cleaned.length > 60) {
      onFeedback("El nombre visible debe tener entre 2 y 60 caracteres.", true);
      return;
    }
    setBusyUserActionId(userId);
    try {
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_user_name",
          userId,
          fullName: cleaned,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onFeedback(data.error || "Error actualizando nombre", true);
        return;
      }
      onFeedback(`Nombre actualizado (${cleaned}) para @${username}.`);
      setEditingNameUserId(null);
      setNewFullNameValue("");
      await onRefresh();
    } catch {
      onFeedback("Error de red al actualizar nombre.", true);
    } finally {
      setBusyUserActionId(null);
    }
  }

  async function handleToggleUserActive(user: AppUserItem) {
    if (busyUserActionId !== null) return;
    setBusyUserActionId(user.user_id);
    try {
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_user_active",
          userId: user.user_id,
          isActive: !user.is_active,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        onFeedback(data.error || "Error cambiando estado de usuario", true);
        return;
      }
      onFeedback(
        `Usuario ${user.username} ${!user.is_active ? "activado" : "desactivado"}.`
      );
      setConfirmToggleUser(null);
      await onRefresh();
    } catch {
      onFeedback("Error de red cambiando estado de usuario.", true);
    } finally {
      setBusyUserActionId(null);
    }
  }

  const displaySalesPen = selectedMonthRow
    ? Number(selectedMonthRow.sales_total_pen ?? 0)
    : Number(kpiQ1.total_sales_pen ?? 0);
  const displayCollectedPen = selectedMonthRow
    ? Number(selectedMonthRow.cash_collected_pen ?? 0)
    : Number(kpiQ1.collected_sales_pen ?? 0);
  const displayArPendingPen = selectedMonthRow
    ? Number(selectedMonthRow.ar_pending_pen ?? 0)
    : Number(kpiQ1.accounts_receivable_pen ?? 0);
  const ratioPct = selectedMonthRow
    ? totalMerchOutflow > 0
      ? (totalNonOpexDrain / totalMerchOutflow) * 100
      : totalNonOpexDrain > 0
        ? 100
        : 0
    : Number(kpiQ1.non_opex_vs_reinvestment_ratio_pct ?? 0);
  const gapPct = Number(kpiQ1.reconciliation_gap_pct ?? 0);

  return (
    <div className="min-w-0 space-y-5">
      {/* Period Selector */}
      {monthlyRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#E7E5E0] bg-white px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-[#18181B]">Filtro de período</p>
            <p className="text-[11px] text-[#5C5A55]">
              {selectedMonthRow
                ? `Viendo ${formatMonthLabel(selectedMonthRow.period_month)} (${Number(
                    selectedMonthRow.order_count ?? 0
                  )} pedidos)`
                : `Acumulado histórico (${String(kpiQ1.period_start)} – ${String(
                    kpiQ1.period_end
                  )})`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Filtrar período de indicadores"
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className={`${INPUT_CLASS} py-1.5 text-xs font-medium`}
            >
              <option value="ALL">Todos los períodos (acumulado)</option>
              {monthlyRows.map((m) => (
                <option key={m.period_month} value={m.period_month}>
                  {formatMonthLabel(m.period_month)}
                </option>
              ))}
            </select>
            {periodFilter !== "ALL" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPeriodFilter("ALL")}
              >
                Ver todo
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Top 4 Executive KPI Cards */}
      <section
        aria-label="Indicadores ejecutivos"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <Card padding="md" className="space-y-1.5">
          <span className="text-xs font-medium text-[#5C5A55]">
            {selectedMonthRow
              ? `Ventas (${formatMonthLabel(selectedMonthRow.period_month)})`
              : `Ventas totales (${String(kpiQ1.period_start)} – ${String(
                  kpiQ1.period_end
                )})`}
          </span>
          <p className="text-2xl font-semibold text-[#18181B] tabular-nums">
            {formatPen(displaySalesPen)}
          </p>
          <span className="inline-flex items-center rounded-lg border border-[#D4E0EC] bg-[#F2F6FA] px-2 py-0.5 text-xs font-semibold text-[#0F2942] tabular-nums">
            Cobrado: {formatPen(displayCollectedPen)}
          </span>
        </Card>

        <Card padding="md" className="space-y-1.5">
          <span className="text-xs font-medium text-[#5C5A55]">
            {selectedMonthRow
              ? `Por cobrar (${formatMonthLabel(selectedMonthRow.period_month)})`
              : "Cuentas por cobrar (pendientes)"}
          </span>
          <p className="text-2xl font-semibold text-[#B91C1C] tabular-nums">
            {formatPen(displayArPendingPen)}
          </p>
          <span className="inline-block text-xs font-medium text-[#5C5A55] tabular-nums">
            {dynamicOpenDebtorsCount} pedidos pendientes globales
          </span>
        </Card>

        <Card padding="md" className="space-y-1.5">
          <span className="text-xs font-medium text-[#5C5A55]">
            Retiros no operativos vs reinversión
          </span>
          <p className="text-2xl font-semibold text-[#B45309] tabular-nums">
            {ratioPct.toFixed(2)}%
          </p>
          <Badge tone={ratioPct > 30 ? "danger" : "success"}>
            {ratioPct > 30
              ? "ALERTA RETIROS ELEVADOS"
              : String(kpiQ1.reinvestment_health_flag)}{" "}
            (Meta &lt; 30%)
          </Badge>
        </Card>

        <Card padding="md" className="space-y-1.5">
          <span className="text-xs font-medium text-[#5C5A55]">
            Brecha arqueo efectivo ruta
          </span>
          <p className="text-2xl font-semibold text-[#18181B] tabular-nums">
            {formatPen(kpiQ1.reconciliation_gap_pen)}{" "}
            <span className="text-sm font-medium text-[#5C5A55]">
              ({gapPct.toFixed(2)}%)
            </span>
          </p>
          <Badge tone={gapPct > 1 ? "warning" : "success"}>
            {String(kpiQ1.reconciliation_health_flag)}
          </Badge>
        </Card>
      </section>

      {/* Complete Cash Reconciliation Strip */}
      <details className="rounded-2xl border border-[#E7E5E0] bg-white p-3 sm:p-4">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]">
          <div>
            <h2 className="text-sm font-semibold text-[#18181B] sm:text-base">
              Conciliación completa de caja
            </h2>
            <p className="text-xs text-[#5C5A55]">
              Desglose de entradas, salidas e inversión histórica
            </p>
          </div>
          <span className="text-xs font-medium text-[#1E446B]">Ver detalle</span>
        </summary>
        <Card padding="md" className="mt-3 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="mt-0.5 text-xs text-[#5C5A55]">
                {selectedMonthRow
                  ? `Desglose mensual: ${formatMonthLabel(
                      selectedMonthRow.period_month
                    )}.`
                  : "Desglose integral entre operación en ruta (≥ 26 Jun) e inversión inicial pre-ruta (23–25 Jun)."}
              </p>
            </div>
            {kpiQ1.declared_net_cash_pen !== undefined &&
              kpiQ1.expected_net_cash_pen !== undefined && (
                <div className="rounded-xl border border-[#D4E0EC] bg-[#F2F6FA] px-3.5 py-2 text-xs tabular-nums">
                  <span className="text-[#1E446B]">Declarado: </span>
                  <strong className="text-[#0F2942]">
                    {formatPen(kpiQ1.declared_net_cash_pen)}
                  </strong>
                  <span className="mx-2 text-[#D4E0EC]">|</span>
                  <span className="text-[#1E446B]">Esperado: </span>
                  <strong className="text-[#0F2942]">
                    {formatPen(kpiQ1.expected_net_cash_pen)}
                  </strong>
                </div>
              )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            {[
              {
                title: "Compra Mercadería (≥ 26 Jun)",
                value: formatPen(totalMerchOutflow),
                sub: "Reinversión en mercadería y proveedores",
                dot: "bg-[#15803D]",
              },
              {
                title: "Gastos Operativos Ruta (≥ 26 Jun)",
                value: formatPen(totalRouteOpex),
                sub: "Combustible, viáticos, peajes",
                dot: "bg-[#D97706]",
              },
              {
                title: "Retiros y No Operativos (≥ 26 Jun)",
                value: formatPen(totalNonOpexDrain),
                sub: "Retiros (Socio / Gerencia) y gastos ajenos",
                dot: "bg-[#DC2626]",
              },
              {
                title: "Depósitos Internos (≥ 26 Jun)",
                value: formatPen(totalInternalDeposits),
                sub: "Traslados Caja Ruta → Bancos",
                dot: "bg-[#1E446B]",
              },
              {
                title: "Inversión Pre-Ruta (Jun 23–25)",
                value: formatPen(totalPreRouteFoundational),
                sub: "Camión + hospedaje + comisión",
                dot: "bg-[#4F46E5]",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl bg-[#FAF9F6] p-3">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#5C5A55]">
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${item.dot}`}
                    aria-hidden="true"
                  />
                  <span>{item.title}</span>
                </span>
                <p className="mt-1 text-base font-semibold text-[#18181B] tabular-nums">
                  {item.value}
                </p>
                <span className="mt-0.5 block text-[11px] text-[#5C5A55]">
                  {item.sub}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </details>

      {/* Actionable Alerts: Low Stock & Margin Risk (Above Historical Tables) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="md" className="space-y-3">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
              Alertas de Reposición — Stock Bajo (&le; 5 u.)
            </h2>
            <p className="mt-0.5 text-xs text-[#5C5A55]">
              Ordenados por mayor rotación histórica.
            </p>
          </div>
          <div className="space-y-2">
            {!biSummary?.lowStockAlerts?.length ? (
              <EmptyState title="No hay productos con stock por debajo de 5 unidades" />
            ) : (
              biSummary.lowStockAlerts.map((item) => (
                <div
                  key={item.product_id}
                  className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[#E7E5E0] bg-[#FAF9F6]/60 p-2.5 text-xs sm:flex-nowrap"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[#18181B]">{item.name}</p>
                    <p className="mt-0.5 text-[11px] text-[#5C5A55] tabular-nums">
                      {item.sku} · Stock:{" "}
                      <strong
                        className={
                          Number(item.stock_on_hand) <= 0
                            ? "text-[#B91C1C]"
                            : "text-[#B45309]"
                        }
                      >
                        {Number(item.stock_on_hand)} {item.unit_of_measure}
                      </strong>{" "}
                      · Vendidos: {Number(item.total_units_sold)} {item.unit_of_measure}
                      {item.ref_cost_pen !== null
                        ? ` · Costo: ${formatPen(item.ref_cost_pen)}`
                        : " · Sin costo"}
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    aria-label={`Registrar compra de ${item.sku} (${item.name})`}
                    onClick={() => onGoToPurchaseProduct(item.product_id)}
                    className="flex-shrink-0"
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Comprar
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card
          tone={biSummary?.marginRiskSkus?.length ? "warning" : "default"}
          padding="md"
          className="space-y-3"
        >
          <div>
            <h2
              id="margin-risk-heading"
              className="text-sm sm:text-base font-semibold text-[#18181B]"
            >
              Productos con Margen &lt; 20% o Sin Costo (
              {biSummary?.marginRiskSkus?.length ?? 0})
            </h2>
            <p className="mt-0.5 text-xs text-[#5C5A55]">
              Edita el costo o precio mínimo en línea sin salir de esta vista.
            </p>
          </div>
          {!biSummary?.marginRiskSkus?.length ? (
            <EmptyState title="Todos los productos vendidos tienen costo y margen ≥ 20%" />
          ) : (
            <div className="space-y-2">
              {biSummary.marginRiskSkus.map((m) => (
                <div
                  key={`risk-${m.sku}`}
                  className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[#E7E5E0] bg-white p-3 text-xs"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={m.missing_cost_alert ? "danger" : "warning"}>
                        {m.missing_cost_alert ? "Sin costo" : "Margen < 20%"}
                      </Badge>
                      <span className="text-[11px] font-medium text-[#6D6A64]">
                        {m.sku}
                      </span>
                    </div>
                    <p className="font-semibold text-[#18181B]">{m.product_name}</p>
                    <p className="text-[11px] text-[#5C5A55] tabular-nums">
                      Ventas: <strong>{formatPen(m.total_revenue_pen)}</strong> · Costo:{" "}
                      {m.ref_cost_pen !== null && m.ref_cost_pen !== undefined
                        ? formatPen(m.ref_cost_pen)
                        : "Sin costo"}
                      {m.real_gross_margin_pct !== null &&
                      m.real_gross_margin_pct !== undefined
                        ? ` · Margen: ${Number(m.real_gross_margin_pct).toFixed(1)}%`
                        : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Editar producto ${m.sku} (${m.product_name})`}
                    onClick={() => onGoToEditProduct(m.sku)}
                    className="flex-shrink-0"
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                    Editar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Monthly Performance Comparative Chart + Table */}
      <Card padding="md" className="space-y-4">
        <div>
          <h2
            id="monthly-table-heading"
            className="text-sm sm:text-base font-semibold text-[#18181B]"
          >
            Comparativo Mensual — Flujo de Caja, Ventas y Pre-Ruta
          </h2>
          <p className="mt-0.5 text-xs text-[#5C5A55]">
            Ventas, cobros, compra de mercadería, gastos de ruta, no operativos y
            pre-ruta Jun 23–25.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visibleMonthlyRows.map((m) => {
            const bars = [
              {
                label: "Ventas",
                val: Number(m.sales_total_pen ?? 0),
                color: "bg-[#0F2942]",
              },
              {
                label: "Cobros",
                val: Number(m.cash_collected_pen ?? 0),
                color: "bg-[#15803D]",
              },
              {
                label: "Mercadería",
                val: Number(m.merchandise_outflow_pen ?? 0),
                color: "bg-[#1E446B]",
              },
              {
                label: "Gastos Ruta",
                val: Number(m.route_opex_pen ?? 0),
                color: "bg-[#D97706]",
              },
              {
                label: "No Operativos",
                val: Number(m.non_opex_capex_drain_pen ?? 0),
                color: "bg-[#DC2626]",
              },
              {
                label: "Pre-Ruta 23–25 Jun",
                val: Number(m.pre_route_foundational_outflow_pen ?? 0),
                color: "bg-[#4F46E5]",
              },
            ];
            return (
              <div
                key={m.period_month}
                className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6]/60 p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#18181B]">
                    {formatMonthLabel(m.period_month)}
                  </span>
                  <span className="text-[11px] font-medium text-[#5C5A55] tabular-nums">
                    {Number(m.order_count ?? 0)} pedidos · Depósitos:{" "}
                    {formatPen(m.internal_deposits_pen)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {bars.map((b) => {
                    const pct = Math.min(
                      100,
                      Math.max(b.val > 0 ? 2 : 0, (b.val / maxMonthlyBarValue) * 100)
                    );
                    return (
                      <div key={b.label} className="space-y-0.5">
                        <div className="flex justify-between text-[11px] tabular-nums">
                          <span className="text-[#5C5A55]">{b.label}</span>
                          <span className="font-semibold text-[#18181B]">
                            {formatPen(b.val)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E7E5E0]">
                          <div
                            className={`h-full rounded-full ${b.color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="monthly-table-heading"
          className="table-wrapper hidden md:block"
        >
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[#E7E5E0] bg-[#FAF9F6] text-[11px] font-semibold uppercase tracking-wide text-[#5C5A55]">
              <tr>
                <th scope="col" className="whitespace-nowrap p-2">
                  Mes
                </th>
                <th scope="col" className="whitespace-nowrap p-2 text-right">
                  Ventas
                </th>
                <th scope="col" className="whitespace-nowrap p-2 text-right">
                  Cobros
                </th>
                <th scope="col" className="whitespace-nowrap p-2 text-right">
                  Por Cobrar
                </th>
                <th scope="col" className="whitespace-nowrap p-2 text-right">
                  Mercadería
                </th>
                <th scope="col" className="whitespace-nowrap p-2 text-right">
                  Gastos Ruta
                </th>
                <th scope="col" className="whitespace-nowrap p-2 text-right">
                  No Operativos
                </th>
                <th scope="col" className="whitespace-nowrap p-2 text-right">
                  Depósitos
                </th>
                <th scope="col" className="whitespace-nowrap p-2 text-right">
                  Pre-Ruta Jun 23–25
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E7E5E0]">
              {visibleMonthlyRows.map((m) => (
                <tr key={m.period_month} className="transition hover:bg-[#FAF9F6]">
                  <td className="p-2 font-semibold text-[#18181B]">
                    {formatMonthLabel(m.period_month)}
                  </td>
                  <td className="p-2 text-right font-semibold tabular-nums">
                    {formatPen(m.sales_total_pen)}
                  </td>
                  <td className="p-2 text-right font-semibold text-[#15803D] tabular-nums">
                    {formatPen(m.cash_collected_pen)}
                  </td>
                  <td className="p-2 text-right font-semibold text-[#B91C1C] tabular-nums">
                    {formatPen(m.ar_pending_pen)}
                  </td>
                  <td className="p-2 text-right font-semibold text-[#1E446B] tabular-nums">
                    {formatPen(m.merchandise_outflow_pen)}
                  </td>
                  <td className="p-2 text-right font-semibold text-[#B45309] tabular-nums">
                    {formatPen(m.route_opex_pen)}
                  </td>
                  <td className="p-2 text-right font-semibold text-[#B91C1C] tabular-nums">
                    {formatPen(m.non_opex_capex_drain_pen)}
                  </td>
                  <td className="p-2 text-right text-[#5C5A55] tabular-nums">
                    {formatPen(m.internal_deposits_pen)}
                  </td>
                  <td className="p-2 text-right font-semibold text-[#4338CA] tabular-nums">
                    {formatPen(m.pre_route_foundational_outflow_pen)}
                  </td>
                </tr>
              ))}
            </tbody>
            {visibleMonthlyRows.length > 1 && (
              <tfoot className="border-t-2 border-[#D5D2CA] bg-[#FAF9F6] text-xs font-semibold tabular-nums">
                <tr>
                  <td className="p-2 text-[#18181B]">TOTAL ACUMULADO</td>
                  <td className="p-2 text-right text-[#18181B]">
                    {formatPen(
                      visibleMonthlyRows.reduce(
                        (s, r) => s + Number(r.sales_total_pen ?? 0),
                        0
                      )
                    )}
                  </td>
                  <td className="p-2 text-right text-[#15803D]">
                    {formatPen(
                      visibleMonthlyRows.reduce(
                        (s, r) => s + Number(r.cash_collected_pen ?? 0),
                        0
                      )
                    )}
                  </td>
                  <td className="p-2 text-right text-[#B91C1C]">
                    {formatPen(
                      visibleMonthlyRows.reduce(
                        (s, r) => s + Number(r.ar_pending_pen ?? 0),
                        0
                      )
                    )}
                  </td>
                  <td className="p-2 text-right text-[#1E446B]">
                    {formatPen(totalMerchOutflow)}
                  </td>
                  <td className="p-2 text-right text-[#B45309]">
                    {formatPen(totalRouteOpex)}
                  </td>
                  <td className="p-2 text-right text-[#B91C1C]">
                    {formatPen(totalNonOpexDrain)}
                  </td>
                  <td className="p-2 text-right text-[#5C5A55]">
                    {formatPen(totalInternalDeposits)}
                  </td>
                  <td className="p-2 text-right text-[#4338CA]">
                    {formatPen(totalPreRouteFoundational)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* Cash & Bank Account Balances */}
      {biSummary?.cashAccountsSummary && (
        <Card padding="md" className="space-y-3">
          <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
            Saldos por Caja y Banco (Movimientos Registrados)
          </h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {biSummary.cashAccountsSummary.map((acc) => {
              const net = Number(acc.net_balance_pen ?? 0);
              return (
                <div
                  key={acc.account_id}
                  className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6]/60 p-3 text-xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[#18181B]">{acc.name}</p>
                      <span className="text-[11px] text-[#5C5A55]">
                        {formatAccountTypeEs(acc.account_type)}
                      </span>
                    </div>
                    <Badge
                      tone={net >= 0 ? "success" : "danger"}
                      className="tabular-nums"
                    >
                      {formatPen(net)}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-[11px] text-[#5C5A55] tabular-nums">
                    <span>Entradas: {formatPen(acc.total_in_pen)}</span>
                    <span>Salidas: {formatPen(acc.total_out_pen)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Top Customers */}
      <Card padding="md" className="space-y-3">
        <h2
          id="top-customers-heading"
          className="text-sm sm:text-base font-semibold text-[#18181B]"
        >
          Clientes Principales ({biSummary?.topCustomers?.length ?? 0})
        </h2>
        {!biSummary?.topCustomers?.length ? (
          <EmptyState title="Sin datos de clientes todavía" />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {biSummary.topCustomers.map((c, idx) => {
                const due = Number(c.total_due_pen ?? 0);
                return (
                  <div
                    key={`mob-cust-${c.customer_name}-${idx}`}
                    className="rounded-xl bg-[#FAF9F6] p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-[#18181B]">{c.customer_name}</p>
                      <Badge tone="neutral" className="tabular-nums">
                        {c.orders_count} ped.
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 border-t border-[#E7E5E0]/80 pt-1.5 tabular-nums">
                      <div>
                        <span className="block text-[11px] text-[#5C5A55]">
                          Vendido
                        </span>
                        <strong className="text-[#18181B]">
                          {formatPen(c.total_sold_pen)}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[11px] text-[#5C5A55]">
                          Cobrado
                        </span>
                        <strong className="text-[#15803D]">
                          {formatPen(c.total_paid_pen)}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[11px] text-[#5C5A55]">Deuda</span>
                        <strong
                          className={due > 0.05 ? "text-[#B91C1C]" : "text-[#15803D]"}
                        >
                          {formatPen(due)}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="top-customers-heading"
              className="table-wrapper hidden md:block"
            >
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E7E5E0] bg-[#FAF9F6] text-[11px] font-semibold uppercase tracking-wide text-[#5C5A55]">
                  <tr>
                    <th scope="col" className="p-2">
                      Cliente
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Ped.
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Vendido
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Cobrado
                    </th>
                    <th scope="col" className="p-2 text-right">
                      Deuda
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E5E0]">
                  {biSummary.topCustomers.map((c, idx) => (
                    <tr key={`${c.customer_name}-${idx}`}>
                      <td className="p-2 font-medium text-[#18181B]">
                        {c.customer_name}
                      </td>
                      <td className="p-2 text-right tabular-nums">{c.orders_count}</td>
                      <td className="p-2 text-right font-semibold tabular-nums">
                        {formatPen(c.total_sold_pen)}
                      </td>
                      <td className="p-2 text-right font-semibold text-[#15803D] tabular-nums">
                        {formatPen(c.total_paid_pen)}
                      </td>
                      <td
                        className={`p-2 text-right font-semibold tabular-nums ${
                          Number(c.total_due_pen) > 0.05
                            ? "text-[#B91C1C]"
                            : "text-[#15803D]"
                        }`}
                      >
                        {formatPen(c.total_due_pen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Top SKUs by Revenue & Real Gross Margin */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <h2
            id="top-skus-heading"
            className="text-sm sm:text-base font-semibold text-[#18181B]"
          >
            Productos Líderes por Ingresos y Margen Bruto Real
          </h2>
          <div className="relative w-full sm:w-64">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6D6A64]">
              <SearchIcon className="h-3.5 w-3.5" />
            </span>
            <input
              type="text"
              value={skuSearch}
              onChange={(e) => setSkuSearch(e.target.value)}
              aria-label="Filtrar productos líderes por código o nombre"
              placeholder="Filtrar SKU o producto..."
              className={`${INPUT_CLASS} py-1.5 pl-9 pr-8 text-xs`}
            />
            {skuSearch && (
              <button
                type="button"
                data-compact="true"
                aria-label="Limpiar filtro de productos líderes"
                onClick={() => setSkuSearch("")}
                className="absolute inset-y-0 right-2 flex items-center text-[#6D6A64] hover:text-[#18181B] cursor-pointer"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {filteredTopSkus.length === 0 ? (
          <EmptyState title="No hay productos que coincidan con el filtro" />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {filteredTopSkus.map((sku) => {
                const marginCls = getBiMarginClass(
                  sku.gross_margin_pen,
                  sku.gross_margin_pct
                );
                return (
                  <div
                    key={`mob-sku-${String(sku.sku)}`}
                    className="rounded-xl bg-[#FAF9F6] p-3 text-xs space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[#18181B]">
                          {String(sku.product_name)}
                        </p>
                        <span className="text-[11px] text-[#6D6A64]">
                          {String(sku.sku)} · {Number(sku.total_units_sold)} u.
                        </span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Editar producto ${String(sku.sku)}`}
                        onClick={() => onGoToEditProduct(String(sku.sku))}
                      >
                        <EditIcon className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 border-t border-[#E7E5E0]/80 pt-2 tabular-nums">
                      <div>
                        <span className="block text-[11px] text-[#5C5A55]">
                          Ingresos
                        </span>
                        <strong className="text-[#18181B]">
                          {formatPen(sku.total_revenue_pen)}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[11px] text-[#5C5A55]">Margen</span>
                        <strong className={marginCls}>
                          {sku.gross_margin_pen !== null
                            ? formatPen(sku.gross_margin_pen)
                            : "-"}
                        </strong>
                      </div>
                      <div>
                        <span className="block text-[11px] text-[#5C5A55]">
                          Margen %
                        </span>
                        <strong className={marginCls}>
                          {sku.gross_margin_pct !== null
                            ? `${Number(sku.gross_margin_pct).toFixed(1)}%`
                            : "-"}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="top-skus-heading"
              className="table-wrapper hidden md:block"
            >
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E7E5E0] bg-[#FAF9F6] text-[11px] font-semibold uppercase tracking-wide text-[#5C5A55]">
                  <tr>
                    <th scope="col" className="whitespace-nowrap p-2">
                      Código / Producto
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2 text-right">
                      Unid. Vendidas
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2 text-right">
                      Ingresos
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2 text-right">
                      Costo
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2 text-right">
                      Margen Bruto
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2 text-right">
                      Margen %
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2">
                      Estado
                    </th>
                    <th scope="col" className="whitespace-nowrap p-2 text-right">
                      Acción
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E7E5E0]">
                  {filteredTopSkus.map((sku) => {
                    const marginCls = getBiMarginClass(
                      sku.gross_margin_pen,
                      sku.gross_margin_pct
                    );
                    return (
                      <tr key={String(sku.sku)}>
                        <td className="p-2 font-medium text-[#18181B]">
                          {String(sku.product_name)}
                          <span className="block text-[11px] text-[#6D6A64]">
                            {String(sku.sku)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap p-2 text-right tabular-nums">
                          {Number(sku.total_units_sold)}
                        </td>
                        <td className="whitespace-nowrap p-2 text-right font-semibold tabular-nums">
                          {formatPen(sku.total_revenue_pen)}
                        </td>
                        <td className="whitespace-nowrap p-2 text-right text-[#5C5A55] tabular-nums">
                          {sku.total_cogs_pen !== null
                            ? formatPen(sku.total_cogs_pen)
                            : "-"}
                        </td>
                        <td
                          className={`whitespace-nowrap p-2 text-right font-semibold tabular-nums ${marginCls}`}
                        >
                          {sku.gross_margin_pen !== null
                            ? formatPen(sku.gross_margin_pen)
                            : "-"}
                        </td>
                        <td
                          className={`whitespace-nowrap p-2 text-right font-semibold tabular-nums ${marginCls}`}
                        >
                          {sku.gross_margin_pct !== null
                            ? `${Number(sku.gross_margin_pct).toFixed(1)}%`
                            : "-"}
                        </td>
                        <td className="whitespace-nowrap p-2">
                          <Badge tone="neutral">
                            {formatMarginStatusEs(sku.margin_health_status)}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap p-2 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Editar producto ${String(sku.sku)}`}
                            onClick={() => onGoToEditProduct(String(sku.sku))}
                          >
                            <EditIcon className="h-3.5 w-3.5" />
                            Editar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Excel / CSV Export Center */}
      <Card tone="success" padding="md" className="space-y-3">
        <div>
          <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
            Exportar Reportes para Excel / Contador (CSV)
          </h2>
          <p className="mt-0.5 text-xs text-[#5C5A55]">
            Descarga directa compatible con Microsoft Excel en español (UTF-8, Soles y
            columnas limpias).
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {EXPORT_DATASETS.map((ds) => {
            const busy = downloadingDataset === ds.id;
            return (
              <button
                key={ds.id}
                type="button"
                disabled={downloadingDataset !== null}
                aria-label={`Descargar reporte ${ds.title} en formato CSV`}
                onClick={() => handleDownloadCsv(ds.id, ds.title)}
                className="flex flex-col justify-between rounded-xl border border-[#E7E5E0] bg-white p-3.5 text-left transition hover:border-[#0F2942] disabled:opacity-50 cursor-pointer"
              >
                <div>
                  <p className="text-xs font-semibold text-[#18181B]">{ds.title}</p>
                  <p className="mt-1 text-[11px] text-[#5C5A55]">{ds.subtitle}</p>
                </div>
                <span className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F2942] px-2.5 py-1.5 text-[11px] font-semibold text-white">
                  <DownloadIcon className="h-3.5 w-3.5" />
                  {busy ? "Descargando..." : "Descargar CSV"}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Data Quality Gaps */}
      <Card padding="md" className="space-y-3">
        <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
          Estado de Calidad de Datos e Integridad Operativa
        </h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {qualityGaps.map((g) => {
            const gapInfo = formatQualityGapEs(g.metric_code, g.recommended_action);
            return (
              <div
                key={String(g.metric_code)}
                className="rounded-xl bg-[#FAF9F6] p-3 text-xs space-y-1"
              >
                <span className="font-medium text-[#5C5A55]">{gapInfo.label}</span>
                <p className="text-sm font-semibold text-[#18181B] tabular-nums">
                  {Number(g.gap_count)} caso(s) ({formatPen(g.impacted_amount_pen)})
                </p>
                <p className="text-[11px] text-[#5C5A55]">{gapInfo.description}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Audit Flags Resolution Panel */}
      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
              Alertas Operativas y Auditoría
            </h2>
            <p className="text-xs text-[#5C5A55]">
              {auditFlagCounts
                ? `${auditFlagCounts.open} abierta(s) · ${auditFlagCounts.acknowledged} en revisión · ${auditFlagCounts.resolved} resuelta(s)`
                : `${auditFlags.length} alerta(s) registradas`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "OPEN", label: "Abiertas" },
                { id: "ACKNOWLEDGED", label: "En revisión" },
                { id: "RESOLVED", label: "Resueltas" },
                { id: "ALL", label: "Todas" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={flagFilter === opt.id}
                onClick={() => setFlagFilter(opt.id)}
                className={`min-h-[36px] sm:min-h-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                  flagFilter === opt.id
                    ? "border-[#0F2942] bg-[#0F2942] text-white"
                    : "border-[#E7E5E0] bg-white text-[#5C5A55] hover:bg-[#F2F6FA]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {(() => {
          const visibleFlags = auditFlags.filter((f) =>
            flagFilter === "ALL" ? true : f.status === flagFilter
          );
          if (visibleFlags.length === 0) {
            return <EmptyState title="Sin alertas operativas en este filtro" />;
          }
          return (
            <div className="space-y-2.5">
              {visibleFlags.slice(0, 25).map((f) => {
                const isBusy = busyFlagId === f.flag_id;
                const tone =
                  f.status === "RESOLVED"
                    ? "success"
                    : f.status === "ACKNOWLEDGED"
                      ? "brand"
                      : f.severity === "CRITICAL"
                        ? "danger"
                        : "warning";
                return (
                  <div
                    key={f.flag_id}
                    className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3 text-xs space-y-2"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={tone}>{formatAuditFlagStatusEs(f.status)}</Badge>
                          <span className="font-semibold text-[#18181B]">
                            {formatAuditFlagCodeEs(f.flag_code)}
                          </span>
                          <span className="text-[#6D6A64]">
                            ({formatEntityTableEs(f.entity_table)} #{f.entity_id})
                          </span>
                        </div>
                        <p className="text-[#18181B]">{f.message}</p>
                        {f.resolution_note && (
                          <p className="text-[11px] text-[#5C5A55]">
                            Nota: {f.resolution_note}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {f.status === "OPEN" && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-compact="true"
                            disabled={isBusy}
                            onClick={() =>
                              handleUpdateAuditFlag(f.flag_id, "ACKNOWLEDGED")
                            }
                          >
                            Revisar
                          </Button>
                        )}
                        {f.status !== "RESOLVED" ? (
                          <Button
                            type="button"
                            variant="success"
                            size="sm"
                            data-compact="true"
                            disabled={isBusy}
                            onClick={() => handleUpdateAuditFlag(f.flag_id, "RESOLVED")}
                          >
                            Resolver
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            data-compact="true"
                            disabled={isBusy}
                            onClick={() => handleUpdateAuditFlag(f.flag_id, "OPEN")}
                          >
                            Reabrir
                          </Button>
                        )}
                      </div>
                    </div>
                    {f.status !== "RESOLVED" && (
                      <input
                        type="text"
                        value={flagNoteById[f.flag_id] ?? ""}
                        onChange={(e) =>
                          setFlagNoteById((prev) => ({
                            ...prev,
                            [f.flag_id]: e.target.value,
                          }))
                        }
                        placeholder="Nota de revisión / resolución (opcional)"
                        aria-label={`Nota de resolución para alerta ${f.flag_id}`}
                        className={`${INPUT_CLASS} py-1.5 text-xs`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Card>

      {/* Team and personal password management */}
      {(currentUser?.role === "PARTNER_ADMIN" ||
        currentUser?.role === "PARTNER_MANAGER") && (
        <Card accent="horizon" padding="md" className="space-y-3.5">
          <div>
            <Badge tone="horizon">Socio / Gerencia</Badge>
            <h2 className="mt-2 text-sm sm:text-base font-semibold text-[#18181B]">
              Gestión de equipo y contraseñas ({users.length} usuarios)
            </h2>
            <p className="mt-0.5 text-xs text-[#5C5A55]">
              Actualiza los nombres visibles en la pantalla de inicio, cambia
              contraseñas temporales o activa/desactiva cuentas.
            </p>
          </div>

          <div className="space-y-2.5">
            {users.map((u) => {
              const isSelf = u.user_id === currentUser.userId;
              const isEditingPin = editingPinUserId === u.user_id;
              const isEditingName = editingNameUserId === u.user_id;
              const isBusy = busyUserActionId !== null;
              const displayName = formatTeamMemberName(u);
              const roleBadge =
                TEAM_ROLE_LABEL_BY_USERNAME[u.username] ?? formatRoleEs(u.role);

              return (
                <div
                  key={u.user_id}
                  className={`rounded-xl border p-3.5 text-xs transition ${
                    u.is_active
                      ? "border-[#E7E5E0] bg-white"
                      : "border-[#E7E5E0] bg-[#FAF9F6] opacity-75"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-[#18181B]">
                        {displayName}
                      </span>
                      <Badge tone="neutral">@{u.username}</Badge>
                      <Badge tone="brand">{roleBadge}</Badge>
                      <Badge tone={u.is_active ? "success" : "danger"}>
                        {u.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant={isEditingName ? "secondary" : "outline"}
                        size="sm"
                        disabled={isBusy}
                        aria-expanded={isEditingName}
                        aria-label={`${isEditingName ? "Cancelar edición de nombre para" : "Editar nombre de"} ${u.username}`}
                        onClick={() => {
                          setEditingPinUserId(null);
                          setEditingNameUserId(isEditingName ? null : u.user_id);
                          setNewFullNameValue(isEditingName ? "" : displayName);
                        }}
                      >
                        <EditIcon className="h-3.5 w-3.5" />
                        {isEditingName ? "Cancelar nombre" : "Editar nombre"}
                      </Button>

                      <Button
                        variant={isEditingPin ? "secondary" : "outline"}
                        size="sm"
                        disabled={isBusy}
                        aria-expanded={isEditingPin}
                        aria-label={`${isEditingPin ? "Cancelar reinicio de contraseña para" : "Reiniciar contraseña de"} ${u.username}`}
                        onClick={() => {
                          setEditingNameUserId(null);
                          setEditingPinUserId(isEditingPin ? null : u.user_id);
                          setNewPinValue("");
                        }}
                      >
                        <LockIcon className="h-3.5 w-3.5" />
                        {isEditingPin ? "Cancelar" : "Reiniciar contraseña"}
                      </Button>

                      {isSelf ? (
                        <Badge tone="neutral">Sesión actual</Badge>
                      ) : (
                        <Button
                          variant={u.is_active ? "danger" : "success"}
                          size="sm"
                          disabled={isBusy}
                          aria-label={`${u.is_active ? "Desactivar" : "Activar"} cuenta ${u.username}`}
                          onClick={() => {
                            if (u.is_active) {
                              setConfirmToggleUser(u);
                            } else {
                              void handleToggleUserActive(u);
                            }
                          }}
                        >
                          {u.is_active ? "Desactivar" : "Activar"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {isEditingName && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleUpdateName(u.user_id, u.username);
                      }}
                      className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#E7E5E0] pt-3"
                    >
                      <input
                        type="text"
                        maxLength={60}
                        value={newFullNameValue}
                        onChange={(e) => setNewFullNameValue(e.target.value)}
                        aria-label={`Nombre visible para ${u.username}`}
                        placeholder="Nombre de la persona (ej. Renzo)"
                        className={`${INPUT_CLASS} w-full sm:w-auto sm:min-w-[200px] sm:flex-1 font-medium`}
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        size="md"
                        disabled={isBusy}
                        className="w-full sm:w-auto"
                      >
                        {busyUserActionId === u.user_id
                          ? "Guardando..."
                          : "Guardar Nombre"}
                      </Button>
                    </form>
                  )}

                  {isEditingPin && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleUpdatePin(u.user_id, u.username);
                      }}
                      className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#E7E5E0] pt-3"
                    >
                      <input
                        type="password"
                        maxLength={128}
                        value={newPinValue}
                        onChange={(e) => setNewPinValue(e.target.value)}
                        aria-label={`Contraseña temporal para ${u.username}`}
                        placeholder="Temporal: 10+ caracteres, letra y número"
                        className={`${INPUT_CLASS} w-full sm:w-auto sm:min-w-[220px] sm:flex-1 font-medium`}
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        size="md"
                        disabled={isBusy}
                        className="w-full sm:w-auto"
                      >
                        {busyUserActionId === u.user_id
                          ? "Guardando..."
                          : "Guardar contraseña temporal"}
                      </Button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <ModalSheet
        open={Boolean(confirmToggleUser)}
        onClose={() => {
          if (busyUserActionId === null) setConfirmToggleUser(null);
        }}
        title="Confirmar desactivación de usuario"
        subtitle={
          confirmToggleUser
            ? `${formatTeamMemberName(confirmToggleUser)} (@${confirmToggleUser.username})`
            : undefined
        }
      >
        {confirmToggleUser && (
          <div className="space-y-4 text-xs sm:text-sm text-[#5C5A55]">
            <p>
              Al desactivar a{" "}
              <strong className="text-[#18181B]">
                {formatTeamMemberName(confirmToggleUser)}
              </strong>
              , su sesión activa quedará invalidada inmediatamente y no podrá ingresar
              hasta que vuelvas a activarlo.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busyUserActionId !== null}
                onClick={() => setConfirmToggleUser(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busyUserActionId !== null}
                onClick={() => void handleToggleUserActive(confirmToggleUser)}
              >
                {busyUserActionId !== null
                  ? "Desactivando..."
                  : "Sí, desactivar cuenta"}
              </Button>
            </div>
          </div>
        )}
      </ModalSheet>
    </div>
  );
}
