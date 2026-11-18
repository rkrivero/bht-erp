"use client";

import dynamic from "next/dynamic";
import { Card, SegmentedControl } from "@/components/ui/Primitives";
import type { PartnerData } from "./usePartnerData";
import type { PartnerTab, PurchaseTarget, ShowFeedback } from "./partnerShared";

const DeferredSection = () => (
  <Card
    className="p-8 text-center text-sm font-medium text-[var(--ink-secondary)]"
    role="status"
  >
    Preparando sección…
  </Card>
);

const CajaProveedoresTab = dynamic(
  () => import("@/components/socios/CajaProveedoresTab"),
  { loading: DeferredSection }
);
const KpisBiTab = dynamic(() => import("@/components/socios/KpisBiTab"), {
  loading: DeferredSection,
});

interface FinanzasProps {
  tab: PartnerTab;
  data: PartnerData;
  preselectedPurchaseTarget: PurchaseTarget | null;
  setPreselectedPurchaseTarget: (target: PurchaseTarget | null) => void;
  handleTabChange: (tab: PartnerTab) => void;
  handleGoToPurchaseProduct: (target: number | PurchaseTarget) => void;
  handleGoToEditProduct: (sku: string) => void;
  setSubTabEditing: (editing: boolean) => void;
  showFeedback: ShowFeedback;
}

export function Finanzas({
  tab,
  data,
  preselectedPurchaseTarget,
  setPreselectedPurchaseTarget,
  handleTabChange,
  handleGoToPurchaseProduct,
  handleGoToEditProduct,
  setSubTabEditing,
  showFeedback,
}: FinanzasProps) {
  const {
    partnerData,
    catalog,
    accounts,
    ledger,
    apObligations,
    suppliers,
    recentPurchases,
    pendingOnDemand,
    kpiQ1,
    openDebtorsCount,
    kpiQ2TopSkus,
    qualityGaps,
    biSummary,
    loadDashboard,
  } = data;
  return (
    <div className="space-y-4">
      <SegmentedControl
        ariaLabel="Vista de finanzas y análisis"
        value={tab === "kpis" ? "kpis" : "caja"}
        onChange={(value) => handleTabChange(value as PartnerTab)}
        options={[
          { id: "caja", label: "Caja y proveedores" },
          { id: "kpis", label: "Indicadores y reportes" },
        ]}
      />
      {tab === "caja" && (
        <CajaProveedoresTab
          catalog={catalog}
          accounts={accounts}
          ledger={ledger}
          apObligations={apObligations}
          suppliers={suppliers}
          recentPurchases={recentPurchases}
          pendingOnDemand={pendingOnDemand}
          preselectedTarget={preselectedPurchaseTarget}
          onClearPreselectedTarget={() => setPreselectedPurchaseTarget(null)}
          onRefresh={loadDashboard}
          onFeedback={showFeedback}
          onEditingChange={setSubTabEditing}
        />
      )}

      {tab === "kpis" && kpiQ1 && (
        <KpisBiTab
          kpiQ1={kpiQ1}
          openDebtorsCount={openDebtorsCount}
          kpiQ2TopSkus={kpiQ2TopSkus}
          qualityGaps={qualityGaps}
          auditFlags={partnerData?.auditFlags}
          auditFlagCounts={partnerData?.auditFlagCounts}
          biSummary={biSummary}
          onGoToPurchaseProduct={handleGoToPurchaseProduct}
          onGoToEditProduct={handleGoToEditProduct}
          onRefresh={loadDashboard}
          onFeedback={showFeedback}
          onEditingChange={setSubTabEditing}
        />
      )}
    </div>
  );
}
