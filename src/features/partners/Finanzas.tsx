"use client";

import dynamic from "next/dynamic";
import { Card } from "@/components/ui/Primitives";
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

const CajaWorkspace = dynamic(() => import("@/components/socios/caja/CajaWorkspace"), {
  loading: DeferredSection,
});
const ReportesWorkspace = dynamic(
  () => import("@/components/socios/reportes/ReportesWorkspace"),
  {
    loading: DeferredSection,
  }
);

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
    catalog,
    accounts,
    ledger,
    apObligations,
    suppliers,
    recentPurchases,
    pendingOnDemand,
    routeTrips,
    loadDashboard,
    dataRefreshSeq,
  } = data;

  return (
    <div className="space-y-4">
      {tab === "caja" && (
        <CajaWorkspace
          catalog={catalog}
          accounts={accounts}
          ledger={ledger}
          apObligations={apObligations}
          suppliers={suppliers}
          recentPurchases={recentPurchases}
          pendingOnDemand={pendingOnDemand}
          routeTrips={routeTrips}
          preselectedTarget={preselectedPurchaseTarget}
          onClearPreselectedTarget={() => setPreselectedPurchaseTarget(null)}
          onOpenDirectory={() => handleTabChange("directorio")}
          onRefresh={loadDashboard}
          onFeedback={showFeedback}
          onEditingChange={setSubTabEditing}
        />
      )}

      {tab === "kpis" && (
        <ReportesWorkspace
          externalRefreshKey={dataRefreshSeq}
          onOpenCaja={() => handleTabChange("caja")}
          onOpenCollections={() => handleTabChange("deudores")}
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
