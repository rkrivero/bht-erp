"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Card, SegmentedControl } from "@/components/ui/Primitives";
import type { RouteTripDto } from "@/lib/contracts";
import {
  formatDatePe,
  formatPen,
  type ApObligationItem,
  type CashAccountItem,
  type CashLedgerEntry,
  type DataCutSummary,
  type PartnerCatalogItem,
  type PendingOnDemandItem,
  type RecentPurchaseItem,
  type SupplierItem,
} from "../types";
import { CajaComprasTab } from "./CajaComprasTab";
import { CajaCuentasTab } from "./CajaCuentasTab";
import { CajaGastosTab } from "./CajaGastosTab";
import { isExpenseLedgerEntry, type CajaSubTab } from "./caja-utils";

const CajaCierreTab = dynamic(() => import("./CajaCierreTab"), {
  loading: () => (
    <Card className="p-6 text-center text-sm text-bht-ink-soft" role="status">
      Preparando cierre diario…
    </Card>
  ),
});

interface CajaWorkspaceProps {
  catalog: PartnerCatalogItem[];
  accounts: CashAccountItem[];
  ledger: CashLedgerEntry[];
  apObligations: ApObligationItem[];
  suppliers: SupplierItem[];
  recentPurchases: RecentPurchaseItem[];
  pendingOnDemand: PendingOnDemandItem[];
  unpurchasedRegularizationCount?: number;
  routeTrips?: RouteTripDto[];
  dataCut?: DataCutSummary | null;
  preselectedTarget: {
    productId: number;
    quantity?: number;
    orderLineId?: number;
  } | null;
  onClearPreselectedTarget: () => void;
  initialSubTab?: CajaSubTab | null;
  onClearInitialSubTab?: () => void;
  onOpenDirectory: () => void;
  onOpenRegularization?: () => void;
  onRefresh: () => Promise<void>;
  onFeedback: (msg: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}

export default function CajaWorkspace({
  catalog,
  accounts,
  ledger,
  apObligations,
  suppliers,
  recentPurchases,
  pendingOnDemand,
  unpurchasedRegularizationCount = 0,
  routeTrips = [],
  dataCut = null,
  preselectedTarget,
  onClearPreselectedTarget,
  initialSubTab = null,
  onClearInitialSubTab,
  onOpenDirectory,
  onOpenRegularization,
  onRefresh,
  onFeedback,
  onEditingChange,
}: CajaWorkspaceProps) {
  const [subTab, setSubTab] = useState<CajaSubTab>("cuentas");

  useEffect(() => {
    if (preselectedTarget) {
      setSubTab("compras");
    }
  }, [preselectedTarget]);

  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
      onClearInitialSubTab?.();
    }
  }, [initialSubTab, onClearInitialSubTab]);

  const defaultAccountId = useMemo(() => {
    if (accounts.length === 0) return "";
    const def = accounts.find((a) => a.code === "CAJA_RUTA") || accounts[0];
    return String(def.account_id);
  }, [accounts]);

  const totalCashPen = useMemo(
    () => accounts.reduce((s, acc) => s + Number(acc.current_balance_pen ?? 0), 0),
    [accounts]
  );

  const openDocs = useMemo(
    () => apObligations.filter((ap) => ap.status === "OPEN" || ap.status === "PARTIAL"),
    [apObligations]
  );

  const totalOpenApPen = useMemo(
    () => openDocs.reduce((s, ap) => s + Number(ap.balance_due_pen ?? 0), 0),
    [openDocs]
  );

  const expenseCount = useMemo(
    () => ledger.filter(isExpenseLedgerEntry).length,
    [ledger]
  );

  return (
    <div className="min-w-0 space-y-4">
      <Card accent="horizon" padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid flex-1 grid-cols-2 gap-4 sm:flex sm:flex-wrap sm:items-center sm:gap-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
                Saldo registrado en cuentas
              </span>
              <p className="mt-1 text-xl font-extrabold tracking-[-0.03em] text-bht-navy-deep tabular-nums sm:text-2xl">
                {formatPen(totalCashPen)}
              </p>
              {dataCut?.bankReconciled !== true && (
                <span className="mt-0.5 block text-xs font-medium text-bht-ink-soft">
                  Pendiente de conciliación bancaria
                  {dataCut?.lastCashLedgerDate
                    ? ` · Últ. mov.: ${formatDatePe(dataCut.lastCashLedgerDate)}`
                    : ""}
                </span>
              )}
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-bht-steel">
                Cuentas por pagar (CxP)
              </span>
              <p className="mt-1 text-xl font-extrabold tracking-[-0.03em] text-bht-danger tabular-nums sm:text-2xl">
                {formatPen(totalOpenApPen)}
                <span className="ml-1.5 text-xs font-semibold text-bht-ink-soft">
                  ({openDocs.length})
                </span>
              </p>
            </div>
          </div>

          <SegmentedControl
            ariaLabel="Secciones de Caja"
            value={subTab}
            onChange={setSubTab}
            options={[
              { id: "cuentas", label: "Cuentas", count: accounts.length },
              { id: "cierre", label: "Cierre diario" },
              { id: "compras", label: "Compras", count: openDocs.length },
              { id: "gastos", label: "Gastos", count: expenseCount },
            ]}
          />
        </div>
      </Card>

      {subTab === "cuentas" && (
        <CajaCuentasTab
          accounts={accounts}
          ledger={ledger}
          defaultAccountId={defaultAccountId}
          onRefresh={onRefresh}
          onFeedback={onFeedback}
          onEditingChange={onEditingChange}
        />
      )}

      {subTab === "cierre" && (
        <CajaCierreTab
          onRefresh={onRefresh}
          onFeedback={onFeedback}
          onEditingChange={onEditingChange}
        />
      )}

      {subTab === "compras" && (
        <CajaComprasTab
          catalog={catalog}
          accounts={accounts}
          apObligations={apObligations}
          suppliers={suppliers}
          recentPurchases={recentPurchases}
          pendingOnDemand={pendingOnDemand}
          unpurchasedRegularizationCount={unpurchasedRegularizationCount}
          defaultAccountId={defaultAccountId}
          preselectedTarget={preselectedTarget}
          onClearPreselectedTarget={onClearPreselectedTarget}
          onOpenDirectory={onOpenDirectory}
          onOpenRegularization={onOpenRegularization}
          onRefresh={onRefresh}
          onFeedback={onFeedback}
          onEditingChange={onEditingChange}
        />
      )}

      {subTab === "gastos" && (
        <CajaGastosTab
          accounts={accounts}
          ledger={ledger}
          routeTrips={routeTrips}
          defaultAccountId={defaultAccountId}
          onRefresh={onRefresh}
          onFeedback={onFeedback}
          onEditingChange={onEditingChange}
        />
      )}
    </div>
  );
}
