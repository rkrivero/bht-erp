"use client";

import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import {
  AbonoModal,
  type AbonoCashAccountOption,
  CREDIT_DAY_CHIPS,
  DebtorDetailModal,
  type DebtOrderLineDetail,
  PromiseFilterBar,
  PromiseStatusPill,
} from "@/components/shared/CollectionControls";
import {
  AppHeader,
  BottomNav,
  DesktopSidebar,
  type NavTabItem,
} from "@/components/ui/AppShell";
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  MinusIcon,
  PackageIcon,
  PlusIcon,
  ReceiptIcon,
  SearchIcon,
  ShoppingBagIcon,
  TrashIcon,
  WalletIcon,
} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
  SegmentedControl,
  ToastBanner,
} from "@/components/ui/Primitives";
import {
  formatFulfillmentModeEs,
  formatOperationalStatusEs,
  formatPaymentModeEs,
  formatUnitTitleEs,
} from "@/lib/labels-es";
import { OUTFLOW_CATEGORIES_BY_BUCKET } from "@/lib/treasury-constants";
import {
  notifyLocalSync,
  useLiveSync,
  type SyncScope,
} from "@/lib/realtime/useLiveSync";
import {
  canonicalSellerUrl,
  resolveSellerNavigation,
  sellerUrlForLegacyTab,
  type LegacySellerTab,
} from "@/lib/navigation";
import {
  deleteOfflineSnapshot,
  readOfflineSnapshot,
  saveOfflineSnapshot,
  submitOfflineCapable,
} from "@/lib/offline/outbox";

const SELLER_SYNC_SCOPES: SyncScope[] = [
  "orders",
  "inventory",
  "collections",
  "treasury",
];
const SELLER_DRAFT_STORAGE_KEY = "bht_vendedor_order_draft_v1";
const SELLER_DRAFT_ACTOR_STORAGE_KEY = "bht_vendedor_order_draft_actor_v1";
const SELLER_LAST_ACTOR_STORAGE_KEY = "bht_vendedor_last_actor_v1";

interface SellerOfflineReferenceSnapshot {
  catalog: CatalogItem[];
  customers: CustomerOption[];
  accounts: AbonoCashAccountOption[];
  savedAt: string;
}

interface SellerOrderDraft {
  customerNameRaw: string;
  selectedCustomer: CustomerOption | null;
  paymentMode: "CASH" | "CREDIT" | "YAPE_PLIN" | "TRANSFER";
  collectOnDelivery: boolean;
  creditDays: number;
  customPromiseDate: string;
  initialPaidPen: string;
  notes: string;
  cart: CartLine[];
}

interface CustomerOption {
  party_id: number;
  name: string;
  doc_number?: string | null;
  phone?: string | null;
  address?: string | null;
}

const CANCEL_DRAFT_REASONS = [
  { code: "PRICE_TOO_HIGH", label: "Precio alto o competencia" },
  { code: "NO_STOCK_OR_DELAY", label: "Sin stock o demora de entrega" },
  { code: "NO_LIQUIDITY", label: "Sin liquidez / crédito no aprobado" },
  { code: "CHANGED_MIND", label: "Cliente postergó o cambió de opinión" },
  { code: "ORDER_ERROR", label: "Error al armar el pedido" },
  { code: "OTHER", label: "Otro motivo" },
] as const;

const ORDER_EDIT_REASONS = [
  { code: "CUSTOMER_INCREASED", label: "Aumentó el pedido" },
  { code: "ENTRY_ERROR", label: "Error al registrar" },
  { code: "PRODUCT_CHANGE", label: "Cambió productos" },
  { code: "PRODUCT_QUALITY", label: "Calidad del producto" },
  { code: "BETTER_PRICE_ELSEWHERE", label: "Consiguió otro precio" },
  { code: "CHANGED_MIND", label: "Cambio de opinión" },
  { code: "OTHER", label: "Otro" },
] as const;

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const FRACTIONAL_UOMS = new Set(["KGM", "MTR"]);

function isFractionalUom(uom?: string | null): boolean {
  return FRACTIONAL_UOMS.has((uom || "NIU").trim().toUpperCase());
}

function normalizeOrderQuantity(qty: number, fractional: boolean): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return fractional ? Math.round(qty * 1000) / 1000 : Math.floor(qty);
}

interface CatalogItem {
  product_id: number;
  sku: string;
  name: string;
  unit_of_measure: string;
  fulfillment_mode: "STOCKED" | "ON_DEMAND";
  stock_on_hand: number;
  list_sale_price_pen: number | null;
  min_sale_price_pen: number | null;
}

interface CartLine {
  product: CatalogItem;
  quantity: number;
  quantityInput: string;
  unitDiscountPen: number;
}

interface OrderDebtItem {
  orderId: number;
  orderCode: string;
  orderDate: string;
  customerKey?: string;
  customerPartyId: number | null;
  customerName: string;
  paymentMode: string;
  operationalStatus: string;
  totalPen: number;
  paidPen: number;
  balanceDuePen: number;
  daysOverdue: number;
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  promisedPaymentDate: string | null;
  promiseStatus:
    "DUE_TODAY_OR_TOMORROW" | "PROMISE_BROKEN" | "ON_SCHEDULE" | "NO_PROMISE_DATE";
  paymentCount: number;
  lastPaymentDate: string | null;
  createdByName?: string | null;
  lines?: DebtOrderLineDetail[];
}

interface CustomerDebtSummary {
  customerKey: string;
  customerPartyId: number | null;
  customerName: string;
  openOrdersCount: number;
  totalSoldPen: number;
  totalPaidPen: number;
  totalBalanceDuePen: number;
  maxDaysOverdue: number;
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  earliestPromisedPaymentDate: string | null;
  promiseStatus: string;
}

interface QuoteLineItem {
  quote_line_id: number;
  line_no: number;
  product_id: number | null;
  sku: string | null;
  unit_of_measure: string;
  raw_description: string;
  quantity: number;
  unit_price_pen: number;
  line_total_pen: number;
}

interface QuoteItem {
  quote_id: number;
  quote_code: string;
  issue_date: string;
  customer_party_id: number | null;
  customer_name: string;
  currency: string;
  tax_regime: string;
  total_pen: number;
  status: "OPEN" | "CONVERTED" | "EXPIRED" | "CANCELLED";
  related_cpe: string | null;
  seller_name: string | null;
  notes: string | null;
  converted_order_code: string | null;
  lines: QuoteLineItem[];
}

type SellerTab = LegacySellerTab;

export default function VendedorPage() {
  const router = useRouter();
  const [tab, setTab] = useState<SellerTab>("nuevo");
  useEffect(() => {
    const syncFromUrl = () => {
      const current = new URL(window.location.href);
      const resolved = resolveSellerNavigation(current.searchParams);
      setTab(resolved.legacyTab);
      const canonical = canonicalSellerUrl(current);
      if (canonical.search !== current.search) {
        router.replace(canonical.pathname + canonical.search + canonical.hash, { scroll: false });
      }
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [router]);
  const handleTabChange = useCallback((nextTab: SellerTab) => {
    setTab(nextTab);
    const current = new URL(window.location.href);
    const url = sellerUrlForLegacyTab(current, nextTab);
    if (url.search !== current.search) {
      window.history.pushState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [busyQuoteId, setBusyQuoteId] = useState<number | null>(null);
  const [busyCreateQuote, setBusyCreateQuote] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    userId: number;
    username: string;
    fullName: string;
    role: string;
  } | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [sellerAccounts, setSellerAccounts] = useState<AbonoCashAccountOption[]>([]);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [debtorsByOrder, setDebtorsByOrder] = useState<OrderDebtItem[]>([]);
  const [debtorsByCustomer, setDebtorsByCustomer] = useState<CustomerDebtSummary[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchProduct, setSearchProduct] = useState("");
  const deferredSearchProduct = useDeferredValue(searchProduct);
  const [showAllCatalog, setShowAllCatalog] = useState(false);

  const [customerNameRaw, setCustomerNameRaw] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const deferredCustomerQuery = useDeferredValue(customerNameRaw);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerBoxRef = useRef<HTMLDivElement | null>(null);
  const [expandedDiscountIds, setExpandedDiscountIds] = useState<
    Record<number, boolean>
  >({});
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [editingOrderCode, setEditingOrderCode] = useState("");
  const [editReasonCode, setEditReasonCode] = useState("CUSTOMER_INCREASED");
  const [editReasonNote, setEditReasonNote] = useState("");
  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelReasonCode, setCancelReasonCode] = useState<string>("CHANGED_MIND");
  const [cancelCustomNote, setCancelCustomNote] = useState("");
  const [busyCancelDraft, setBusyCancelDraft] = useState(false);
  const [paymentMode, setPaymentMode] = useState<
    "CASH" | "CREDIT" | "YAPE_PLIN" | "TRANSFER"
  >("CASH");
  const [collectOnDelivery, setCollectOnDelivery] = useState<boolean>(true);
  const [creditDays, setCreditDays] = useState<number>(7);
  const [customPromiseDate, setCustomPromiseDate] = useState<string>("");
  const [initialPaidPen, setInitialPaidPen] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [busyOrder, setBusyOrder] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "ok" | "warn" | "err";
    msg: string;
  } | null>(null);

  // Debtors state
  const [debtorView, setDebtorView] = useState<"orders" | "customers">("orders");
  const [promiseFilter, setPromiseFilter] = useState<string>("ALL");
  const [debtorSearch, setDebtorSearch] = useState("");
  const deferredDebtorSearch = useDeferredValue(debtorSearch);
  const [selectedOrderForAbono, setSelectedOrderForAbono] =
    useState<OrderDebtItem | null>(null);
  const [selectedCustomerForFifo, setSelectedCustomerForFifo] =
    useState<CustomerDebtSummary | null>(null);
  const [debtDetailTarget, setDebtDetailTarget] = useState<
    | {
        mode: "customer";
        customerKey: string;
        customerName: string;
        customerPartyId: number | null;
      }
    | { mode: "order"; orderId: number }
    | null
  >(null);
  const [abonoAmount, setAbonoAmount] = useState("");
  const [abonoMode, setAbonoMode] = useState<"CASH" | "YAPE_PLIN" | "TRANSFER">("CASH");
  const [abonoNextDays, setAbonoNextDays] = useState<number>(7);
  const [abonoAccountId, setAbonoAccountId] = useState<string>("");
  const [busyAbono, setBusyAbono] = useState(false);
  const [timelineOrderId, setTimelineOrderId] = useState<number | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<
    Array<Record<string, unknown>>
  >([]);
  const [timelineLoadingId, setTimelineLoadingId] = useState<number | null>(null);

  // Expenses state
  const [expenseCategory, setExpenseCategory] = useState("COMBUSTIBLE");
  const [expenseDate, setExpenseDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Lima",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date())
  );
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDesc, setExpenseDesc] = useState("");
  const [busyExpense, setBusyExpense] = useState(false);

  const hasLoadedRef = useRef(false);
  const draftHydratedRef = useRef(false);

  useEffect(() => {
    let active = true;
    const hydrateDraft = async () => {
      let actor: string | null = null;
      let savedDraft: SellerOrderDraft | null = null;
      try {
        if (navigator.onLine) {
          const response = await fetch("/api/erp/session", { cache: "no-store" });
          const data = response.ok ? await response.json() : null;
          actor =
            typeof data?.session?.username === "string" ? data.session.username : null;
          if (actor) sessionStorage.setItem(SELLER_LAST_ACTOR_STORAGE_KEY, actor);
        } else {
          actor = sessionStorage.getItem(SELLER_LAST_ACTOR_STORAGE_KEY);
        }
      } catch {
        // Only use the tab identity when truly offline; avoid stale data on server errors.
        if (navigator.onLine === false) {
          try {
            actor = sessionStorage.getItem(SELLER_LAST_ACTOR_STORAGE_KEY);
          } catch {
            actor = null;
          }
        }
      }
      if (actor) {
        savedDraft = await readOfflineSnapshot<SellerOrderDraft>(
          actor,
          "order-draft"
        ).catch(() => null);
        if (!savedDraft) {
          try {
            const draftActor = sessionStorage.getItem(SELLER_DRAFT_ACTOR_STORAGE_KEY);
            const raw = sessionStorage.getItem(SELLER_DRAFT_STORAGE_KEY);
            if (draftActor === actor && raw) savedDraft = JSON.parse(raw);
          } catch {
            // A bad or unavailable session draft does not block the screen.
          }
        }
      }
      if (active && savedDraft && typeof savedDraft === "object") {
        if (typeof savedDraft.customerNameRaw === "string")
          setCustomerNameRaw(savedDraft.customerNameRaw);
        if (savedDraft.selectedCustomer)
          setSelectedCustomer(savedDraft.selectedCustomer);
        if (
          savedDraft.paymentMode === "CASH" ||
          savedDraft.paymentMode === "CREDIT" ||
          savedDraft.paymentMode === "YAPE_PLIN" ||
          savedDraft.paymentMode === "TRANSFER"
        ) {
          setPaymentMode(savedDraft.paymentMode);
        }
        if (typeof savedDraft.collectOnDelivery === "boolean")
          setCollectOnDelivery(savedDraft.collectOnDelivery);
        if (typeof savedDraft.creditDays === "number")
          setCreditDays(savedDraft.creditDays);
        if (typeof savedDraft.customPromiseDate === "string")
          setCustomPromiseDate(savedDraft.customPromiseDate);
        if (typeof savedDraft.initialPaidPen === "string")
          setInitialPaidPen(savedDraft.initialPaidPen);
        if (typeof savedDraft.notes === "string") setNotes(savedDraft.notes);
        if (Array.isArray(savedDraft.cart)) setCart(savedDraft.cart);
      }
      if (active) draftHydratedRef.current = true;
    };
    void hydrateDraft();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    const draft: SellerOrderDraft = {
      customerNameRaw,
      selectedCustomer,
      paymentMode,
      collectOnDelivery,
      creditDays,
      customPromiseDate,
      initialPaidPen,
      notes,
      cart,
    };
    const hasDraft = Boolean(cart.length || customerNameRaw.trim() || notes.trim());
    let actor = currentUser?.username || null;
    try {
      actor ||= sessionStorage.getItem(SELLER_LAST_ACTOR_STORAGE_KEY);
      if (!hasDraft) {
        sessionStorage.removeItem(SELLER_DRAFT_STORAGE_KEY);
        sessionStorage.removeItem(SELLER_DRAFT_ACTOR_STORAGE_KEY);
      } else if (actor) {
        sessionStorage.setItem(SELLER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
        sessionStorage.setItem(SELLER_DRAFT_ACTOR_STORAGE_KEY, actor);
      }
    } catch {
      // ignore sessionStorage failure
    }
    if (actor) {
      if (hasDraft) {
        void saveOfflineSnapshot(actor, "order-draft", draft).catch(() => {
          // IndexedDB can be unavailable in private browsing.
        });
      } else {
        void deleteOfflineSnapshot(actor, "order-draft").catch(() => undefined);
      }
    }
  }, [
    currentUser?.username,
    customerNameRaw,
    selectedCustomer,
    paymentMode,
    collectOnDelivery,
    creditDays,
    customPromiseDate,
    initialPaidPen,
    notes,
    cart,
  ]);

  const loadOrdersAndCatalog = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? hasLoadedRef.current;
      try {
        const [ordRes, quotesRes] = await Promise.all([
          fetch("/api/orders", { cache: "no-store" }),
          fetch("/api/quotes", { cache: "no-store" }).catch(() => null),
        ]);
        if (ordRes.status === 401 || ordRes.status === 403) {
          router.push("/login");
          return false;
        }
        const ordData = await ordRes.json();
        if (!ordRes.ok) {
          if (!silent) {
            setFeedback({
              type: "err",
              msg: ordData.error || "No se pudo cargar pedidos y catálogo.",
            });
          }
          return false;
        }
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
        if (quotesRes && quotesRes.ok) {
          const quotesJson = await quotesRes.json();
          setQuotes(Array.isArray(quotesJson.quotes) ? quotesJson.quotes : []);
        }
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
      } catch {
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
    [router]
  );

  const loadCollections = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? hasLoadedRef.current;
      try {
        const colRes = await fetch("/api/collections", { cache: "no-store" });
        if (colRes.status === 401 || colRes.status === 403) {
          router.push("/login");
          return false;
        }
        const colData = await colRes.json();
        if (!colRes.ok) {
          if (!silent) {
            setFeedback({
              type: "err",
              msg: colData.error || "No se pudo cargar la cartera de cobros.",
            });
          }
          return false;
        }
        setDebtorsByOrder(colData.byOrder || []);
        setDebtorsByCustomer(colData.byCustomer || []);
        return true;
      } catch {
        if (!silent) {
          setFeedback({
            type: "err",
            msg: "Error de red cargando cartera de cobros.",
          });
        }
        return false;
      }
    },
    [router]
  );

  const loadAll = useCallback(
    async (opts?: { silent?: boolean }) => {
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

  const handleSyncAuthError = useCallback(() => {
    router.push("/login");
  }, [router]);

  const isAbonoModalOpen = Boolean(selectedOrderForAbono || selectedCustomerForFifo);

  const { liveStatus, triggerSync } = useLiveSync({
    scopes: SELLER_SYNC_SCOPES,
    enabled: !loggingOut && !isAbonoModalOpen,
    onRemoteChange: handleRemoteChange,
    onAuthError: handleSyncAuthError,
  });

  const addToCart = useCallback((prod: CatalogItem) => {
    const fractional = isFractionalUom(prod.unit_of_measure);
    setCart((prev) => {
      const existing = prev.find((c) => c.product.product_id === prod.product_id);
      if (existing) {
        const nextQty = normalizeOrderQuantity(
          Math.max(0, existing.quantity) + 1,
          fractional
        );
        return prev.map((c) =>
          c.product.product_id === prod.product_id
            ? {
                ...c,
                quantity: nextQty,
                quantityInput: String(nextQty),
              }
            : c
        );
      }
      return [
        ...prev,
        {
          product: prod,
          quantity: 1,
          quantityInput: "1",
          unitDiscountPen: 0,
        },
      ];
    });
  }, []);

  const isPartnerControlUser =
    currentUser?.role === "PARTNER_ADMIN" || currentUser?.role === "PARTNER_MANAGER";

  const cartQtyByProductId = useMemo(
    () => new Map(cart.map((c) => [c.product.product_id, c.quantity])),
    [cart]
  );

  const cartTotalPen = useMemo(
    () =>
      cart.reduce((sum, item) => {
        const base = item.product.list_sale_price_pen ?? 0;
        const qty = Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
        const disc = Number.isFinite(item.unitDiscountPen)
          ? Math.max(0, item.unitDiscountPen)
          : 0;
        const finalUnit = Math.max(0, base - disc);
        return sum + qty * finalUnit;
      }, 0),
    [cart]
  );

  // Cost is intentionally hidden from sellers. The backend alone decides when
  // a final price is below cost and therefore needs approval.
  const requiresPartnerApproval = false;

  const filteredCustomerSuggestions = useMemo(() => {
    const q = normalizeSearchText(deferredCustomerQuery);
    if (!q) return customers.slice(0, 8);
    const tokens = q.split(/\s+/).filter(Boolean);
    return customers
      .filter((c) => {
        const haystack = normalizeSearchText(`${c.name} ${c.doc_number ?? ""}`);
        return tokens.every((tok) => haystack.includes(tok));
      })
      .slice(0, 8);
  }, [customers, deferredCustomerQuery]);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (
        customerBoxRef.current &&
        !customerBoxRef.current.contains(e.target as Node)
      ) {
        setCustomerDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  function handleSelectCustomer(c: CustomerOption) {
    const prevAutoAddress = (selectedCustomer?.address ?? "").trim();
    const nextAddress = (c.address ?? "").trim();
    setSelectedCustomer(c);
    setCustomerNameRaw(c.name);
    setCustomerDropdownOpen(false);
    if (!notes.trim() || (prevAutoAddress && notes.trim() === prevAutoAddress)) {
      setNotes(nextAddress);
    }
  }

  function handleSelectPaymentMode(mode: "CASH" | "YAPE_PLIN" | "TRANSFER" | "CREDIT") {
    setPaymentMode(mode);
    if (mode === "YAPE_PLIN" || mode === "TRANSFER") {
      setCollectOnDelivery(false);
    } else if (mode === "CASH") {
      setCollectOnDelivery(true);
    }
  }

  function resetOrderDraft() {
    setCart([]);
    setCustomerNameRaw("");
    setSelectedCustomer(null);
    setCustomerDropdownOpen(false);
    setPaymentMode("CASH");
    setCollectOnDelivery(true);
    setCreditDays(7);
    setCustomPromiseDate("");
    setInitialPaidPen("");
    setExpandedDiscountIds({});
    setSearchProduct("");
    setShowAllCatalog(false);
    setNotes("");
    setEditingOrderId(null);
    setEditingOrderCode("");
    setEditReasonCode("CUSTOMER_INCREASED");
    setEditReasonNote("");
    try {
      sessionStorage.removeItem(SELLER_DRAFT_STORAGE_KEY);
      sessionStorage.removeItem(SELLER_DRAFT_ACTOR_STORAGE_KEY);
    } catch {
      // ignore sessionStorage failure
    }
    const actor = currentUser?.username;
    if (actor) {
      void deleteOfflineSnapshot(actor, "order-draft").catch(() => undefined);
    }
  }

  function beginEditingOrder(order: Record<string, unknown>) {
    const orderLines = Array.isArray(order.lines)
      ? (order.lines as Array<Record<string, unknown>>)
      : [];
    const nextCart: CartLine[] = [];
    for (const line of orderLines) {
      const product = catalog.find(
        (item) => item.product_id === Number(line.product_id)
      );
      if (!product) {
        setFeedback({
          type: "err",
          msg: "Uno de los productos ya no está disponible en el catálogo.",
        });
        return;
      }
      const quantity = Number(line.quantity);
      nextCart.push({
        product,
        quantity,
        quantityInput: String(quantity),
        unitDiscountPen: Number(line.unit_discount_pen ?? 0),
      });
    }
    const customer = customers.find(
      (item) => item.party_id === Number(order.customer_party_id)
    );
    const mode = String(order.payment_mode) as
      "CASH" | "CREDIT" | "YAPE_PLIN" | "TRANSFER";
    setEditingOrderId(Number(order.order_id));
    setEditingOrderCode(String(order.order_code));
    setEditReasonCode("CUSTOMER_INCREASED");
    setEditReasonNote("");
    setCart(nextCart);
    setSelectedCustomer(customer ?? null);
    setCustomerNameRaw(String(order.customer_name ?? ""));
    setPaymentMode(mode);
    setCollectOnDelivery(mode === "CASH" && Number(order.paid_pen ?? 0) <= 0.05);
    setNotes(String(order.notes ?? ""));
    setExpandedOrderId(null);
    handleTabChange("nuevo");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleConfirmCancelDraft(e: React.FormEvent) {
    e.preventDefault();
    if (busyCancelDraft) return;
    const chosen = CANCEL_DRAFT_REASONS.find((r) => r.code === cancelReasonCode);
    const reasonLabel = chosen?.label || "Otro motivo";
    setBusyCancelDraft(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "log_cancelled_draft",
          customerPartyId: selectedCustomer?.party_id ?? null,
          customerName: customerNameRaw,
          paymentMode,
          estimatedTotalPen: Number(cartTotalPen.toFixed(2)),
          itemCount: cart.length,
          items: cart.map((c) => ({
            productId: c.product.product_id,
            sku: c.product.sku,
            name: c.product.name,
            quantity: c.quantity,
            unitDiscountPen: c.unitDiscountPen,
          })),
          reasonCode: cancelReasonCode,
          reasonLabel,
          notes: cancelCustomNote.trim() || notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "err",
          msg: data.error || "No se pudo registrar el motivo de cancelación.",
        });
        return;
      }
      resetOrderDraft();
      setCancelCustomNote("");
      setCancelReasonCode("CHANGED_MIND");
      setCancelDraftOpen(false);
      setFeedback({
        type: "warn",
        msg: `Cancelación registrada (${reasonLabel}). Formulario limpiado.`,
      });
    } catch {
      setFeedback({
        type: "err",
        msg: "Error de red registrando el motivo de cancelación.",
      });
    } finally {
      setBusyCancelDraft(false);
    }
  }

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault();
    if (busyOrder) return;
    if (cart.length === 0) {
      setFeedback({
        type: "err",
        msg: "Agrega al menos un producto al pedido.",
      });
      return;
    }
    const invalidQtyLine = cart.find((c) => {
      const fractional = isFractionalUom(c.product.unit_of_measure);
      if (!Number.isFinite(c.quantity) || c.quantity <= 0) return true;
      if (!fractional && !Number.isInteger(c.quantity)) return true;
      return false;
    });
    if (invalidQtyLine) {
      const fractional = isFractionalUom(invalidQtyLine.product.unit_of_measure);
      setFeedback({
        type: "err",
        msg: fractional
          ? `Revisa la cantidad de "${invalidQtyLine.product.name}" (debe ser mayor a 0).`
          : `Revisa la cantidad de "${invalidQtyLine.product.name}" (entero mínimo 1 para ${
              invalidQtyLine.product.unit_of_measure || "NIU"
            }).`,
      });
      return;
    }

    const parsedInitialPaid =
      !requiresPartnerApproval &&
      paymentMode === "CREDIT" &&
      initialPaidPen.trim() !== ""
        ? Number(initialPaidPen)
        : 0;
    if (
      !Number.isFinite(parsedInitialPaid) ||
      parsedInitialPaid < 0 ||
      parsedInitialPaid > cartTotalPen + 0.05
    ) {
      setFeedback({
        type: "err",
        msg: "El adelanto inicial debe estar entre S/ 0.00 y el total del pedido.",
      });
      return;
    }

    setFeedback(null);
    setBusyOrder(true);
    try {
      const selectedEditReason = ORDER_EDIT_REASONS.find(
        (item) => item.code === editReasonCode
      );
      if (
        editingOrderId !== null &&
        editReasonCode === "OTHER" &&
        !editReasonNote.trim()
      ) {
        setFeedback({ type: "err", msg: "Describe brevemente el otro motivo." });
        return;
      }
      const payload = {
        action: editingOrderId === null ? "create" : "update",
        orderId: editingOrderId ?? undefined,
        reason:
          editingOrderId === null
            ? undefined
            : editReasonCode === "OTHER"
              ? `Otro: ${editReasonNote.trim()}`
              : selectedEditReason?.label || "Ajuste operativo",
        customerPartyId: selectedCustomer ? selectedCustomer.party_id : null,
        customerNameRaw,
        paymentMode,
        collectOnDelivery:
          paymentMode !== "CREDIT"
            ? requiresPartnerApproval
              ? true
              : collectOnDelivery
            : undefined,
        creditDays: paymentMode === "CREDIT" ? creditDays : undefined,
        promisedPaymentDate:
          paymentMode === "CREDIT" && customPromiseDate ? customPromiseDate : null,
        initialPaidPen:
          !requiresPartnerApproval && paymentMode === "CREDIT" && parsedInitialPaid > 0
            ? parsedInitialPaid
            : undefined,
        notes,
        lines: cart.map((c) => {
          const fractional = isFractionalUom(c.product.unit_of_measure);
          return {
            productId: c.product.product_id,
            quantity: normalizeOrderQuantity(c.quantity, fractional),
            unitDiscountPen: Number.isFinite(c.unitDiscountPen)
              ? Math.max(0, c.unitDiscountPen)
              : 0,
          };
        }),
      };
      const result =
        editingOrderId === null
          ? await submitOfflineCapable<Record<string, unknown>>({
              kind: "ORDER_CREATE",
              actorUsername: currentUser?.username || "",
              url: "/api/orders",
              body: payload,
            })
          : await fetch("/api/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }).then(async (response) => {
              const data = await response.json();
              if (!response.ok) {
                throw Object.assign(
                  new Error(data.error || "No se pudo modificar el pedido"),
                  { status: response.status }
                );
              }
              return { queued: false, data };
            });
      const wasEditing = editingOrderId !== null;
      resetOrderDraft();
      if (result.queued) {
        setFeedback({
          type: "warn",
          msg: "Pedido guardado en este dispositivo. Se enviará automáticamente cuando vuelva Internet.",
        });
        return;
      }
      const data = result.data!;
      setFeedback({
        type: data.requiresApproval ? "warn" : "ok",
        msg: wasEditing
          ? data.requiresApproval
            ? `Pedido ${data.orderCode} modificado y enviado a aprobación por precio bajo costo.`
            : `Pedido ${data.orderCode} modificado; el cambio quedó registrado.`
          : data.requiresApproval
            ? `Pedido ${data.orderCode} guardado pendiente de aprobación de Socio o Gerencia (precio bajo costo).`
            : `Pedido ${data.orderCode} registrado y enviado a Almacén.`,
      });
      notifyLocalSync(["orders", "inventory", "collections", "treasury", "partners"]);
      await loadAll({ silent: true });
    } catch (error) {
      const status = Number((error as { status?: unknown })?.status ?? 0);
      if (status === 401 || status === 403) {
        router.push("/login");
        return;
      }
      setFeedback({
        type: "err",
        msg:
          error instanceof Error
            ? error.message
            : "Error de conexión al registrar el pedido.",
      });
    } finally {
      setBusyOrder(false);
    }
  }

  async function handleSubmitAbono(e: React.FormEvent) {
    e.preventDefault();
    if (busyAbono || (!selectedOrderForAbono && !selectedCustomerForFifo)) return;
    setFeedback(null);
    setBusyAbono(true);
    try {
      const activeBalanceDue = selectedCustomerForFifo
        ? selectedCustomerForFifo.totalBalanceDuePen
        : (selectedOrderForAbono?.balanceDuePen ?? 0);
      const parsedAbono = Number(abonoAmount);
      const isFullSettlement =
        Number.isFinite(parsedAbono) && parsedAbono >= activeBalanceDue - 0.05;
      const selectedAccId = abonoAccountId ? Number(abonoAccountId) : undefined;
      const payload = selectedCustomerForFifo
        ? {
            mode: "fifo_customer",
            customerPartyId: selectedCustomerForFifo.customerPartyId,
            totalAmountPen: parsedAbono,
            paymentMode: abonoMode,
            accountId: selectedAccId,
            nextCollectionDays: isFullSettlement ? null : abonoNextDays,
            notes: "Abono general a cuenta (deudas más antiguas)",
          }
        : {
            mode: "single_order",
            orderId: selectedOrderForAbono!.orderId,
            amountPen: parsedAbono,
            paymentMode: abonoMode,
            accountId: selectedAccId,
            nextCollectionDays: isFullSettlement ? null : abonoNextDays,
            notes: "Abono registrado por Vendedor",
          };
      const result = await submitOfflineCapable<Record<string, unknown>>({
        kind: "COLLECTION",
        actorUsername: currentUser?.username || "",
        url: "/api/collections",
        body: payload,
      });
      setSelectedOrderForAbono(null);
      setSelectedCustomerForFifo(null);
      setAbonoAmount("");
      setAbonoAccountId("");
      if (result.queued) {
        setFeedback({
          type: "warn",
          msg: "Cobro guardado en este dispositivo. Se validará y sincronizará al recuperar Internet.",
        });
        return;
      }
      const data = result.data!;
      setFeedback({
        type: "ok",
        msg: selectedCustomerForFifo
          ? `Abono general aplicado a ${
              Array.isArray(data.allocations) ? data.allocations.length : 1
            } pedido(s) más antiguos.`
          : data.isSettled
            ? "¡Pedido cancelado al 100%!"
            : `Abono registrado. Nuevo saldo pendiente: S/ ${Number(
                data.newBalanceDuePen
              ).toFixed(2)}`,
      });
      notifyLocalSync(["collections", "orders", "treasury", "partners"]);
      await loadAll({ silent: true });
    } catch (error) {
      const status = Number((error as { status?: unknown })?.status ?? 0);
      if (status === 401 || status === 403) {
        router.push("/login");
        return;
      }
      setFeedback({
        type: "err",
        msg:
          error instanceof Error
            ? error.message
            : "Error de red al registrar el abono.",
      });
    } finally {
      setBusyAbono(false);
    }
  }

  async function handleOpenTimeline(orderId: number) {
    if (timelineOrderId === orderId) {
      setTimelineOrderId(null);
      return;
    }
    if (timelineLoadingId === orderId) return;
    setTimelineLoadingId(orderId);
    try {
      const res = await fetch(`/api/collections?orderId=${orderId}`, {
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "err",
          msg: data.error || "No se pudo cargar el historial de pagos.",
        });
        return;
      }
      setTimelineOrderId(orderId);
      setTimelineEntries(data.timeline || []);
    } catch {
      setFeedback({
        type: "err",
        msg: "Error de red al consultar el historial de pagos.",
      });
    } finally {
      setTimelineLoadingId(null);
    }
  }

  async function handleSubmitExpense(e: React.FormEvent) {
    e.preventDefault();
    if (busyExpense) return;
    setFeedback(null);
    setBusyExpense(true);
    try {
      const result = await submitOfflineCapable<Record<string, unknown>>({
        kind: "ROUTE_EXPENSE",
        actorUsername: currentUser?.username || "",
        url: "/api/treasury",
        body: {
          amountPen: Number(expenseAmount),
          expenseBucket: "ROUTE_OPEX",
          expenseCategory,
          txDate: expenseDate,
          description: expenseDesc,
        },
      });
      setExpenseAmount("");
      setExpenseDesc("");
      setFeedback(
        result.queued
          ? {
              type: "warn",
              msg: "Gasto guardado en este dispositivo. Se sincronizará al recuperar Internet.",
            }
          : { type: "ok", msg: "Gasto operativo registrado." }
      );
      if (result.queued) return;
      notifyLocalSync(["treasury", "partners"]);
    } catch (error) {
      const status = Number((error as { status?: unknown })?.status ?? 0);
      if (status === 401 || status === 403) {
        router.push("/login");
        return;
      }
      setFeedback({
        type: "err",
        msg:
          error instanceof Error
            ? error.message
            : "Error de conexión al guardar el gasto.",
      });
    } finally {
      setBusyExpense(false);
    }
  }

  const normalizedCatalog = useMemo(
    () =>
      catalog.map((item) => ({
        item,
        normName: normalizeSearchText(item.name),
        normSku: normalizeSearchText(item.sku),
        searchText: normalizeSearchText(`${item.name} ${item.sku}`),
      })),
    [catalog]
  );

  const filteredCatalog = useMemo(() => {
    const query = normalizeSearchText(deferredSearchProduct);
    if (!query) {
      return [...catalog].sort((a, b) => {
        const aInStock = a.stock_on_hand > 0 ? 0 : 1;
        const bInStock = b.stock_on_hand > 0 ? 0 : 1;
        if (aInStock !== bInStock) return aInStock - bInStock;
        return a.name.localeCompare(b.name, "es");
      });
    }
    const tokens = query.split(/\s+/).filter(Boolean);
    const scored: Array<{ item: CatalogItem; score: number }> = [];
    for (const entry of normalizedCatalog) {
      if (!tokens.every((tok) => entry.searchText.includes(tok))) continue;
      let score = 0;
      if (entry.normSku === query) score += 100;
      else if (entry.normSku.startsWith(query)) score += 60;
      if (entry.normName.startsWith(query)) score += 50;
      else if (entry.normName.includes(query)) score += 25;
      if (entry.item.stock_on_hand > 0) score += 15;
      scored.push({ item: entry.item, score });
    }
    scored.sort(
      (a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name, "es")
    );
    return scored.map((s) => s.item);
  }, [catalog, deferredSearchProduct, normalizedCatalog]);

  const catalogPreviewLimit = normalizeSearchText(deferredSearchProduct) ? 24 : 12;
  const visibleCatalog = useMemo(() => {
    return showAllCatalog || filteredCatalog.length <= catalogPreviewLimit
      ? filteredCatalog
      : filteredCatalog.slice(0, catalogPreviewLimit);
  }, [catalogPreviewLimit, filteredCatalog, showAllCatalog]);

  const filteredDebtOrders = useMemo(() => {
    const q = normalizeSearchText(deferredDebtorSearch);
    const tokens = q.split(/\s+/).filter(Boolean);
    return debtorsByOrder.filter((o) => {
      if (promiseFilter !== "ALL" && o.promiseStatus !== promiseFilter) {
        return false;
      }
      if (tokens.length === 0) return true;
      const haystack = normalizeSearchText(`${o.customerName} ${o.orderCode}`);
      return tokens.every((tok) => haystack.includes(tok));
    });
  }, [debtorsByOrder, promiseFilter, deferredDebtorSearch]);

  const filteredDebtorsByCustomer = useMemo(() => {
    const q = normalizeSearchText(deferredDebtorSearch);
    const tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return debtorsByCustomer;
    return debtorsByCustomer.filter((c) => {
      const haystack = normalizeSearchText(c.customerName);
      return tokens.every((tok) => haystack.includes(tok));
    });
  }, [debtorsByCustomer, deferredDebtorSearch]);

  const collectionSummary = useMemo(() => {
    const total = debtorsByOrder.reduce((sum, order) => sum + order.balanceDuePen, 0);
    const dueSoon = debtorsByOrder
      .filter((order) => order.promiseStatus === "DUE_TODAY_OR_TOMORROW")
      .reduce((sum, order) => sum + order.balanceDuePen, 0);
    const overdue = debtorsByOrder
      .filter((order) => order.promiseStatus === "PROMISE_BROKEN")
      .reduce((sum, order) => sum + order.balanceDuePen, 0);
    return { total, dueSoon, overdue };
  }, [debtorsByOrder]);

  const prioritizedDebtOrders = useMemo(() => {
    const priority = (status: string) =>
      status === "PROMISE_BROKEN" ? 0 : status === "DUE_TODAY_OR_TOMORROW" ? 1 : 2;
    return [...filteredDebtOrders].sort(
      (a, b) =>
        priority(a.promiseStatus) - priority(b.promiseStatus) ||
        b.balanceDuePen - a.balanceDuePen
    );
  }, [filteredDebtOrders]);

  async function handleCreateQuoteFromCart() {
    if (busyCreateQuote || busyOrder) return;
    if (cart.length === 0) {
      setFeedback({
        type: "err",
        msg: "Agrega al menos un producto antes de guardar la cotización.",
      });
      return;
    }
    if (!customerNameRaw.trim() && !selectedCustomer) {
      setFeedback({
        type: "err",
        msg: "Ingresa o selecciona el nombre del cliente para cotizar.",
      });
      return;
    }
    setFeedback(null);
    setBusyCreateQuote(true);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_quote",
          customerPartyId: selectedCustomer ? selectedCustomer.party_id : null,
          customerNameRaw: customerNameRaw.trim() || selectedCustomer?.name,
          notes: notes.trim() || undefined,
          lines: cart.map((c) => {
            const base = c.product.list_sale_price_pen ?? 0;
            const unitPricePen = Math.max(
              0.01,
              Number((base - Math.max(0, c.unitDiscountPen || 0)).toFixed(4))
            );
            const fractional = isFractionalUom(c.product.unit_of_measure);
            return {
              productId: c.product.product_id,
              rawDescription: c.product.name,
              quantity: normalizeOrderQuantity(c.quantity, fractional),
              unitPricePen,
            };
          }),
        }),
      });
      if (res.status === 401 || res.status === 403) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "err",
          msg: data.error || "No se pudo guardar la cotización.",
        });
        return;
      }
      resetOrderDraft();
      setFeedback({
        type: "ok",
        msg: `Cotización ${data.quoteCode} guardada por S/ ${Number(
          data.totalPen ?? 0
        ).toFixed(2)}.`,
      });
      handleTabChange("cotizaciones");
      notifyLocalSync(["orders", "partners"]);
      await loadOrdersAndCatalog({ silent: true });
    } catch {
      setFeedback({
        type: "err",
        msg: "Error de conexión al guardar la cotización.",
      });
    } finally {
      setBusyCreateQuote(false);
    }
  }

  async function handleConvertQuote(quoteId: number, mode: "CASH" | "CREDIT") {
    if (busyQuoteId === quoteId) return;
    setFeedback(null);
    setBusyQuoteId(quoteId);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "convert_to_order",
          quoteId,
          paymentMode: mode,
          collectOnDelivery: mode === "CASH",
          creditDays: mode === "CREDIT" ? 7 : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "err",
          msg: data.error || "No se pudo convertir la cotización.",
        });
        return;
      }
      setFeedback({
        type: data.order?.requiresApproval ? "warn" : "ok",
        msg: data.order?.requiresApproval
          ? `Cotización convertida a ${data.order.orderCode} (pendiente de aprobación de Socio).`
          : `Cotización convertida en pedido ${data.order?.orderCode} y enviada a Almacén.`,
      });
      notifyLocalSync(["orders", "inventory", "collections", "treasury", "partners"]);
      await loadAll({ silent: true });
    } catch {
      setFeedback({
        type: "err",
        msg: "Error de conexión al convertir la cotización.",
      });
    } finally {
      setBusyQuoteId(null);
    }
  }

  async function handleUpdateQuoteStatus(
    quoteId: number,
    nextStatus: "EXPIRED" | "CANCELLED"
  ) {
    if (busyQuoteId === quoteId) return;
    setBusyQuoteId(quoteId);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          quoteId,
          nextStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "err",
          msg: data.error || "No se pudo actualizar la cotización.",
        });
        return;
      }
      notifyLocalSync(["orders", "partners"]);
      await loadOrdersAndCatalog({ silent: true });
    } catch {
      setFeedback({
        type: "err",
        msg: "Error de conexión al actualizar la cotización.",
      });
    } finally {
      setBusyQuoteId(null);
    }
  }

  const openQuotesCount = useMemo(
    () => quotes.filter((q) => q.status === "OPEN").length,
    [quotes]
  );

  const navItems: NavTabItem<SellerTab>[] = useMemo(
    () => [
      {
        id: "nuevo",
        label: "Pedido",
        mobileLabel: "Pedido",
        icon: <ShoppingBagIcon className="h-4 w-4" />,
        badgeCount: cart.length > 0 ? cart.length : undefined,
      },
      {
        id: "cotizaciones",
        label: "Cotizaciones",
        mobileLabel: "Cotizar",
        icon: <ReceiptIcon className="h-4 w-4" />,
        badgeCount: openQuotesCount > 0 ? openQuotesCount : undefined,
      },
      {
        id: "deudores",
        label: "Cobros",
        mobileLabel: "Cobros",
        icon: <WalletIcon className="h-4 w-4" />,
        badgeCount: debtorsByOrder.length > 0 ? debtorsByOrder.length : undefined,
      },
      {
        id: "pedidos",
        label: "Mis Pedidos",
        mobileLabel: "Pedidos",
        icon: <PackageIcon className="h-4 w-4" />,
      },
      {
        id: "gastos",
        label: "Gastos",
        mobileLabel: "Gastos",
        icon: <ClockIcon className="h-4 w-4" />,
      },
    ],
    [cart.length, openQuotesCount, debtorsByOrder.length]
  );

  const activeTabLabel =
    navItems.find((item) => item.id === tab)?.label ?? "Pedido";

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await authClient.signOut();
    } finally {
      router.push("/login");
    }
  }

  const cleanSellerName =
    currentUser?.fullName &&
    !/vendedor\s+externo|socio\s+operativo|socio\s+gerente/i.test(currentUser.fullName)
      ? currentUser.fullName
      : currentUser?.username === "socio_admin"
        ? "Renzo"
        : null;
  const sellerHeaderRoleLabel =
    currentUser?.role === "PARTNER_ADMIN"
      ? `${cleanSellerName || "Renzo"} · Ventas y Control`
      : currentUser?.role === "PARTNER_MANAGER"
        ? `${cleanSellerName || "Samuel"} · Gerencia`
        : cleanSellerName
          ? `${cleanSellerName} · Vendedor S/`
          : "Vendedor · S/";
  const hasOrderDraft = Boolean(cart.length || customerNameRaw.trim() || notes.trim());

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-40 md:pb-12">
      <AppHeader
        title="Ventas y Cobranzas"
        roleLabel={sellerHeaderRoleLabel}
        roleTone="horizon"
        roleDotColor="bg-[#075EE8]"
        syncStatus={liveStatus}
        onSyncClick={() => void triggerSync({ force: true })}
        maxWidth="6xl"
        withSidebar
        actions={
          isPartnerControlUser ? (
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/socios")}
              className="min-h-[38px] sm:min-h-[40px] px-3.5 text-xs sm:text-sm"
            >
              Control Operativo
            </Button>
          ) : undefined
        }
        onLogout={handleLogout}
      />

      <DesktopSidebar
        items={navItems}
        activeId={tab}
        onChange={handleTabChange}
        areaLabel="Vendedor · Campo"
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-6xl space-y-4 px-3.5 pt-4 sm:px-5 outline-none md:ml-[232px] md:max-w-none md:px-6 lg:px-8"
      >
        <div
          className="flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3.5 py-3 text-xs"
          aria-label={`Ubicación actual: ${activeTabLabel}`}
        >
          <span className="font-medium text-[#6D6A64]">Ventas y Cobranzas</span>
          <ChevronRightIcon className="h-3.5 w-3.5 text-[#A8A49C]" aria-hidden="true" />
          <span className="font-semibold text-[#0F2942]">{activeTabLabel}</span>
        </div>

        {feedback && (
          <ToastBanner
            type={feedback.type}
            message={feedback.msg}
            onDismiss={() => setFeedback(null)}
          />
        )}

        {liveStatus === "offline" && (
          <Card
            tone="warning"
            padding="sm"
            className="text-xs leading-relaxed text-[#78350F]"
            role="status"
          >
            Sin conexión. Puedes guardar pedidos, cobros y gastos; se enviarán al
            recuperar Internet. Precio, stock y crédito se validarán al sincronizar.
          </Card>
        )}
        {tab === "nuevo" && hasOrderDraft && (
          <p className="-mt-2 px-1 text-[11px] text-[#5C5A55]" role="status">
            Borrador guardado automáticamente en este dispositivo para tu usuario.
          </p>
        )}

        {tab === "nuevo" && (
          <section aria-label="Nuevo pedido">
            <form
              onSubmit={handleSubmitOrder}
              className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-5"
            >
              {editingOrderId !== null && (
                <Card className="space-y-3 border-[#A9C7E3] bg-[#F2F6FA] lg:col-span-12">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[#0F2942]">
                        Modificando {editingOrderCode}
                      </p>
                      <p className="text-xs text-[#5C5A55]">
                        El pedido volverá a alistamiento y se guardará la versión
                        anterior.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={resetOrderDraft}
                    >
                      Cancelar edición
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <FieldLabel htmlFor="order-edit-reason">
                        Motivo del cambio
                      </FieldLabel>
                      <select
                        id="order-edit-reason"
                        value={editReasonCode}
                        onChange={(event) => setEditReasonCode(event.target.value)}
                        className={`${INPUT_CLASS} mt-1.5`}
                      >
                        {ORDER_EDIT_REASONS.map((reason) => (
                          <option key={reason.code} value={reason.code}>
                            {reason.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {editReasonCode === "OTHER" && (
                      <div>
                        <FieldLabel htmlFor="order-edit-note" required>
                          Describe el motivo
                        </FieldLabel>
                        <input
                          id="order-edit-note"
                          value={editReasonNote}
                          onChange={(event) => setEditReasonNote(event.target.value)}
                          className={`${INPUT_CLASS} mt-1.5`}
                          required
                        />
                      </div>
                    )}
                  </div>
                </Card>
              )}
              <div className="min-w-0 space-y-4 lg:col-span-7">
                {/* Step 1: Client Identification */}
                <Card className="space-y-3">
                  <div ref={customerBoxRef} className="relative">
                    <FieldLabel htmlFor="seller-customer-name" required>
                      1. Cliente o ferretería
                    </FieldLabel>
                    <div className="relative mt-1.5">
                      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6D6A64]" />
                      <input
                        id="seller-customer-name"
                        type="text"
                        required
                        autoComplete="off"
                        role="combobox"
                        aria-expanded={
                          customerDropdownOpen && filteredCustomerSuggestions.length > 0
                        }
                        aria-controls="seller-customer-listbox"
                        value={customerNameRaw}
                        onFocus={() => setCustomerDropdownOpen(true)}
                        onChange={(e) => {
                          const nextVal = e.target.value;
                          setCustomerNameRaw(nextVal);
                          if (
                            selectedCustomer &&
                            normalizeSearchText(nextVal) !==
                              normalizeSearchText(selectedCustomer.name)
                          ) {
                            setSelectedCustomer(null);
                          }
                          setCustomerDropdownOpen(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setCustomerDropdownOpen(false);
                          }
                        }}
                        placeholder="Buscar por cualquier palabra o escribir cliente nuevo..."
                        className={`${INPUT_CLASS} pl-9 pr-9 font-medium`}
                      />
                      {customerNameRaw && (
                        <button
                          type="button"
                          data-compact="true"
                          onClick={() => {
                            setCustomerNameRaw("");
                            setSelectedCustomer(null);
                            setCustomerDropdownOpen(true);
                          }}
                          aria-label="Limpiar cliente"
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#6D6A64] hover:bg-[#F4F3EF] hover:text-[#18181B] cursor-pointer"
                        >
                          <CloseIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {selectedCustomer && (
                      <p className="mt-1.5 text-[11px] font-medium text-[#15803D]">
                        Cliente vinculado ({selectedCustomer.doc_number || "registrado"}
                        {selectedCustomer.address
                          ? ` · ${selectedCustomer.address}`
                          : ""}
                        )
                      </p>
                    )}
                    {customerDropdownOpen && filteredCustomerSuggestions.length > 0 && (
                      <ul
                        id="seller-customer-listbox"
                        role="listbox"
                        aria-label="Clientes sugeridos"
                        className="absolute z-30 mt-1.5 max-h-56 w-full overflow-y-auto rounded-xl border border-[#D4E0EC] bg-white p-1 shadow-[0_12px_28px_rgba(15,41,66,0.12)]"
                      >
                        {filteredCustomerSuggestions.map((c) => (
                          <li
                            key={c.party_id}
                            role="option"
                            aria-selected={
                              selectedCustomer?.party_id === c.party_id ||
                              customerNameRaw === c.name
                            }
                          >
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectCustomer(c);
                              }}
                              onClick={() => handleSelectCustomer(c)}
                              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-left text-sm transition hover:bg-[#F2F6FA] cursor-pointer"
                            >
                              <span className="font-semibold text-[#18181B]">
                                {c.name}
                              </span>
                              {c.doc_number && (
                                <span className="flex-shrink-0 text-[11px] text-[#5C5A55] tabular-nums">
                                  {c.doc_number}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>

                {/* Step 2: Product Search & Add */}
                <Card className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="seller-search-product">
                      2. Buscar y agregar productos
                    </FieldLabel>
                    <span
                      id="seller-catalog-count"
                      className="text-[11px] text-[#5C5A55] tabular-nums"
                    >
                      {initialLoading
                        ? "Cargando..."
                        : searchProduct.trim()
                          ? `Mostrando ${filteredCatalog.length} de ${catalog.length}`
                          : `${catalog.length} disponibles`}
                    </span>
                  </div>

                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#6D6A64]"
                    >
                      <SearchIcon className="h-4 w-4" />
                    </span>
                    <input
                      id="seller-search-product"
                      type="search"
                      value={searchProduct}
                      onChange={(e) => {
                        setSearchProduct(e.target.value);
                        setShowAllCatalog(false);
                      }}
                      aria-describedby="seller-catalog-count"
                      placeholder="Buscar producto por nombre o código..."
                      className={`${INPUT_CLASS} pl-10 ${searchProduct ? "pr-10" : ""}`}
                    />
                    {searchProduct && (
                      <button
                        type="button"
                        data-compact="true"
                        onClick={() => setSearchProduct("")}
                        aria-label="Limpiar búsqueda de productos"
                        className="absolute inset-y-1 right-1.5 flex items-center justify-center rounded-lg px-2 text-[#5C5A55] hover:bg-[#F2F6FA] hover:text-[#0F2942] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/40 cursor-pointer"
                      >
                        <CloseIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 lg:max-h-[32rem] lg:overflow-y-auto lg:pr-0.5">
                    {initialLoading && catalog.length === 0 ? (
                      <p className="py-6 text-center text-xs text-[#5C5A55]">
                        Cargando catálogo de productos...
                      </p>
                    ) : filteredCatalog.length === 0 ? (
                      <p className="py-6 text-center text-xs text-[#5C5A55]">
                        No hay productos que coincidan con &ldquo;{searchProduct}
                        &rdquo;.
                      </p>
                    ) : (
                      <>
                        {visibleCatalog.map((prod) => {
                          const inCartQty =
                            cartQtyByProductId.get(prod.product_id) ?? 0;
                          return (
                            <div
                              key={prod.product_id}
                              className="flex items-center justify-between gap-3 rounded-xl border border-[#E7E5E0] bg-[#FAF9F6]/60 p-3 transition hover:border-[#D4E0EC] hover:bg-white"
                            >
                              <div className="min-w-0">
                                <p className="line-clamp-2 text-sm font-semibold text-[#18181B]">
                                  {prod.name}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5C5A55] tabular-nums">
                                  <span className="font-semibold text-[#18181B]">
                                    S/{" "}
                                    {Number(prod.list_sale_price_pen ?? 0).toFixed(2)}{" "}
                                    <span
                                      title={formatUnitTitleEs(
                                        prod.unit_of_measure || "NIU"
                                      )}
                                      className="text-[11px] font-normal text-[#6D6A64]"
                                    >
                                      / {prod.unit_of_measure || "NIU"}
                                    </span>
                                  </span>
                                  <span>
                                    · Mín: S/{" "}
                                    {Number(prod.min_sale_price_pen ?? 0).toFixed(2)}
                                  </span>
                                  <span>
                                    · Stock:{" "}
                                    <strong>
                                      {prod.stock_on_hand}{" "}
                                      {prod.unit_of_measure || "NIU"}
                                    </strong>
                                  </span>
                                  <Badge
                                    tone={
                                      prod.fulfillment_mode === "ON_DEMAND"
                                        ? "warning"
                                        : "neutral"
                                    }
                                  >
                                    {formatFulfillmentModeEs(prod.fulfillment_mode)}
                                  </Badge>
                                </div>
                              </div>
                              <Button
                                variant={inCartQty > 0 ? "primary" : "outline"}
                                size="sm"
                                onClick={() => addToCart(prod)}
                                aria-label={`Agregar ${prod.name}${
                                  inCartQty > 0 ? `, ${inCartQty} en el pedido` : ""
                                }`}
                                className="flex-shrink-0"
                              >
                                <PlusIcon className="h-3.5 w-3.5" />
                                {inCartQty > 0 ? `(${inCartQty})` : "Agregar"}
                              </Button>
                            </div>
                          );
                        })}
                        {filteredCatalog.length > catalogPreviewLimit && (
                          <div className="pt-1 text-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setShowAllCatalog((prev) => !prev)}
                              className="w-full"
                            >
                              {showAllCatalog
                                ? `Mostrar solo los primeros ${catalogPreviewLimit}`
                                : `Ver todos (${filteredCatalog.length} productos)`}
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </Card>
              </div>

              {/* Step 3: Sticky Right Cart & Order Summary (Strategic Blue Horizon Focus Zone) */}
              <div className="min-w-0 space-y-4 lg:col-span-5 lg:sticky lg:top-20">
                {cart.length === 0 && (
                  <Card
                    accent="horizon"
                    className="hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:py-10 text-center"
                  >
                    <div
                      aria-hidden="true"
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F2F6FA] text-[#0F2942]"
                    >
                      <ShoppingBagIcon className="h-5 w-5" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-[#18181B]">
                      3. Resumen, pago y envío
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-[#5C5A55]">
                      Elige cliente y agrega productos a la izquierda; luego confirma
                      aquí la forma de pago y el envío.
                    </p>
                  </Card>
                )}
                {cart.length > 0 && (
                  <Card
                    id="cart-checkout-card"
                    accent="horizon"
                    className="space-y-3.5 shadow-[0_4px_16px_rgba(15,41,66,0.05)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D4E0EC] pb-2.5">
                      <h2 className="text-sm font-semibold text-[#0F2942]">
                        3. Resumen y pago · {cart.length} producto(s)
                      </h2>
                    </div>

                    <div className="space-y-2.5">
                      {cart.map((line, idx) => {
                        const base = line.product.list_sale_price_pen ?? 0;
                        const min = line.product.min_sale_price_pen ?? base;
                        const fractional = isFractionalUom(
                          line.product.unit_of_measure
                        );
                        const safeQty = Number.isFinite(line.quantity)
                          ? Math.max(0, line.quantity)
                          : 0;
                        const safeDisc = Number.isFinite(line.unitDiscountPen)
                          ? Math.max(0, line.unitDiscountPen)
                          : 0;
                        const finalUnit = Math.max(0, base - safeDisc);
                        const belowMin = finalUnit < min - 0.001;
                        const discountOpen =
                          Boolean(expandedDiscountIds[line.product.product_id]) ||
                          safeDisc > 0;
                        return (
                          <div
                            key={line.product.product_id}
                            className={`space-y-3 rounded-xl border p-3.5 ${
                              belowMin
                                ? "border-[#F3D9B1] bg-[#FDF8F0]"
                                : "border-[#D4E0EC] bg-[#F2F6FA]/55"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-[#18181B]">
                                  {line.product.name}
                                </p>
                                <p className="text-xs text-[#5C5A55] tabular-nums">
                                  Precio lista: S/ {base.toFixed(2)}{" "}
                                  <span
                                    title={formatUnitTitleEs(
                                      line.product.unit_of_measure || "NIU"
                                    )}
                                  >
                                    / {line.product.unit_of_measure || "NIU"}
                                  </span>{" "}
                                  · Mín: S/ {min.toFixed(2)}
                                </p>
                              </div>
                              <div className="flex flex-shrink-0 items-center gap-1.5">
                                <button
                                  type="button"
                                  aria-expanded={discountOpen}
                                  onClick={() =>
                                    setExpandedDiscountIds((prev) => ({
                                      ...prev,
                                      [line.product.product_id]: !discountOpen,
                                    }))
                                  }
                                  className={`inline-flex min-h-[40px] items-center rounded-lg border px-3 py-1.5 text-xs font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 ${
                                    discountOpen
                                      ? "border-[#0F2942] bg-[#0F2942] text-white"
                                      : "border-[#D4E0EC] bg-white text-[#1E446B] hover:bg-[#F2F6FA]"
                                  }`}
                                >
                                  {safeDisc > 0
                                    ? `Desc. S/ ${safeDisc.toFixed(2)}`
                                    : discountOpen
                                      ? "Ocultar desc."
                                      : "Descuento"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedDiscountIds((prev) => {
                                      const next = { ...prev };
                                      delete next[line.product.product_id];
                                      return next;
                                    });
                                    setCart((prev) => prev.filter((_, i) => i !== idx));
                                  }}
                                  aria-label={`Quitar ${line.product.name} del pedido`}
                                  className="inline-flex min-h-[40px] items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-[#B91C1C] transition hover:bg-[#FEF2F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B91C1C]/35 cursor-pointer"
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                  Quitar
                                </button>
                              </div>
                            </div>

                            <div
                              className={`grid grid-cols-1 gap-3 ${
                                discountOpen
                                  ? "sm:grid-cols-2"
                                  : "max-w-full sm:max-w-[260px]"
                              }`}
                            >
                              <div>
                                <FieldLabel
                                  htmlFor={`cart-qty-${line.product.product_id}`}
                                >
                                  Cantidad ({line.product.unit_of_measure || "NIU"})
                                </FieldLabel>
                                <div className="mt-1 flex items-center gap-1.5">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label={`Reducir cantidad de ${line.product.name}`}
                                    onClick={() =>
                                      setCart((prev) =>
                                        prev.map((c, i) => {
                                          if (i !== idx) return c;
                                          const cur = Number.isFinite(c.quantity)
                                            ? Math.max(0, c.quantity)
                                            : 1;
                                          const nextQty = fractional
                                            ? Math.max(
                                                0.01,
                                                normalizeOrderQuantity(
                                                  cur > 1
                                                    ? cur - 1
                                                    : cur > 0.5
                                                      ? cur - 0.5
                                                      : cur - 0.1,
                                                  true
                                                ) || 0.01
                                              )
                                            : Math.max(1, Math.floor(cur) - 1);
                                          return {
                                            ...c,
                                            quantity: nextQty,
                                            quantityInput: String(nextQty),
                                          };
                                        })
                                      )
                                    }
                                    className="px-2.5"
                                  >
                                    <MinusIcon className="h-3.5 w-3.5" />
                                  </Button>
                                  <input
                                    id={`cart-qty-${line.product.product_id}`}
                                    type="number"
                                    inputMode={fractional ? "decimal" : "numeric"}
                                    min={fractional ? "0.01" : 1}
                                    step={fractional ? "any" : 1}
                                    value={line.quantityInput}
                                    onChange={(e) => {
                                      const raw = e.target.value.replace(",", ".");
                                      if (raw.trim() === "") {
                                        setCart((prev) =>
                                          prev.map((c, i) =>
                                            i === idx
                                              ? {
                                                  ...c,
                                                  quantity: 0,
                                                  quantityInput: "",
                                                }
                                              : c
                                          )
                                        );
                                        return;
                                      }
                                      const parsed = Number(raw);
                                      if (!Number.isFinite(parsed) || parsed < 0)
                                        return;
                                      const nextQty = fractional
                                        ? parsed
                                        : Math.max(0, Math.floor(parsed));
                                      setCart((prev) =>
                                        prev.map((c, i) =>
                                          i === idx
                                            ? {
                                                ...c,
                                                quantity: nextQty,
                                                quantityInput: fractional
                                                  ? raw
                                                  : String(nextQty || ""),
                                              }
                                            : c
                                        )
                                      );
                                    }}
                                    onBlur={() =>
                                      setCart((prev) =>
                                        prev.map((c, i) => {
                                          if (i !== idx) return c;
                                          const normalized = fractional
                                            ? normalizeOrderQuantity(c.quantity, true)
                                            : Math.floor(c.quantity);
                                          const valid =
                                            Number.isFinite(normalized) &&
                                            normalized > 0
                                              ? fractional
                                                ? normalized
                                                : Math.max(1, normalized)
                                              : 1;
                                          return {
                                            ...c,
                                            quantity: valid,
                                            quantityInput: String(valid),
                                          };
                                        })
                                      )
                                    }
                                    className={`${INPUT_CLASS} min-w-0 flex-1 text-center font-semibold tabular-nums`}
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    aria-label={`Aumentar cantidad de ${line.product.name}`}
                                    onClick={() =>
                                      setCart((prev) =>
                                        prev.map((c, i) => {
                                          if (i !== idx) return c;
                                          const cur = Number.isFinite(c.quantity)
                                            ? Math.max(0, c.quantity)
                                            : 0;
                                          const nextQty = fractional
                                            ? normalizeOrderQuantity(cur + 1, true) || 1
                                            : Math.max(1, Math.floor(cur) + 1);
                                          return {
                                            ...c,
                                            quantity: nextQty,
                                            quantityInput: String(nextQty),
                                          };
                                        })
                                      )
                                    }
                                    className="px-2.5"
                                  >
                                    <PlusIcon className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>

                              {discountOpen && (
                                <div>
                                  <FieldLabel
                                    htmlFor={`cart-disc-${line.product.product_id}`}
                                  >
                                    Descuento S/ /{" "}
                                    <span
                                      title={formatUnitTitleEs(
                                        line.product.unit_of_measure || "NIU"
                                      )}
                                    >
                                      {line.product.unit_of_measure || "NIU"}
                                    </span>
                                  </FieldLabel>
                                  <div className="mt-1 flex items-center gap-1.5">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      aria-label={`Reducir descuento en 1 sol para ${line.product.name}`}
                                      onClick={() =>
                                        setCart((prev) =>
                                          prev.map((c, i) =>
                                            i === idx
                                              ? {
                                                  ...c,
                                                  unitDiscountPen: Math.max(
                                                    0,
                                                    (Number.isFinite(c.unitDiscountPen)
                                                      ? c.unitDiscountPen
                                                      : 0) - 1
                                                  ),
                                                }
                                              : c
                                          )
                                        )
                                      }
                                      className="px-2.5"
                                    >
                                      <MinusIcon className="h-3.5 w-3.5" />
                                    </Button>
                                    <input
                                      id={`cart-disc-${line.product.product_id}`}
                                      type="number"
                                      step="0.01"
                                      min={0}
                                      value={
                                        Number.isFinite(line.unitDiscountPen)
                                          ? line.unitDiscountPen
                                          : 0
                                      }
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        const parsed = raw === "" ? 0 : Number(raw);
                                        if (!Number.isFinite(parsed)) return;
                                        setCart((prev) =>
                                          prev.map((c, i) =>
                                            i === idx
                                              ? {
                                                  ...c,
                                                  unitDiscountPen: Math.max(0, parsed),
                                                }
                                              : c
                                          )
                                        );
                                      }}
                                      className={`${INPUT_CLASS} min-w-0 flex-1 text-center font-semibold tabular-nums`}
                                    />
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      aria-label={`Aumentar descuento en 1 sol para ${line.product.name}`}
                                      onClick={() =>
                                        setCart((prev) =>
                                          prev.map((c, i) =>
                                            i === idx
                                              ? {
                                                  ...c,
                                                  unitDiscountPen:
                                                    (Number.isFinite(c.unitDiscountPen)
                                                      ? c.unitDiscountPen
                                                      : 0) + 1,
                                                }
                                              : c
                                          )
                                        )
                                      }
                                      className="px-2.5"
                                    >
                                      <PlusIcon className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E7E5E0]/80 pt-2 text-xs tabular-nums">
                              <span className="text-[#5C5A55]">
                                Final /{" "}
                                <span
                                  title={formatUnitTitleEs(
                                    line.product.unit_of_measure || "NIU"
                                  )}
                                >
                                  {line.product.unit_of_measure || "NIU"}
                                </span>
                                :{" "}
                                <strong className="text-[#18181B]">
                                  S/ {finalUnit.toFixed(2)}
                                </strong>
                              </span>
                              <span className="text-sm font-semibold text-[#18181B]">
                                Subtotal: S/ {(safeQty * finalUnit).toFixed(2)}
                              </span>
                            </div>

                            {belowMin && !isPartnerControlUser && (
                              <p className="flex items-start gap-1.5 text-xs font-medium text-[#B45309]">
                                <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                                <span>
                                  Precio menor al mínimo comercial (S/ {min.toFixed(2)}
                                  ). Quedará registrado; solo requiere aprobación si
                                  baja del costo.
                                </span>
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-[#0F2942] px-4 py-3.5 text-white shadow-xs">
                      <span className="text-sm font-medium text-[#D4E0EC]">
                        Total del pedido
                      </span>
                      <span className="text-xl font-semibold tabular-nums">
                        S/ {cartTotalPen.toFixed(2)}
                      </span>
                    </div>

                    {/* Step 3b: Payment Condition decided once total is known */}
                    <div className="space-y-3 rounded-xl border border-[#E7E5E0] bg-[#FAF9F6]/70 p-3.5">
                      <div>
                        <p
                          id="seller-payment-mode-label"
                          className="block text-xs font-medium text-[#5C5A55]"
                        >
                          3. Condición de pago
                        </p>
                        <div
                          role="group"
                          aria-labelledby="seller-payment-mode-label"
                          className="mt-1.5 grid grid-cols-2 gap-1.5"
                        >
                          {(
                            [
                              ["CASH", "Efectivo"],
                              ["YAPE_PLIN", "Yape / Plin"],
                              ["TRANSFER", "Transferencia"],
                              ["CREDIT", "A Crédito"],
                            ] as const
                          ).map(([mode, label]) => {
                            const active = paymentMode === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                aria-pressed={active}
                                onClick={() => handleSelectPaymentMode(mode)}
                                className={`min-h-[40px] rounded-xl border px-3 py-2 text-xs font-semibold transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 ${
                                  active
                                    ? "border-[#0F2942] bg-[#0F2942] text-white shadow-xs"
                                    : "border-[#E7E5E0] bg-white text-[#5C5A55] hover:border-[#D4E0EC] hover:bg-[#F2F6FA] hover:text-[#0F2942]"
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {paymentMode !== "CREDIT" && (
                        <SegmentedControl
                          ariaLabel="Momento de cobro"
                          value={collectOnDelivery ? "cod" : "now"}
                          onChange={(v) => setCollectOnDelivery(v === "cod")}
                          options={[
                            { id: "cod", label: "Contra Entrega" },
                            { id: "now", label: "Ya pagó hoy" },
                          ]}
                        />
                      )}

                      {paymentMode === "CREDIT" && (
                        <div className="space-y-3 rounded-xl border border-[#F3D9B1] bg-[#FDF8F0] p-3">
                          <div>
                            <p
                              id="seller-credit-days-label"
                              className="block text-xs font-medium text-[#78350F]"
                            >
                              ¿Cuándo volvemos a cobrar?
                            </p>
                            <div
                              role="group"
                              aria-labelledby="seller-credit-days-label"
                              className="mt-1.5 flex flex-wrap gap-1.5"
                            >
                              {CREDIT_DAY_CHIPS.map((chip) => {
                                const active =
                                  creditDays === chip.days && !customPromiseDate;
                                return (
                                  <button
                                    key={chip.days}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => {
                                      setCreditDays(chip.days);
                                      setCustomPromiseDate("");
                                    }}
                                    className={`min-h-[34px] rounded-full border px-2.5 py-1 text-xs font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 ${
                                      active
                                        ? "border-[#0F2942] bg-[#0F2942] text-white"
                                        : "border-[#E7D3B1] bg-white text-[#78350F] hover:bg-[#FAF9F6]"
                                    }`}
                                  >
                                    {chip.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <label
                                htmlFor="seller-custom-date"
                                className="text-xs font-medium text-[#78350F]"
                              >
                                O fecha:
                              </label>
                              <input
                                id="seller-custom-date"
                                type="date"
                                value={customPromiseDate}
                                onChange={(e) => setCustomPromiseDate(e.target.value)}
                                className="min-h-[36px] rounded-lg border border-[#E7D3B1] bg-white px-2.5 py-1 text-xs font-medium text-[#18181B] focus:border-[#0F2942] focus:outline-none focus:ring-2 focus:ring-[#0F2942]/15"
                              />
                            </div>
                          </div>

                          <div>
                            <FieldLabel
                              htmlFor="seller-initial-paid"
                              className="text-[#78350F]"
                            >
                              Adelanto inicial hoy (Opcional, S/)
                            </FieldLabel>
                            <input
                              id="seller-initial-paid"
                              type="number"
                              step="0.01"
                              min="0"
                              value={initialPaidPen}
                              onChange={(e) => setInitialPaidPen(e.target.value)}
                              placeholder="Ej. 200.00"
                              className={`${INPUT_CLASS} mt-1 tabular-nums`}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <FieldLabel htmlFor="seller-order-notes">
                        Dirección o nota para almacén (opcional)
                      </FieldLabel>
                      <input
                        id="seller-order-notes"
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Dirección de entrega o referencia..."
                        className={`${INPUT_CLASS} mt-1.5`}
                      />
                    </div>

                    <section
                      aria-labelledby="seller-confirmation-heading"
                      className="rounded-xl border border-[#D4E0EC] bg-white p-3"
                    >
                      <h3
                        id="seller-confirmation-heading"
                        className="text-xs font-semibold text-[#0F2942]"
                      >
                        4. Confirma el destino del pedido
                      </h3>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                        <dt className="text-[#5C5A55]">Cliente</dt>
                        <dd className="text-right font-medium text-[#18181B]">
                          {customerNameRaw.trim() || "Pendiente"}
                        </dd>
                        <dt className="text-[#5C5A55]">Total</dt>
                        <dd className="text-right font-semibold tabular-nums text-[#18181B]">
                          S/ {cartTotalPen.toFixed(2)}
                        </dd>
                        <dt className="text-[#5C5A55]">Modalidad</dt>
                        <dd className="text-right font-medium text-[#18181B]">
                          {formatPaymentModeEs(paymentMode)}
                        </dd>
                        <dt className="text-[#5C5A55]">Cobro inicial</dt>
                        <dd className="text-right font-medium tabular-nums text-[#18181B]">
                          {paymentMode === "CREDIT" && Number(initialPaidPen) > 0
                            ? `S/ ${Number(initialPaidPen).toFixed(2)}`
                            : paymentMode === "CREDIT"
                              ? "Sin adelanto"
                              : collectOnDelivery
                                ? "Contra entrega"
                                : "Pagado hoy"}
                        </dd>
                        <dt className="text-[#5C5A55]">Destino</dt>
                        <dd className="text-right font-medium text-[#18181B]">
                          {notes.trim() || "Almacén para alistamiento"}
                        </dd>
                      </dl>
                    </section>

                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        type="submit"
                        variant={requiresPartnerApproval ? "primary" : "success"}
                        size="lg"
                        disabled={busyOrder || busyCreateQuote}
                        className="flex-1"
                      >
                        {busyOrder
                          ? editingOrderId !== null
                            ? "Guardando cambios..."
                            : "Guardando pedido..."
                          : editingOrderId !== null
                            ? "Guardar cambios y enviar a alistamiento"
                            : requiresPartnerApproval
                              ? "Enviar Pedido a Aprobación de Socio o Gerencia"
                              : "Confirmar Pedido y Enviar a Almacén"}
                      </Button>
                      {editingOrderId === null && (
                        <Button
                          type="button"
                          variant="outline"
                          size="lg"
                          disabled={busyOrder || busyCreateQuote}
                          onClick={handleCreateQuoteFromCart}
                          className="sm:w-auto"
                        >
                          {busyCreateQuote ? "Cotizando..." : "Cotizar"}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        disabled={busyOrder || busyCancelDraft}
                        onClick={() => setCancelDraftOpen(true)}
                        className="border-[#E7E5E0] bg-[#FAF9F6] text-[#5C5A55] hover:border-[#E8C5C5] hover:bg-[#FEF2F2]/65 hover:text-[#991B1B] sm:w-auto"
                      >
                        Cancelado
                      </Button>
                    </div>
                  </Card>
                )}

                {cart.length === 0 &&
                  (customerNameRaw.trim().length > 0 || notes.trim().length > 0) && (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyCancelDraft}
                        onClick={() => setCancelDraftOpen(true)}
                        className="border-[#E7E5E0] bg-[#FAF9F6] text-[#5C5A55] hover:border-[#E8C5C5] hover:bg-[#FEF2F2]/65 hover:text-[#991B1B]"
                      >
                        Cancelado
                      </Button>
                    </div>
                  )}
              </div>
            </form>
          </section>
        )}

        {tab === "cotizaciones" && (
          <section aria-label="Cotizaciones" className="space-y-3">
            <Card
              padding="sm"
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <div>
                <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                  Cotizaciones ({quotes.length})
                </h2>
                <p className="text-xs text-[#5C5A55]">
                  Arma ítems en Pedido y usa “Cotizar”, o convierte una cotización
                  abierta en pedido real.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleTabChange("nuevo")}
              >
                + Nueva Cotización
              </Button>
            </Card>
            {quotes.length === 0 ? (
              <EmptyState
                icon={<ReceiptIcon className="h-5 w-5" />}
                title="Sin cotizaciones registradas"
                description="Arma un pedido y presiona Cotizar para guardar una propuesta."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
                {quotes.map((q) => {
                  const isBusy = busyQuoteId === q.quote_id;
                  const tone =
                    q.status === "CONVERTED"
                      ? "success"
                      : q.status === "OPEN"
                        ? "brand"
                        : "neutral";
                  return (
                    <Card key={q.quote_id} padding="md" className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-[#1E446B] tabular-nums">
                            {q.quote_code} · {q.issue_date}
                          </span>
                          <h3 className="text-sm sm:text-base font-semibold text-[#18181B]">
                            {q.customer_name}
                          </h3>
                        </div>
                        <Badge tone={tone}>
                          {q.status === "OPEN"
                            ? "Abierta"
                            : q.status === "CONVERTED"
                              ? `Pedido ${q.converted_order_code || q.related_cpe || ""}`.trim()
                              : q.status === "EXPIRED"
                                ? "Vencida"
                                : "Anulada"}
                        </Badge>
                      </div>

                      <div className="divide-y divide-[#E7E5E0] rounded-lg border border-[#E7E5E0] bg-[#FAF9F6] px-2.5 py-1 text-xs">
                        {q.lines.map((ln) => (
                          <div
                            key={ln.quote_line_id}
                            className="flex items-center justify-between gap-2 py-1.5"
                          >
                            <span className="min-w-0 truncate text-[#18181B]">
                              {ln.quantity} {ln.unit_of_measure} × {ln.raw_description}
                            </span>
                            <span className="flex-shrink-0 font-semibold tabular-nums">
                              S/ {Number(ln.line_total_pen).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#0F2942] tabular-nums">
                          Total: S/ {Number(q.total_pen).toFixed(2)}
                        </span>
                        {q.status === "OPEN" && (
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              type="button"
                              variant="success"
                              size="sm"
                              data-compact="true"
                              disabled={isBusy}
                              onClick={() => handleConvertQuote(q.quote_id, "CASH")}
                            >
                              Convertir Contado
                            </Button>
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              data-compact="true"
                              disabled={isBusy}
                              onClick={() => handleConvertQuote(q.quote_id, "CREDIT")}
                            >
                              A Crédito 7d
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              data-compact="true"
                              disabled={isBusy}
                              onClick={() =>
                                handleUpdateQuoteStatus(q.quote_id, "CANCELLED")
                              }
                            >
                              Anular
                            </Button>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {tab === "deudores" && (
          <section aria-label="Cobros y deudores" className="space-y-3.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                {
                  label: "Saldo pendiente",
                  amount: collectionSummary.total,
                  tone: "text-[#0F2942]",
                },
                {
                  label: "Cobrar hoy / mañana",
                  amount: collectionSummary.dueSoon,
                  tone: "text-[#B45309]",
                },
                {
                  label: "Promesa vencida",
                  amount: collectionSummary.overdue,
                  tone: "text-[#B91C1C]",
                },
              ].map((item) => (
                <Card key={item.label} padding="sm" className="space-y-1">
                  <p className="text-xs text-[#5C5A55]">{item.label}</p>
                  <p className={`text-lg font-semibold tabular-nums ${item.tone}`}>
                    S/ {item.amount.toFixed(2)}
                  </p>
                </Card>
              ))}
            </div>
            <Card padding="sm" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <SegmentedControl
                  ariaLabel="Agrupación de cobros"
                  value={debtorView}
                  onChange={setDebtorView}
                  options={[
                    {
                      id: "orders",
                      label: "Por Pedido",
                      count: debtorsByOrder.length,
                    },
                    {
                      id: "customers",
                      label: "Por Cliente",
                      count: debtorsByCustomer.length,
                    },
                  ]}
                />
                <div className="relative w-full sm:w-64">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[#6D6A64]">
                    <SearchIcon className="h-3.5 w-3.5" />
                  </span>
                  <input
                    type="text"
                    value={debtorSearch}
                    onChange={(e) => setDebtorSearch(e.target.value)}
                    aria-label="Buscar cliente o pedido en cobros"
                    placeholder="Buscar cliente o pedido..."
                    className={`${INPUT_CLASS} py-1.5 pl-9 pr-8 text-xs`}
                  />
                  {debtorSearch && (
                    <button
                      type="button"
                      data-compact="true"
                      aria-label="Limpiar búsqueda de cobros"
                      onClick={() => setDebtorSearch("")}
                      className="absolute inset-y-0 right-2 flex items-center text-[#6D6A64] hover:text-[#18181B] cursor-pointer"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {debtorView === "orders" && (
                <PromiseFilterBar
                  value={promiseFilter}
                  onChange={setPromiseFilter}
                  totalCount={debtorsByOrder.length}
                />
              )}
            </Card>

            {debtorView === "orders" ? (
              filteredDebtOrders.length === 0 ? (
                <EmptyState
                  icon={<WalletIcon className="h-5 w-5" />}
                  title="Sin cobros pendientes en este filtro"
                  description="Prueba seleccionando 'Todos' o cambia a la vista por cliente."
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
                  {prioritizedDebtOrders.map((item) => {
                    const lineCount = Array.isArray(item.lines) ? item.lines.length : 0;
                    return (
                      <Card key={item.orderId} padding="md" className="space-y-3">
                        <button
                          type="button"
                          onClick={() =>
                            setDebtDetailTarget({
                              mode: "order",
                              orderId: item.orderId,
                            })
                          }
                          aria-label={`Ver detalle de productos del pedido ${item.orderCode} de ${item.customerName}`}
                          className="w-full space-y-2.5 text-left rounded-xl transition hover:bg-[#F2F6FA]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 cursor-pointer"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-xs font-semibold text-[#1E446B] tabular-nums">
                                {item.orderCode} · {item.orderDate}
                              </span>
                              <h2 className="mt-0.5 text-sm sm:text-base font-semibold text-[#18181B]">
                                {item.customerName}
                              </h2>
                            </div>
                            <Badge
                              tone={
                                item.agingBucket === "RED_30_PLUS"
                                  ? "danger"
                                  : item.agingBucket === "AMBER_8_29"
                                    ? "warning"
                                    : "success"
                              }
                              className="tabular-nums"
                            >
                              Hace {item.daysOverdue} días
                            </Badge>
                          </div>

                          <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#F2F6FA]/70 p-2.5 text-xs tabular-nums">
                            <div>
                              <span className="block text-[11px] text-[#5C5A55]">
                                Total
                              </span>
                              <span className="font-semibold text-[#18181B]">
                                S/ {item.totalPen.toFixed(2)}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[11px] text-[#5C5A55]">
                                Abonado ({item.paymentCount})
                              </span>
                              <span className="font-semibold text-[#15803D]">
                                S/ {item.paidPen.toFixed(2)}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="block text-[11px] text-[#5C5A55]">
                                Saldo pendiente
                              </span>
                              <span className="text-sm font-semibold text-[#B91C1C]">
                                S/ {item.balanceDuePen.toFixed(2)}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C5A55]">
                            <span>
                              Pactado:{" "}
                              <strong className="text-[#18181B]">
                                {item.promisedPaymentDate || "No pactada"}
                              </strong>
                            </span>
                            <div className="flex items-center gap-2">
                              <PromiseStatusPill status={item.promiseStatus} />
                              <span className="inline-flex items-center gap-0.5 font-medium text-[#1E446B]">
                                {lineCount > 0 ? `${lineCount} prod.` : "Ver detalle"}
                                <ChevronRightIcon className="h-3.5 w-3.5" />
                              </span>
                            </div>
                          </div>
                        </button>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            aria-label={`Registrar abono para ${item.customerName}, pedido ${item.orderCode}`}
                            onClick={() => {
                              setSelectedCustomerForFifo(null);
                              setSelectedOrderForAbono(item);
                              setAbonoAmount(String(item.balanceDuePen));
                              setAbonoAccountId("");
                            }}
                            className="flex-1"
                          >
                            <PlusIcon className="h-3.5 w-3.5" />
                            Registrar Abono
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-expanded={timelineOrderId === item.orderId}
                            aria-label={`Ver historial de pagos del pedido ${item.orderCode}`}
                            disabled={timelineLoadingId === item.orderId}
                            onClick={() => handleOpenTimeline(item.orderId)}
                          >
                            <ClockIcon className="h-3.5 w-3.5" />
                            {timelineLoadingId === item.orderId
                              ? "Cargando..."
                              : `Historial (${item.paymentCount})`}
                          </Button>
                        </div>

                        {timelineOrderId === item.orderId && (
                          <div className="rounded-xl border border-[#D4E0EC] bg-[#F2F6FA]/60 p-3 text-xs">
                            <p className="mb-2 font-semibold text-[#0F2942]">
                              Historial de pagos de este pedido
                            </p>
                            {timelineEntries.length === 0 ? (
                              <p className="text-[#5C5A55]">Sin abonos previos.</p>
                            ) : (
                              <ul className="divide-y divide-[#D4E0EC]/70">
                                {timelineEntries.map((t) => (
                                  <li
                                    key={String(t.arPaymentId)}
                                    className="flex items-center justify-between gap-2 py-1.5"
                                  >
                                    <span className="text-[#5C5A55]">
                                      {String(t.paymentDate)} ·{" "}
                                      {formatPaymentModeEs(t.paymentMode)} (
                                      {String(t.collectedByName || "Histórico")})
                                    </span>
                                    <strong className="font-semibold text-[#15803D] tabular-nums">
                                      S/ {Number(t.amountPen).toFixed(2)}
                                    </strong>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )
            ) : filteredDebtorsByCustomer.length === 0 ? (
              <EmptyState
                icon={<WalletIcon className="h-5 w-5" />}
                title={
                  debtorSearch
                    ? "No hay clientes que coincidan con tu búsqueda"
                    : "Sin clientes con saldo pendiente"
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-start">
                {filteredDebtorsByCustomer.map((c) => (
                  <Card key={c.customerKey} padding="md" className="space-y-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        setDebtDetailTarget({
                          mode: "customer",
                          customerKey: c.customerKey,
                          customerName: c.customerName,
                          customerPartyId: c.customerPartyId,
                        })
                      }
                      aria-label={`Ver pedidos y productos que debe ${c.customerName}`}
                      className="w-full space-y-1.5 text-left rounded-xl transition hover:bg-[#F2F6FA]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                          {c.customerName}
                        </h2>
                        <Badge tone="danger" className="tabular-nums">
                          Debe S/ {c.totalBalanceDuePen.toFixed(2)}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C5A55] tabular-nums">
                        <span>
                          {c.openOrdersCount} pedido(s) · Antigüedad máx:{" "}
                          {c.maxDaysOverdue} días · Próxima visita:{" "}
                          {c.earliestPromisedPaymentDate || "-"}
                        </span>
                        <span className="inline-flex items-center gap-0.5 font-medium text-[#1E446B]">
                          Ver detalle
                          <ChevronRightIcon className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </button>
                    {c.customerPartyId && (
                      <Button
                        variant="primary"
                        size="sm"
                        aria-label={`Abonar a cuenta de ${c.customerName}`}
                        onClick={() => {
                          setSelectedOrderForAbono(null);
                          setSelectedCustomerForFifo(c);
                          setAbonoAmount(String(c.totalBalanceDuePen));
                          setAbonoAccountId("");
                        }}
                        className="w-full"
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                        Abonar a Cuenta (deudas más antiguas)
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "pedidos" && (
          <section aria-label="Mis pedidos" className="space-y-3">
            {orders.length === 0 ? (
              <EmptyState
                icon={<PackageIcon className="h-5 w-5" />}
                title="Aún no hay pedidos registrados"
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">
                {orders.map((o) => {
                  const orderId = Number(o.order_id);
                  const isExpanded = expandedOrderId === orderId;
                  const orderLines = Array.isArray(o.lines)
                    ? (o.lines as Array<Record<string, unknown>>)
                    : [];
                  const auditHistory = Array.isArray(o.audit_history)
                    ? (o.audit_history as Array<Record<string, unknown>>)
                    : [];
                  const wasModified = auditHistory.some(
                    (entry) => String(entry.action) === "EDIT"
                  );
                  return (
                    <Card key={String(o.order_id)} padding="md" className="space-y-2.5">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          setExpandedOrderId((prev) =>
                            prev === orderId ? null : orderId
                          )
                        }
                        className="w-full space-y-2 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 rounded-lg"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[#1E446B] tabular-nums">
                            {String(o.order_code)} · {String(o.order_date)}
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {Boolean(o.trip_code) && (
                              <Badge tone="brand">{String(o.trip_code)}</Badge>
                            )}
                            {wasModified && <Badge tone="warning">Modificado</Badge>}
                            <Badge tone="neutral">
                              {formatOperationalStatusEs(o.operational_status)}
                            </Badge>
                            <ChevronRightIcon
                              className={`h-4 w-4 text-[#5C5A55] transition-transform ${
                                isExpanded ? "rotate-90 text-[#0F2942]" : ""
                              }`}
                            />
                          </div>
                        </div>
                        <h2 className="text-sm sm:text-base font-semibold text-[#18181B]">
                          {String(o.customer_name)}
                        </h2>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5C5A55] tabular-nums">
                          <span>
                            Total:{" "}
                            <strong className="text-[#18181B]">
                              S/ {Number(o.total_pen).toFixed(2)}
                            </strong>
                          </span>
                          <span>
                            Pagado:{" "}
                            <strong className="text-[#15803D]">
                              S/ {Number(o.paid_pen).toFixed(2)}
                            </strong>
                          </span>
                          <span>
                            Saldo:{" "}
                            <strong
                              className={
                                Number(o.balance_due_pen) > 0.05
                                  ? "text-[#B91C1C]"
                                  : "text-[#15803D]"
                              }
                            >
                              S/ {Number(o.balance_due_pen).toFixed(2)}
                            </strong>
                          </span>
                        </div>
                        <p className="rounded-lg bg-[#F2F6FA]/70 px-2.5 py-1.5 text-[11px] text-[#1E446B]">
                          Tomó: {String(o.created_by_name || "-")} · Preparó:{" "}
                          {String(o.picked_by_name || "Pendiente")} · Entregó:{" "}
                          {String(o.delivered_by_name || "Pendiente")}
                        </p>
                      </button>

                      {isExpanded && (
                        <div className="space-y-2 border-t border-[#E7E5E0] pt-2.5 text-xs">
                          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-[#5C5A55]">
                            <span>
                              Detalle comprado ({orderLines.length}{" "}
                              {orderLines.length === 1 ? "ítem" : "ítems"})
                            </span>
                            <span>{formatPaymentModeEs(o.payment_mode)}</span>
                          </div>
                          {orderLines.length === 0 ? (
                            <p className="text-[#5C5A55]">
                              Sin líneas de producto registradas.
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {orderLines.map((ln) => (
                                <div
                                  key={String(ln.order_line_id)}
                                  className="flex items-start justify-between gap-2 rounded-lg border border-[#E7E5E0] bg-[#FAF9F6] px-2.5 py-2"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-[#18181B]">
                                      {String(ln.raw_description || ln.sku)}
                                    </p>
                                    <p className="text-[11px] text-[#5C5A55] tabular-nums">
                                      {Number(ln.quantity)}{" "}
                                      {String(ln.unit_of_measure || "NIU")} × S/{" "}
                                      {Number(ln.unit_price_pen).toFixed(2)}
                                      {Number(ln.unit_discount_pen || 0) > 0
                                        ? ` (desc. S/ ${Number(
                                            ln.unit_discount_pen
                                          ).toFixed(2)}/u)`
                                        : ""}{" "}
                                      · {formatFulfillmentModeEs(ln.fulfillment_mode)}
                                    </p>
                                  </div>
                                  <span className="flex-shrink-0 font-semibold text-[#18181B] tabular-nums">
                                    S/ {Number(ln.line_total_pen).toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          {o.notes ? (
                            <p className="rounded-lg bg-[#FAF9F6] px-2.5 py-1.5 text-[11px] text-[#5C5A55]">
                              Nota: {String(o.notes)}
                            </p>
                          ) : null}
                          {auditHistory.length > 0 && (
                            <details className="rounded-lg border border-[#D4E0EC] bg-[#F2F6FA]/60 p-2.5">
                              <summary className="cursor-pointer font-semibold text-[#0F2942]">
                                Historial de cambios ({auditHistory.length})
                              </summary>
                              <div className="mt-2 space-y-2">
                                {auditHistory.map((entry) => (
                                  <div
                                    key={String(entry.audit_id)}
                                    className="border-t border-[#D4E0EC] pt-2 text-[11px] text-[#5C5A55]"
                                  >
                                    <p className="font-medium text-[#18181B]">
                                      {String(entry.action) === "CANCEL"
                                        ? "Anulación"
                                        : "Modificación"}{" "}
                                      · {String(entry.reason)}
                                    </p>
                                    <p>
                                      {String(entry.actor_name || "Usuario")} ·{" "}
                                      {new Date(
                                        String(entry.created_at)
                                      ).toLocaleString("es-PE")}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                          {!["DELIVERED", "CANCELLED"].includes(
                            String(o.operational_status)
                          ) &&
                            Number(o.created_by_user_id) === currentUser?.userId && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => beginEditingOrder(o)}
                                className="w-full"
                              >
                                Modificar pedido
                              </Button>
                            )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {tab === "gastos" && (
          <section aria-label="Registrar gasto diario" className="mx-auto max-w-2xl">
            <Card accent="horizon" padding="lg">
              <form onSubmit={handleSubmitExpense} className="space-y-4">
                <div className="flex items-center gap-2.5 border-b border-[#E7E5E0] pb-3">
                  <div
                    aria-hidden="true"
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F2F6FA] text-[#0F2942]"
                  >
                    <ReceiptIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-[#18181B]">
                      Registrar Gasto Diario
                    </h2>
                    <p className="text-xs text-[#5C5A55]">
                      Registra combustible, peajes y otros gastos diarios de ruta. Puedes
                      elegir una fecha anterior si olvidaste registrarlo.
                    </p>
                  </div>
                </div>

                <div>
                  <FieldLabel htmlFor="expense-date" required>
                    Fecha del gasto
                  </FieldLabel>
                  <input
                    id="expense-date"
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className={`${INPUT_CLASS} mt-1.5 font-medium`}
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="expense-category">Categoría</FieldLabel>
                  <select
                    id="expense-category"
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className={`${INPUT_CLASS} mt-1.5 font-medium`}
                  >
                    {OUTFLOW_CATEGORIES_BY_BUCKET.ROUTE_OPEX.map((category) => (
                      <option key={category.value} value={category.value}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <FieldLabel htmlFor="expense-amount" required>
                    Monto en Soles (S/)
                  </FieldLabel>
                  <input
                    id="expense-amount"
                    type="number"
                    step="0.01"
                    min="0.10"
                    required
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    placeholder="0.00"
                    className={`${INPUT_CLASS} mt-1.5 font-semibold tabular-nums`}
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="expense-desc" required>
                    Detalle breve
                  </FieldLabel>
                  <input
                    id="expense-desc"
                    type="text"
                    required
                    value={expenseDesc}
                    onChange={(e) => setExpenseDesc(e.target.value)}
                    placeholder="Ej. Gasolina unidad placa X"
                    className={`${INPUT_CLASS} mt-1.5`}
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={busyExpense}
                  className="w-full"
                >
                  {busyExpense ? "Guardando..." : "Guardar Gasto Diario"}
                </Button>
              </form>
            </Card>
          </section>
        )}
      </main>

      <ModalSheet
        open={cancelDraftOpen}
        onClose={() => setCancelDraftOpen(false)}
        title="¿Por qué se canceló este pedido?"
        subtitle="Guardaremos el motivo para análisis comercial y limpiaremos el formulario."
      >
        <form onSubmit={handleConfirmCancelDraft} className="space-y-4">
          <div
            className="space-y-2"
            role="radiogroup"
            aria-label="Motivo de cancelación"
          >
            {CANCEL_DRAFT_REASONS.map((r) => {
              const selected = cancelReasonCode === r.code;
              return (
                <button
                  key={r.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setCancelReasonCode(r.code)}
                  className={`flex min-h-[42px] w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-left text-xs font-medium transition cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F2942]/45 ${
                    selected
                      ? "border-[#0F2942] bg-[#F2F6FA] text-[#0F2942] font-semibold"
                      : "border-[#E7E5E0] bg-white text-[#18181B] hover:border-[#D4E0EC] hover:bg-[#FAF9F6]"
                  }`}
                >
                  <span>{r.label}</span>
                  <span
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 rounded-full border ${
                      selected
                        ? "border-[#0F2942] bg-[#0F2942]"
                        : "border-[#D5D2CA] bg-white"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          <div>
            <FieldLabel htmlFor="cancel-draft-note">
              Detalle adicional (opcional)
            </FieldLabel>
            <input
              id="cancel-draft-note"
              type="text"
              value={cancelCustomNote}
              onChange={(e) => setCancelCustomNote(e.target.value)}
              placeholder="Ej. Competencia ofreció menor precio en tubo..."
              className={`${INPUT_CLASS} mt-1.5`}
            />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelDraftOpen(false)}
              disabled={busyCancelDraft}
            >
              Seguir editando
            </Button>
            <Button type="submit" variant="primary" disabled={busyCancelDraft}>
              {busyCancelDraft ? "Registrando..." : "Registrar cancelación y limpiar"}
            </Button>
          </div>
        </form>
      </ModalSheet>

      <DebtorDetailModal
        open={Boolean(debtDetailTarget)}
        onClose={() => setDebtDetailTarget(null)}
        mode={debtDetailTarget?.mode ?? "order"}
        customerName={
          debtDetailTarget?.mode === "customer" ? debtDetailTarget.customerName : ""
        }
        orders={
          !debtDetailTarget
            ? []
            : debtDetailTarget.mode === "order"
              ? debtorsByOrder.filter((o) => o.orderId === debtDetailTarget.orderId)
              : debtorsByOrder.filter((o) => {
                  const oKey =
                    o.customerKey ||
                    (o.customerPartyId !== null
                      ? `PARTY-${o.customerPartyId}`
                      : `RAW-${o.customerName.toUpperCase()}`);
                  return oKey === debtDetailTarget.customerKey;
                })
        }
        canUseCustomerFifo={Boolean(
          debtDetailTarget?.mode === "customer" && debtDetailTarget.customerPartyId
        )}
        onSelectOrderAbono={(order) => {
          setDebtDetailTarget(null);
          setSelectedCustomerForFifo(null);
          setSelectedOrderForAbono(order as OrderDebtItem);
          setAbonoAmount(String(order.balanceDuePen));
          setAbonoAccountId("");
        }}
        onSelectCustomerAbono={() => {
          if (debtDetailTarget?.mode !== "customer") return;
          const matchedCustomer = debtorsByCustomer.find(
            (c) => c.customerKey === debtDetailTarget.customerKey
          );
          if (!matchedCustomer) return;
          setDebtDetailTarget(null);
          setSelectedOrderForAbono(null);
          setSelectedCustomerForFifo(matchedCustomer);
          setAbonoAmount(String(matchedCustomer.totalBalanceDuePen));
          setAbonoAccountId("");
        }}
      />

      <AbonoModal
        open={Boolean(selectedOrderForAbono || selectedCustomerForFifo)}
        onClose={() => {
          setSelectedOrderForAbono(null);
          setSelectedCustomerForFifo(null);
          setAbonoAccountId("");
        }}
        title={
          selectedCustomerForFifo
            ? `Abono General · ${selectedCustomerForFifo.customerName}`
            : `Registrar Abono · ${selectedOrderForAbono?.customerName ?? ""}`
        }
        summaryContent={
          selectedCustomerForFifo ? (
            <>
              Se repartirá desde el pedido más antiguo (
              {selectedCustomerForFifo.openOrdersCount} pedidos) ·{" "}
              <strong className="text-[#B91C1C] tabular-nums">
                Deuda Total: S/ {selectedCustomerForFifo.totalBalanceDuePen.toFixed(2)}
              </strong>
            </>
          ) : selectedOrderForAbono ? (
            <>
              Pedido {selectedOrderForAbono.orderCode} · Total: S/{" "}
              {selectedOrderForAbono.totalPen.toFixed(2)} · Abonado: S/{" "}
              {selectedOrderForAbono.paidPen.toFixed(2)} ·{" "}
              <strong className="text-[#B91C1C] tabular-nums">
                Saldo: S/ {selectedOrderForAbono.balanceDuePen.toFixed(2)}
              </strong>
            </>
          ) : null
        }
        balanceDuePen={
          selectedCustomerForFifo
            ? selectedCustomerForFifo.totalBalanceDuePen
            : (selectedOrderForAbono?.balanceDuePen ?? 0)
        }
        amount={abonoAmount}
        onAmountChange={setAbonoAmount}
        paymentMode={abonoMode}
        onPaymentModeChange={setAbonoMode}
        nextDays={abonoNextDays}
        onNextDaysChange={setAbonoNextDays}
        accounts={sellerAccounts}
        accountId={abonoAccountId}
        onAccountIdChange={setAbonoAccountId}
        onSubmit={handleSubmitAbono}
        busy={busyAbono}
      />

      {tab === "nuevo" && cart.length > 0 && (
        <div
          aria-label="Resumen móvil del pedido"
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-30 border-t border-[#D4E0EC] bg-white/95 px-3.5 py-2 backdrop-blur-md md:hidden"
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-[#5C5A55]">
                {cart.length} {cart.length === 1 ? "producto" : "productos"} en pedido
              </p>
              <p className="text-base font-semibold text-[#0F2942] tabular-nums">
                Total: S/ {cartTotalPen.toFixed(2)}
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                document
                  .getElementById("cart-checkout-card")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Ver carrito ({cart.length})
            </Button>
          </div>
        </div>
      )}

      <BottomNav
        items={navItems}
        activeId={tab}
        onChange={handleTabChange}
        maxWidth="2xl"
        className="md:hidden"
      />
    </div>
  );
}
