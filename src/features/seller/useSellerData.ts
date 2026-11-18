"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, fetchJson, hasTopLevelKeys } from "@/lib/api-client";
import type { CashAccountItem, CurrentUserInfo } from "@/components/socios/types";
import type {
  CollectionsResponseDto,
  CustomerDebtDto,
  DebtOrderDto,
  OrdersResponseDto,
  QuotesResponseDto,
} from "@/lib/contracts";
import { readOfflineSnapshot, saveOfflineSnapshot } from "@/lib/offline/outbox";
import type { SyncScope } from "@/lib/realtime/useLiveSync";
import type {
  SellerCatalogItemDto,
  SellerCustomerDto,
  SellerFeedbackSetter,
  SellerOfflineReferenceSnapshot,
  SellerOrderDto,
  SellerQuoteDto,
} from "@/features/seller/types";
import { SELLER_LAST_ACTOR_STORAGE_KEY } from "@/features/seller/seller-utils";

type LoadOptions = { silent?: boolean };
type CollectionsDto = CollectionsResponseDto<DebtOrderDto, CustomerDebtDto>;

/**
 * Loads and keeps fresh every remote collection the seller workspace needs
 * (orders, catalog, customers, cash accounts, quotes, debtors) and falls back
 * to the offline reference snapshot when the network is unavailable.
 */
export function useSellerData(setFeedback: SellerFeedbackSetter) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(null);
  const [quotes, setQuotes] = useState<SellerQuoteDto[]>([]);
  const [catalog, setCatalog] = useState<SellerCatalogItemDto[]>([]);
  const [customers, setCustomers] = useState<SellerCustomerDto[]>([]);
  const [sellerAccounts, setSellerAccounts] = useState<CashAccountItem[]>([]);
  const [orders, setOrders] = useState<SellerOrderDto[]>([]);
  const [debtorsByOrder, setDebtorsByOrder] = useState<DebtOrderDto[]>([]);
  const [debtorsByCustomer, setDebtorsByCustomer] = useState<CustomerDebtDto[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const hasLoadedRef = useRef(false);

  const loadOrdersAndCatalog = useCallback(
    async (opts?: LoadOptions) => {
      const silent = opts?.silent ?? hasLoadedRef.current;
      try {
        const [ordData, quotesData] = await Promise.all([
          fetchJson<OrdersResponseDto>(
            "/api/orders",
            { cache: "no-store" },
            hasTopLevelKeys<OrdersResponseDto>("orders", "catalog", "accounts")
          ),
          fetchJson<QuotesResponseDto>(
            "/api/quotes",
            { cache: "no-store" },
            hasTopLevelKeys<QuotesResponseDto>("quotes")
          ).catch(() => null),
        ]);
        if (ordData.currentUser) {
          setCurrentUser(ordData.currentUser);
          try {
            // Tab-scoped identity avoids exposing a previous worker's snapshot
            // when several people share the same device.
            sessionStorage.setItem(
              SELLER_LAST_ACTOR_STORAGE_KEY,
              String(ordData.currentUser.username)
            );
          } catch {
            // Online operation remains available if browser storage is blocked.
          }
        }
        if (quotesData) setQuotes(quotesData.quotes);
        setCatalog(ordData.catalog || []);
        setCustomers(Array.isArray(ordData.customers) ? ordData.customers : []);
        setSellerAccounts(Array.isArray(ordData.accounts) ? ordData.accounts : []);
        setOrders(ordData.orders || []);
        if (ordData.currentUser?.username) {
          await saveOfflineSnapshot(
            String(ordData.currentUser.username),
            "references",
            {
              catalog: ordData.catalog || [],
              customers: Array.isArray(ordData.customers) ? ordData.customers : [],
              accounts: Array.isArray(ordData.accounts) ? ordData.accounts : [],
              savedAt: new Date().toISOString(),
            }
          ).catch(() => {
            // IndexedDB may be unavailable in private browsing; online mode remains usable.
          });
        }
        return true;
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          (error.status === 401 || error.status === 403)
        ) {
          router.push("/login");
          return false;
        }
        let lastActor: string | null = null;
        try {
          lastActor = sessionStorage.getItem(SELLER_LAST_ACTOR_STORAGE_KEY);
        } catch {
          // No offline snapshot can be selected safely without a tab identity.
        }
        if (lastActor && navigator.onLine === false) {
          const snapshot = await readOfflineSnapshot<SellerOfflineReferenceSnapshot>(
            lastActor,
            "references"
          ).catch(() => null);
          if (snapshot) {
            setCurrentUser(
              (previous) =>
                previous ?? {
                  userId: 0,
                  username: lastActor,
                  fullName: lastActor,
                  role: "EXTERNAL_SELLER",
                }
            );
            setCatalog(snapshot.catalog);
            setCustomers(snapshot.customers);
            setSellerAccounts(snapshot.accounts);
            if (!silent) {
              setFeedback({
                type: "warn",
                msg: "Estás sin conexión. Puedes crear pedidos, cobros y gastos; quedarán pendientes de sincronización.",
              });
            }
            return true;
          }
        }
        if (!silent) {
          setFeedback({
            type: "err",
            msg: "Error de red cargando pedidos y catálogo.",
          });
        }
        return false;
      }
    },
    [router, setFeedback]
  );

  const loadCollections = useCallback(
    async (opts?: LoadOptions) => {
      const silent = opts?.silent ?? hasLoadedRef.current;
      try {
        const colData = await fetchJson<CollectionsDto>(
          "/api/collections",
          { cache: "no-store" },
          hasTopLevelKeys<CollectionsDto>("byOrder", "byCustomer")
        );
        setDebtorsByOrder(colData.byOrder || []);
        setDebtorsByCustomer(colData.byCustomer || []);
        return true;
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          (error.status === 401 || error.status === 403)
        ) {
          router.push("/login");
          return false;
        }
        if (!silent) {
          setFeedback({
            type: "err",
            msg: "Error de red cargando cartera de cobros.",
          });
        }
        return false;
      }
    },
    [router, setFeedback]
  );

  const loadAll = useCallback(
    async (opts?: LoadOptions) => {
      const silent = opts?.silent ?? hasLoadedRef.current;
      if (!silent) setInitialLoading(true);
      try {
        const [ordOk, colOk] = await Promise.all([
          loadOrdersAndCatalog({ silent }),
          loadCollections({ silent }),
        ]);
        if (ordOk && colOk) {
          hasLoadedRef.current = true;
        }
      } finally {
        if (!silent) setInitialLoading(false);
      }
    },
    [loadCollections, loadOrdersAndCatalog]
  );

  useEffect(() => {
    loadAll({ silent: false });
  }, [loadAll]);

  const handleRemoteChange = useCallback(
    async (changedScopes: SyncScope[]) => {
      const needsOrders =
        changedScopes.includes("orders") || changedScopes.includes("inventory");
      const needsCollections =
        changedScopes.includes("collections") ||
        changedScopes.includes("orders") ||
        changedScopes.includes("treasury");

      if (needsOrders && needsCollections) {
        await loadAll({ silent: true });
      } else if (needsOrders) {
        await loadOrdersAndCatalog({ silent: true });
      } else if (needsCollections) {
        await loadCollections({ silent: true });
      }
    },
    [loadAll, loadCollections, loadOrdersAndCatalog]
  );

  return {
    currentUser,
    quotes,
    catalog,
    customers,
    sellerAccounts,
    orders,
    debtorsByOrder,
    debtorsByCustomer,
    initialLoading,
    loadAll,
    loadOrdersAndCatalog,
    loadCollections,
    handleRemoteChange,
  };
}

export type SellerData = ReturnType<typeof useSellerData>;
