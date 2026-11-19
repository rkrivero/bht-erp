"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { CajaSubTab } from "@/components/socios/caja/caja-utils";
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
  initialCajaSubTab?: CajaSubTab | null;
  onClearInitialCajaSubTab?: () => void;
  handleTabChange: (tab: PartnerTab) => void;
  handleGoToPurchaseProduct: (target: number | PurchaseTarget) => void;
  handleGoToEditProduct: (sku: string) => void;
  onOpenRegularization?: () => void;
  setSubTabEditing: (editing: boolean) => void;
  showFeedback: ShowFeedback;
}

export function Finanzas({
  tab,
  data,
  preselectedPurchaseTarget,
  setPreselectedPurchaseTarget,
  initialCajaSubTab,
  onClearInitialCajaSubTab,
  handleTabChange,
  handleGoToPurchaseProduct,
  handleGoToEditProduct,
  onOpenRegularization,
  setSubTabEditing,
  showFeedback,
}: FinanzasProps) {
  const router = useRouter();
  const {
    catalog,
    accounts,
    ledger,
    apObligations,
    suppliers,
    recentPurchases,
    pendingOnDemand,
    unpurchasedRegularizationCount,
    routeTrips,
    dataCut,
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
          unpurchasedRegularizationCount={unpurchasedRegularizationCount}
          routeTrips={routeTrips}
          dataCut={dataCut}
          preselectedTarget={preselectedPurchaseTarget}
          onClearPreselectedTarget={() => setPreselectedPurchaseTarget(null)}
          initialSubTab={initialCajaSubTab}
          onClearInitialSubTab={onClearInitialCajaSubTab}
          onOpenDirectory={() => handleTabChange("directorio")}
          onOpenRegularization={onOpenRegularization}
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
          onOpenInventory={() => handleTabChange("stock")}
          onOpenDirectory={() => handleTabChange("directorio")}
          onOpenSeller={() => router.push("/vendedor")}
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
