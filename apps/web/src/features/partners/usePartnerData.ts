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
} from "@/features/partners/components/types";
import {
  dispatchSyncScopeInvalidation,
  getBrowserQueryClient,
} from "@/components/providers/QueryProvider";
import { resolvePartnerNavigation } from "@/lib/navigation";
import type { SyncScope } from "@/lib/realtime/useLiveSync";
import type { PartnerFeedback, PartnerTab } from "./partnerShared";

type DatasetKey =
  "orders" | "partners" | "collections" | "treasury" | "purchases" | "trips" | "quotes";

function getTabFromLocation(): PartnerTab {
  if (typeof window === "undefined") return "control";
  try {
    return resolvePartnerNavigation(new URLSearchParams(window.location.search))
      .legacyTab;
  } catch {
    return "control";
  }
}

function getRequiredDatasetsForTab(tab: PartnerTab): Set<DatasetKey> {
  switch (tab) {
    case "control":
      return new Set<DatasetKey>([
        "orders",
        "partners",
        "collections",
        "purchases",
        "trips",
        "quotes",
      ]);
    case "pedidos":
      return new Set<DatasetKey>(["orders", "partners", "quotes", "trips"]);
    case "deudores":
      return new Set<DatasetKey>(["orders", "partners", "collections"]);
    case "stock":
      return new Set<DatasetKey>(["orders", "partners", "purchases"]);
    case "caja":
      return new Set<DatasetKey>([
        "orders",
        "partners",
        "treasury",
        "purchases",
        "collections",
        "trips",
      ]);
    case "kpis":
      return new Set<DatasetKey>(["orders", "partners"]);
    case "directorio":
    case "accesos":
    default:
      return new Set<DatasetKey>(["orders", "partners"]);
  }
}

export function usePartnerData(externalActiveTab?: PartnerTab) {
  const datasetAbortMapRef = useRef<Map<string, AbortController>>(new Map());
  const loadedDatasetsRef = useRef<Set<DatasetKey>>(new Set());
  const activeTabRef = useRef<PartnerTab>(externalActiveTab ?? "control");
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<PartnerTab>(
    () => externalActiveTab ?? getTabFromLocation()
  );
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

  useEffect(() => {
    if (externalActiveTab) {
      activeTabRef.current = externalActiveTab;
      setActiveTab(externalActiveTab);
    }
  }, [externalActiveTab]);

  useEffect(() => {
    if (typeof window === "undefined" || externalActiveTab) return;
    const syncTab = () => {
      const next = getTabFromLocation();
      if (activeTabRef.current !== next) {
        activeTabRef.current = next;
        setActiveTab(next);
      }
    };
    syncTab();
    window.addEventListener("popstate", syncTab);

    return () => {
      window.removeEventListener("popstate", syncTab);
    };
  }, [externalActiveTab]);

  const showFeedback = useCallback(
    (msg: string, isError = false, undoAction?: UndoActionReceiptDto) => {
      setFeedback({ msg, isError, undoAction });
    },
    []
  );

  const refreshDashboard = useCallback(
    async (
      changedScopes?: SyncScope[],
      options?: {
        throwOnError?: boolean;
        targetTab?: PartnerTab;
        onlyMissing?: boolean;
      }
    ) => {
      const tabForLoad = options?.targetTab ?? activeTabRef.current;
      const tabDatasets = getRequiredDatasetsForTab(tabForLoad);
      const loaded = loadedDatasetsRef.current;

      const scopeSet =
        changedScopes && changedScopes.length > 0
          ? new Set<SyncScope>(changedScopes)
          : null;

      if (scopeSet) {
        dispatchSyncScopeInvalidation(changedScopes!);
      }

      const shouldLoad = (ds: DatasetKey, scopeMatch: boolean): boolean => {
        if (options?.onlyMissing) {
          return tabDatasets.has(ds) && !loaded.has(ds);
        }
        if (!scopeSet) {
          return tabDatasets.has(ds) || loaded.has(ds);
        }
        return (tabDatasets.has(ds) || loaded.has(ds)) && scopeMatch;
      };

      const needOrders = shouldLoad(
        "orders",
        !scopeSet || scopeSet.has("orders") || scopeSet.has("inventory")
      );
      const needPartners = shouldLoad(
        "partners",
        !scopeSet ||
          scopeSet.has("partners") ||
          scopeSet.has("orders") ||
          scopeSet.has("collections") ||
          scopeSet.has("treasury") ||
          scopeSet.has("purchases") ||
          scopeSet.has("inventory")
      );
      const needCollections = shouldLoad(
        "collections",
        !scopeSet || scopeSet.has("collections") || scopeSet.has("orders")
      );
      const needTreasury = shouldLoad(
        "treasury",
        !scopeSet ||
          scopeSet.has("treasury") ||
          scopeSet.has("collections") ||
          scopeSet.has("purchases")
      );
      const needPurchases = shouldLoad(
        "purchases",
        !scopeSet ||
          scopeSet.has("purchases") ||
          scopeSet.has("inventory") ||
          scopeSet.has("orders")
      );
      const needTrips = shouldLoad(
        "trips",
        !scopeSet || scopeSet.has("orders") || scopeSet.has("partners")
      );
      const needQuotes = shouldLoad(
        "quotes",
        !scopeSet || scopeSet.has("orders") || scopeSet.has("partners")
      );

      if (
        !needOrders &&
        !needCollections &&
        !needTreasury &&
        !needPurchases &&
        !needPartners &&
        !needTrips &&
        !needQuotes
      ) {
        return;
      }

      const requestKey = [
        needOrders ? "orders" : "",
        needPartners ? "partners" : "",
        needCollections ? "collections" : "",
        needTreasury ? "treasury" : "",
        needPurchases ? "purchases" : "",
        needTrips ? "trips" : "",
        needQuotes ? "quotes" : "",
      ]
        .filter(Boolean)
        .join(",");
      datasetAbortMapRef.current.get(requestKey)?.abort();
      const controller = new AbortController();
      datasetAbortMapRef.current.set(requestKey, controller);
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
              needTrips,
              "/api/trips",
              hasTopLevelKeys<TripsResponseDto>("trips"),
              false
            ),
            request<QuotesResponseDto>(
              needQuotes,
              "/api/quotes",
              hasTopLevelKeys<QuotesResponseDto>("quotes"),
              false
            ),
          ]);

        if (controller.signal.aborted) return;

        const queryClient = getBrowserQueryClient();

        if (ordJson) {
          loadedDatasetsRef.current.add("orders");
          queryClient.setQueryData(["orders", "partner-dashboard"], ordJson);
          setOrders(ordJson.orders || []);
          setOrdersPagination(ordJson.pagination || null);
          setCatalog(ordJson.catalog || []);
          setOrderAccounts(ordJson.accounts || []);
          if (ordJson.currentUser) {
            setOrderCurrentUser(ordJson.currentUser);
          }
        }
        if (tripsJson && Array.isArray(tripsJson.trips)) {
          loadedDatasetsRef.current.add("trips");
          queryClient.setQueryData(["orders", "trips"], tripsJson);
          setRouteTrips(tripsJson.trips);
        }
        if (quotesJson && Array.isArray(quotesJson.quotes)) {
          loadedDatasetsRef.current.add("quotes");
          queryClient.setQueryData(["orders", "quotes"], quotesJson);
          setPartnerQuotes(quotesJson.quotes);
        }
        if (colJson) {
          loadedDatasetsRef.current.add("collections");
          queryClient.setQueryData(["collections", "partner"], colJson);
          setDebtorsByOrder(colJson.byOrder || []);
          setDebtorsByCustomer(colJson.byCustomer || []);
        }
        if (partJson) {
          loadedDatasetsRef.current.add("partners");
          queryClient.setQueryData(["partners", "dashboard"], partJson);
          setPartnerData(partJson);
        }
        if (trJson) {
          loadedDatasetsRef.current.add("treasury");
          queryClient.setQueryData(["treasury", "partner"], trJson);
          setTreasuryData(trJson);
        }
        if (purJson) {
          loadedDatasetsRef.current.add("purchases");
          queryClient.setQueryData(["purchases", "partner"], purJson);
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
        if (datasetAbortMapRef.current.get(requestKey) === controller) {
          datasetAbortMapRef.current.delete(requestKey);
        }
        if (datasetAbortMapRef.current.size === 0) {
          setLoading(false);
        }
      }
    },
    [router, showFeedback]
  );

  useEffect(() => {
    const map = datasetAbortMapRef.current;
    return () => {
      for (const ctrl of map.values()) ctrl.abort();
      map.clear();
    };
  }, []);

  const loadDashboard = useCallback(async () => {
    await refreshDashboard();
  }, [refreshDashboard]);

  const didMountRef = useRef(false);

  // Initial load on mount + lazy-load secondary datasets when switching tabs
  useEffect(() => {
    activeTabRef.current = activeTab;
    if (!didMountRef.current) {
      didMountRef.current = true;
      void refreshDashboard(undefined, { targetTab: activeTab });
      return;
    }
    void refreshDashboard(undefined, {
      targetTab: activeTab,
      onlyMissing: true,
    });
  }, [activeTab, refreshDashboard]);

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
  const cashFlowSummary =
    treasuryData?.cashFlowSummary ?? partnerData?.cashFlowSummary ?? null;
  const appUsers = partnerData?.users ?? [];
  const userAccessHistory = partnerData?.userAccessHistory ?? [];

  const accounts: CashAccountItem[] =
    treasuryData?.accounts || purchasesData?.accounts || orderAccounts;
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
    cashFlowSummary,
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
