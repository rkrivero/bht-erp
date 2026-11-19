"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiClientError,
  fetchJson,
  hasTopLevelKeys,
  type ResponseValidator,
} from "@/lib/api-client";
import type {
  CollectionsResponseDto,
  CustomerDebtDto,
  DebtOrderDto,
  PaginationDto,
  PartnerDashboardResponseDto,
  PartnerOrdersResponseDto,
  PurchasesResponseDto,
  QuotesResponseDto,
  RouteTripDto,
  TreasuryResponseDto,
  TripsResponseDto,
  UndoActionReceiptDto,
} from "@/lib/contracts";
import type { SellerOrderDto, SellerQuoteDto } from "@/features/seller/types";
import type {
  ApObligationItem,
  CashAccountItem,
  CashLedgerEntry,
  CurrentUserInfo,
  PartnerCatalogItem,
  PendingOnDemandItem,
  RecentPurchaseItem,
  SupplierItem,
} from "@/components/socios/types";
import type { SyncScope } from "@/lib/realtime/useLiveSync";
import type { PartnerFeedback } from "./partnerShared";

export function usePartnerData() {
  const dashboardAbortRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<SellerOrderDto[]>([]);
  const [ordersPagination, setOrdersPagination] = useState<PaginationDto | null>(null);
  const [routeTrips, setRouteTrips] = useState<RouteTripDto[]>([]);
  const [partnerQuotes, setPartnerQuotes] = useState<SellerQuoteDto[]>([]);
  const [catalog, setCatalog] = useState<PartnerCatalogItem[]>([]);
  const [debtorsByOrder, setDebtorsByOrder] = useState<DebtOrderDto[]>([]);
  const [debtorsByCustomer, setDebtorsByCustomer] = useState<CustomerDebtDto[]>([]);
  const [partnerData, setPartnerData] = useState<PartnerDashboardResponseDto | null>(
    null
  );
  const [treasuryData, setTreasuryData] = useState<TreasuryResponseDto | null>(null);
  const [purchasesData, setPurchasesData] = useState<PurchasesResponseDto | null>(null);
  const [orderAccounts, setOrderAccounts] = useState<CashAccountItem[]>([]);
  const [orderCurrentUser, setOrderCurrentUser] = useState<CurrentUserInfo | null>(
    null
  );
  const [dataRefreshSeq, setDataRefreshSeq] = useState(0);
  const [feedback, setFeedback] = useState<PartnerFeedback | null>(null);

  const showFeedback = useCallback(
    (msg: string, isError = false, undoAction?: UndoActionReceiptDto) => {
      setFeedback({ msg, isError, undoAction });
    },
    []
  );

  const refreshDashboard = useCallback(
    async (changedScopes?: SyncScope[], options?: { throwOnError?: boolean }) => {
      const scopeSet =
        changedScopes && changedScopes.length > 0
          ? new Set<SyncScope>(changedScopes)
          : null;

      const needOrders =
        !scopeSet || scopeSet.has("orders") || scopeSet.has("inventory");
      const needCollections =
        !scopeSet || scopeSet.has("collections") || scopeSet.has("orders");
      const needTreasury =
        !scopeSet ||
        scopeSet.has("treasury") ||
        scopeSet.has("collections") ||
        scopeSet.has("purchases");
      const needPurchases =
        !scopeSet ||
        scopeSet.has("purchases") ||
        scopeSet.has("inventory") ||
        scopeSet.has("orders");
      const needPartners =
        !scopeSet ||
        scopeSet.has("partners") ||
        scopeSet.has("orders") ||
        scopeSet.has("collections") ||
        scopeSet.has("treasury") ||
        scopeSet.has("purchases") ||
        scopeSet.has("inventory");

      if (
        !needOrders &&
        !needCollections &&
        !needTreasury &&
        !needPurchases &&
        !needPartners
      ) {
        return;
      }

      dashboardAbortRef.current?.abort();
      const controller = new AbortController();
      dashboardAbortRef.current = controller;
      try {
        const noStoreInit: RequestInit = {
          cache: "no-store",
          signal: controller.signal,
        };
        let partialFailure = false;
        const request = async <T>(
          enabled: boolean,
          url: string,
          validator: ResponseValidator<T>,
          required = true
        ): Promise<T | null> => {
          if (!enabled) return null;
          try {
            return await fetchJson<T>(url, noStoreInit, validator);
          } catch (error) {
            if (controller.signal.aborted) {
              return null;
            }
            if (
              error instanceof ApiClientError &&
              (error.status === 401 || error.status === 403)
            ) {
              throw error;
            }
            if (required) partialFailure = true;
            if (options?.throwOnError && required) throw error;
            return null;
          }
        };

        const [ordJson, colJson, partJson, trJson, purJson, tripsJson, quotesJson] =
          await Promise.all([
            request<PartnerOrdersResponseDto>(
              needOrders,
              "/api/orders",
              hasTopLevelKeys<PartnerOrdersResponseDto>("orders", "catalog", "accounts")
            ),
            request<CollectionsResponseDto<DebtOrderDto, CustomerDebtDto>>(
              needCollections,
              "/api/collections",
              hasTopLevelKeys<CollectionsResponseDto<DebtOrderDto, CustomerDebtDto>>(
                "byOrder",
                "byCustomer"
              )
            ),
            request<PartnerDashboardResponseDto>(
              needPartners,
              "/api/partners",
              hasTopLevelKeys<PartnerDashboardResponseDto>(
                "currentUser",
                "kpiQ1",
                "pendingOnDemand"
              )
            ),
            request<TreasuryResponseDto>(
              needTreasury,
              "/api/treasury",
              hasTopLevelKeys<TreasuryResponseDto>(
                "accounts",
                "ledger",
                "apObligations"
              )
            ),
            request<PurchasesResponseDto>(
              needPurchases,
              "/api/purchases",
              hasTopLevelKeys<PurchasesResponseDto>(
                "suppliers",
                "recentPurchases",
                "pendingOnDemand"
              )
            ),
            request<TripsResponseDto>(
              needOrders || needPartners,
              "/api/trips",
              hasTopLevelKeys<TripsResponseDto>("trips"),
              false
            ),
            request<QuotesResponseDto>(
              needOrders || needPartners,
              "/api/quotes",
              hasTopLevelKeys<QuotesResponseDto>("quotes"),
              false
            ),
          ]);

        if (controller.signal.aborted) return;

        if (ordJson) {
          setOrders(ordJson.orders || []);
          setOrdersPagination(ordJson.pagination || null);
          setCatalog(ordJson.catalog || []);
          setOrderAccounts(ordJson.accounts || []);
          if (ordJson.currentUser) {
            setOrderCurrentUser(ordJson.currentUser);
          }
        }
        if (tripsJson && Array.isArray(tripsJson.trips)) {
          setRouteTrips(tripsJson.trips);
        }
        if (quotesJson && Array.isArray(quotesJson.quotes)) {
          setPartnerQuotes(quotesJson.quotes);
        }
        if (colJson) {
          setDebtorsByOrder(colJson.byOrder || []);
          setDebtorsByCustomer(colJson.byCustomer || []);
        }
        if (partJson) {
          setPartnerData(partJson);
        }
        if (trJson) {
          setTreasuryData(trJson);
        }
        if (purJson) {
          setPurchasesData(purJson);
        }
        if (
          ordJson ||
          colJson ||
          partJson ||
          trJson ||
          purJson ||
          tripsJson ||
          quotesJson
        ) {
          setDataRefreshSeq((seq) => seq + 1);
        }

        if (!scopeSet && partialFailure) {
          showFeedback("Algunos módulos no pudieron actualizarse por completo.", true);
        } else if (!partialFailure) {
          setFeedback((prev) =>
            prev?.isError &&
            (prev.msg === "Algunos módulos no pudieron actualizarse por completo." ||
              prev.msg === "Error de red cargando el panel operativo.")
              ? null
              : prev
          );
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (
          err instanceof ApiClientError &&
          (err.status === 401 || err.status === 403)
        ) {
          router.push("/login");
          return;
        }
        if (options?.throwOnError) {
          throw err;
        }
        if (!scopeSet) {
          showFeedback("Error de red cargando el panel operativo.", true);
        }
      } finally {
        if (dashboardAbortRef.current === controller) {
          dashboardAbortRef.current = null;
          setLoading(false);
        }
      }
    },
    [router, showFeedback]
  );

  useEffect(() => () => dashboardAbortRef.current?.abort(), []);

  const loadDashboard = useCallback(async () => {
    await refreshDashboard();
  }, [refreshDashboard]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const pendingApprovals = useMemo(
    () => orders.filter((o) => o.operational_status === "PENDING_PARTNER_APPROVAL"),
    [orders]
  );

  const pendingOnDemand: PendingOnDemandItem[] =
    purchasesData?.pendingOnDemand ?? partnerData?.pendingOnDemand ?? [];
  const kpiQ1 = partnerData?.kpiQ1 ?? null;
  const kpiQ2TopSkus = partnerData?.kpiQ2TopSkus ?? [];
  const qualityGaps = partnerData?.qualityGaps ?? [];
  const negStockCount = Number(partnerData?.negativeStockSkuCount ?? 0);
  const unpurchasedRegularizationCount = Number(
    partnerData?.unpurchasedRegularizationCount ?? 0
  );
  const currentUser = partnerData?.currentUser ?? orderCurrentUser ?? null;
  const biSummary = partnerData?.biSummary ?? null;
  const dataCut = partnerData?.dataCut ?? null;
  const operationalQuality = partnerData?.operationalQuality ?? null;
  const appUsers = partnerData?.users ?? [];
  const userAccessHistory = partnerData?.userAccessHistory ?? [];

  const accounts: CashAccountItem[] =
    purchasesData?.accounts || treasuryData?.accounts || orderAccounts;
  const ledger: CashLedgerEntry[] = treasuryData?.ledger ?? [];
  const apObligations = useMemo<ApObligationItem[]>(
    () => purchasesData?.apObligations || treasuryData?.apObligations || [],
    [purchasesData?.apObligations, treasuryData?.apObligations]
  );
  const suppliers: SupplierItem[] =
    purchasesData?.suppliers || treasuryData?.suppliers || [];
  const recentPurchases: RecentPurchaseItem[] = purchasesData?.recentPurchases ?? [];

  const openApCount = useMemo(
    () =>
      apObligations.filter((ap) => ap.status === "OPEN" || ap.status === "PARTIAL")
        .length,
    [apObligations]
  );

  const openDebtorsCount = Number(
    partnerData?.openDebtorsCount ?? kpiQ1?.open_debtors_count ?? debtorsByOrder.length
  );

  const brokenPromisesCount = useMemo(
    () =>
      debtorsByOrder.filter((item) => String(item.promiseStatus) === "PROMISE_BROKEN")
        .length,
    [debtorsByOrder]
  );

  return {
    loading,
    orders,
    setOrders,
    ordersPagination,
    setOrdersPagination,
    routeTrips,
    partnerQuotes,
    catalog,
    debtorsByOrder,
    debtorsByCustomer,
    partnerData,
    feedback,
    setFeedback,
    showFeedback,
    refreshDashboard,
    loadDashboard,
    pendingApprovals,
    pendingOnDemand,
    kpiQ1,
    kpiQ2TopSkus,
    qualityGaps,
    negStockCount,
    unpurchasedRegularizationCount,
    currentUser,
    biSummary,
    dataCut,
    operationalQuality,
    appUsers,
    userAccessHistory,
    accounts,
    ledger,
    apObligations,
    suppliers,
    recentPurchases,
    openApCount,
    openDebtorsCount,
    brokenPromisesCount,
    dataRefreshSeq,
  };
}

export type PartnerData = ReturnType<typeof usePartnerData>;
