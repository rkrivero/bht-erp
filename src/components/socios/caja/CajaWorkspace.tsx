"use client";

import { useEffect, useMemo, useState } from "react";
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

interface CajaWorkspaceProps {
  catalog: PartnerCatalogItem[];
  accounts: CashAccountItem[];
  ledger: CashLedgerEntry[];
  apObligations: ApObligationItem[];
  suppliers: SupplierItem[];
  recentPurchases: RecentPurchaseItem[];
  pendingOnDemand: PendingOnDemandItem[];
  routeTrips?: RouteTripDto[];
  dataCut?: DataCutSummary | null;
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
}

export default function CajaWorkspace({
  catalog,
  accounts,
  ledger,
  apObligations,
  suppliers,
  recentPurchases,
  pendingOnDemand,
  routeTrips = [],
  dataCut = null,
  preselectedTarget,
  onClearPreselectedTarget,
  onOpenDirectory,
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
      {dataCut?.bankReconciled !== true && (
        <Card tone="warning" padding="sm" className="text-xs text-bht-ink-strong">
          <strong>Saldos registrados, no conciliados:</strong> confirma caja física y
          extractos bancarios antes de usar estas cifras como dinero disponible.
          {dataCut?.lastCashLedgerDate &&
            ` · Último movimiento: ${formatDatePe(dataCut.lastCashLedgerDate)}`}
        </Card>
      )}

      <Card accent="horizon" padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid flex-1 grid-cols-2 gap-4 sm:flex sm:flex-wrap sm:items-center sm:gap-6">
            <div>
              <span className="text-xs font-medium text-bht-ink-soft">
                Saldo registrado en cuentas
              </span>
              <p className="mt-0.5 text-xl font-bold text-bht-navy-deep tabular-nums sm:text-2xl">
                {formatPen(totalCashPen)}
              </p>
            </div>
            <div>
              <span className="text-xs font-medium text-bht-ink-soft">
                Cuentas por pagar (CxP)
              </span>
              <p className="mt-0.5 text-xl font-bold text-bht-danger tabular-nums sm:text-2xl">
                {formatPen(totalOpenApPen)}
                <span className="ml-1.5 text-xs font-normal text-bht-ink-soft">
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

      {subTab === "compras" && (
        <CajaComprasTab
          catalog={catalog}
          accounts={accounts}
          apObligations={apObligations}
          suppliers={suppliers}
          recentPurchases={recentPurchases}
          pendingOnDemand={pendingOnDemand}
          defaultAccountId={defaultAccountId}
          preselectedTarget={preselectedTarget}
          onClearPreselectedTarget={onClearPreselectedTarget}
          onOpenDirectory={onOpenDirectory}
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
