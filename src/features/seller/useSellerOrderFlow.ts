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
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import { deleteOfflineSnapshot, submitOfflineCapable } from "@/lib/offline/outbox";
import { useSellerOrderDraftState } from "@/features/seller/order-draft-reducer";
import { useSellerDraftPersistence } from "@/features/seller/useSellerDraftPersistence";
import type { SellerData } from "@/features/seller/useSellerData";
import type {
  SellerCatalogItemDto,
  SellerCustomerDto,
  SellerFeedbackSetter,
  SellerOrderDto,
  SellerOrderMutationResultDto,
  SellerPaymentMode,
  SellerQuoteCreateResultDto,
  SellerQuoteDto,
} from "@/features/seller/types";
import {
  buildCancelledDraftPayload,
  buildCartLinesFromOrder,
  buildCartLinesFromQuote,
  buildQuoteSubmitPayload,
  buildSellerOrderPayload,
  validateSellerCartLines,
} from "@/features/seller/seller-order-helpers";
import type { CustomerDirectoryItem } from "@/lib/services/customers";
import type { LegacySellerTab } from "@/lib/navigation";
import {
  CANCEL_DRAFT_REASONS,
  ORDER_EDIT_REASONS,
  SELLER_DRAFT_ACTOR_STORAGE_KEY,
  SELLER_DRAFT_STORAGE_KEY,
  apiErrorMessage,
  buildNormalizedCatalog,
  directoryItemToSellerCustomer,
  extractKnownZones,
  filterCatalogProducts,
  filterSellerCustomers,
  isAuthError,
  isFractionalUom,
  normalizeOrderQuantity,
  normalizeSearchText,
  postJson,
} from "@/features/seller/seller-utils";

interface SellerOrderFlowParams {
  data: SellerData;
  setFeedback: SellerFeedbackSetter;
  handleTabChange: (tab: LegacySellerTab) => void;
  clearExpandedOrder: () => void;
}

/**
 * State and actions of the unified single-screen order & quote flow:
 * draft, catalog search, customer picker, direct unit price editing,
 * global discount, order/quote edit mode, submission and draft cancellation.
 */
export function useSellerOrderFlow({
  data,
  setFeedback,
  handleTabChange,
  clearExpandedOrder,
}: SellerOrderFlowParams) {
  const router = useRouter();
  const { currentUser, catalog, customers, sellerAccounts, initialLoading } = data;
  const { loadAll, loadOrdersAndCatalog } = data;
  const [yapePlinChannel, setYapePlinChannel] = useState<"YAPE" | "PLIN">("YAPE");
  const draftApi = useSellerOrderDraftState();
  const {
    state: orderDraft,
    setShowCustomPromiseDate,
    setCustomerNameRaw,
    setSelectedCustomer,
    setPaymentMode,
    setPaymentAccountId,
    setCollectOnDelivery,
    setCreditDays,
    setCustomPromiseDate,
    setInitialPaidPen,
    setGlobalDiscountPen,
    setNotes,
    setCart,
  } = draftApi;
  const {
    showCustomPromiseDate,
    customerNameRaw,
    selectedCustomer,
    paymentMode,
    paymentAccountId,
    collectOnDelivery,
    creditDays,
    customPromiseDate,
    initialPaidPen,
    globalDiscountPen,
    notes,
    cart,
  } = orderDraft;

  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [editingOrderCode, setEditingOrderCode] = useState("");
  const [editingQuoteId, setEditingQuoteId] = useState<number | null>(null);
  const [editingQuoteCode, setEditingQuoteCode] = useState("");

  useSellerDraftPersistence(draftApi, currentUser?.username, editingOrderId !== null || editingQuoteId !== null);

  const [busyCreateQuote, setBusyCreateQuote] = useState(false);
  const [busyOrder, setBusyOrder] = useState(false);
  const [searchProduct, setSearchProduct] = useState("");
  const deferredSearchProduct = useDeferredValue(searchProduct);
  const [showAllCatalog, setShowAllCatalog] = useState(false);
  const deferredCustomerQuery = useDeferredValue(customerNameRaw);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerBoxRef = useRef<HTMLDivElement | null>(null);
  const [quoteEditReason, setQuoteEditReason] = useState("");
  const [editReasonCode, setEditReasonCode] = useState("CUSTOMER_INCREASED");
  const [editReasonNote, setEditReasonNote] = useState("");
  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelReasonCode, setCancelReasonCode] = useState<string>("CHANGED_MIND");
  const [cancelCustomNote, setCancelCustomNote] = useState("");
  const [busyCancelDraft, setBusyCancelDraft] = useState(false);

  const addToCart = useCallback(
    (prod: SellerCatalogItemDto) => {
      const fractional = isFractionalUom(prod.unit_of_measure);
      const listPrice = Number(prod.list_sale_price_pen ?? 0);
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
            unitPricePen: listPrice,
            unitPriceInput: listPrice > 0 ? listPrice.toFixed(2) : "",
          },
        ];
      });
    },
    [setCart]
  );

  const isPartnerControlUser =
    currentUser?.role === "PARTNER_ADMIN" || currentUser?.role === "PARTNER_MANAGER";

  const cartQtyByProductId = useMemo(
    () => new Map(cart.map((c) => [c.product.product_id, c.quantity])),
    [cart]
  );

  const cartSubtotalPen = useMemo(
    () =>
      cart.reduce((sum, item) => {
        const qty = Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0;
        const unit = Number.isFinite(item.unitPricePen) ? Math.max(0, item.unitPricePen) : 0;
        return Number((sum + Number((qty * unit).toFixed(2))).toFixed(2));
      }, 0),
    [cart]
  );

  const parsedGlobalDiscountPen = useMemo(() => {
    const raw = globalDiscountPen.trim().replace(",", ".");
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Number(n.toFixed(2)) : 0;
  }, [globalDiscountPen]);

  const cartTotalPen = useMemo(
    () => Math.max(0, Number((cartSubtotalPen - parsedGlobalDiscountPen).toFixed(2))),
    [cartSubtotalPen, parsedGlobalDiscountPen]
  );

  const requiresPartnerApproval = false;

  const filteredCustomerSuggestions = useMemo(
    () => filterSellerCustomers(customers, deferredCustomerQuery, 8),
    [customers, deferredCustomerQuery]
  );

  const knownZones = useMemo(() => extractKnownZones(customers), [customers]);

  const handleCustomerSaved = useCallback(
    (saved: CustomerDirectoryItem, mode: "create" | "edit") => {
      const dto = directoryItemToSellerCustomer(saved);
      data.upsertCustomer(dto);
      setSelectedCustomer(dto);
      setCustomerNameRaw(dto.name);
      setCustomerDropdownOpen(false);
      if (dto.address?.trim() && !notes.trim()) {
        setNotes(dto.address.trim());
      }
      setFeedback({
        type: "ok",
        msg:
          mode === "create"
            ? `Cliente "${dto.name}" creado y seleccionado.`
            : `Datos de "${dto.name}" actualizados.`,
      });
      void loadOrdersAndCatalog({ silent: true });
    },
    [
      data,
      loadOrdersAndCatalog,
      notes,
      setCustomerNameRaw,
      setFeedback,
      setNotes,
      setSelectedCustomer,
    ]
  );

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

  function handleSelectCustomer(c: SellerCustomerDto) {
    const prevAutoAddress = (selectedCustomer?.address ?? "").trim();
    const nextAddress = (c.address ?? "").trim();
    setSelectedCustomer(c);
    setCustomerNameRaw(c.name);
    setCustomerDropdownOpen(false);
    if (!notes.trim() || (prevAutoAddress && notes.trim() === prevAutoAddress)) {
      setNotes(nextAddress);
    }
  }

  function findActiveAccId(code: string): number | null {
    const m = sellerAccounts.find((a) => a.code === code && a.is_active !== false);
    return m ? Number(m.account_id) : null;
  }

  function handleSelectPaymentMode(mode: SellerPaymentMode) {
    setPaymentMode(mode);
    if (mode === "YAPE_PLIN" || mode === "TRANSFER") {
      setCollectOnDelivery(false);
      if (mode === "TRANSFER") setPaymentAccountId(null);
    } else if (mode === "CASH") {
      setCollectOnDelivery(true);
      setPaymentAccountId(findActiveAccId("CAJA_RUTA"));
    } else if (mode === "CREDIT") setPaymentAccountId(null);
  }

  function handleSelectYapePlin(channel: "YAPE" | "PLIN") {
    setYapePlinChannel(channel);
    setPaymentMode("YAPE_PLIN");
    setCollectOnDelivery(false);
    const id = findActiveAccId(channel === "YAPE" ? "BCP_BHT" : "INTERBANK_BHT");
    setPaymentAccountId(id);
  }

  function resetOrderDraft() {
    setCart([]);
    setCustomerNameRaw("");
    setSelectedCustomer(null);
    setCustomerDropdownOpen(false);
    setPaymentMode("CASH");
    setPaymentAccountId(null);
    setCollectOnDelivery(true);
    setCreditDays(7);
    setCustomPromiseDate("");
    setShowCustomPromiseDate(false);
    setInitialPaidPen("");
    setGlobalDiscountPen("");
    setSearchProduct("");
    setShowAllCatalog(false);
    setNotes("");
    setEditingOrderId(null);
    setEditingOrderCode("");
    setEditingQuoteId(null);
    setEditingQuoteCode("");
    setQuoteEditReason("");
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

  function beginEditingOrder(order: SellerOrderDto) {
    const { lines: nextCart, error } = buildCartLinesFromOrder(order, catalog);
    if (error) {
      setFeedback({ type: "err", msg: error });
      return;
    }
    const customer = customers.find(
      (item) => item.party_id === Number(order.customer_party_id)
    );
    const mode = String(order.payment_mode) as SellerPaymentMode;
    setEditingQuoteId(null);
    setEditingQuoteCode("");
    setQuoteEditReason("");
    setEditingOrderId(Number(order.order_id));
    setEditingOrderCode(String(order.order_code));
    setEditReasonCode("CUSTOMER_INCREASED");
    setEditReasonNote("");
    setCart(nextCart);
    setSelectedCustomer(customer ?? null);
    setCustomerNameRaw(String(order.customer_name ?? ""));
    setPaymentMode(mode);
    setCollectOnDelivery(mode === "CASH" && Number(order.paid_pen ?? 0) <= 0.05);
    setGlobalDiscountPen(
      Number(order.global_discount_pen ?? 0) > 0
        ? Number(order.global_discount_pen).toFixed(2)
        : ""
    );
    setNotes(String(order.notes ?? ""));
    clearExpandedOrder();
    handleTabChange("nuevo");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function beginEditingQuote(quote: SellerQuoteDto) {
    if (quote.status !== "OPEN") {
      setFeedback({
        type: "err",
        msg: "Solo se pueden modificar cotizaciones abiertas.",
      });
      return;
    }
    const { lines: nextCart, error } = buildCartLinesFromQuote(quote, catalog);
    if (error) {
      setFeedback({ type: "err", msg: error });
      return;
    }
    const customer = customers.find(
      (item) => item.party_id === Number(quote.customer_party_id)
    );
    setEditingOrderId(null);
    setEditingOrderCode("");
    setEditingQuoteId(Number(quote.quote_id));
    setEditingQuoteCode(String(quote.quote_code));
    setQuoteEditReason("");
    setCart(nextCart);
    setSelectedCustomer(customer ?? null);
    setCustomerNameRaw(String(quote.customer_name ?? ""));
    setGlobalDiscountPen(
      Number(quote.global_discount_pen ?? 0) > 0
        ? Number(quote.global_discount_pen).toFixed(2)
        : ""
    );
    setNotes(String(quote.notes ?? ""));
    clearExpandedOrder();
    handleTabChange("nuevo");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validateCartLines(): boolean {
    const err = validateSellerCartLines(cart, cartSubtotalPen, parsedGlobalDiscountPen);
    if (err) {
      setFeedback({ type: "err", msg: err });
      return false;
    }
    return true;
  }

  async function handleConfirmCancelDraft(e: React.FormEvent) {
    e.preventDefault();
    if (busyCancelDraft) return;
    const chosen = CANCEL_DRAFT_REASONS.find((r) => r.code === cancelReasonCode);
    const reasonLabel = chosen?.label || "Otro motivo";
    setBusyCancelDraft(true);
    try {
      const payload = buildCancelledDraftPayload({
        selectedCustomer,
        customerNameRaw,
        paymentMode,
        cartTotalPen,
        cart,
        reasonCode: cancelReasonCode,
        reasonLabel,
        cancelCustomNote,
        notes,
      });
      await postJson<object>("/api/orders", payload);
      resetOrderDraft();
      setCancelCustomNote("");
      setCancelReasonCode("CHANGED_MIND");
      setCancelDraftOpen(false);
      setFeedback({
        type: "warn",
        msg: `Cancelación registrada (${reasonLabel}). Formulario limpiado.`,
      });
    } catch (error) {
      setFeedback({
        type: "err",
        msg: apiErrorMessage(
          error,
          "Error de red registrando el motivo de cancelación."
        ),
      });
    } finally {
      setBusyCancelDraft(false);
    }
  }

  async function handleCreateQuoteFromCart() {
    if (busyCreateQuote || busyOrder) return;
    if (!validateCartLines()) return;
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
      const isUpdating = editingQuoteId !== null;
      const payload = buildQuoteSubmitPayload({
        editingQuoteId,
        selectedCustomer,
        customerNameRaw,
        parsedGlobalDiscountPen,
        notes,
        quoteEditReason,
        cart,
      });
      const saved = await postJson<SellerQuoteCreateResultDto>("/api/quotes", payload);
      resetOrderDraft();
      setFeedback({
        type: "ok",
        msg: isUpdating
          ? `Cotización ${saved.quoteCode} actualizada por S/ ${Number(
              saved.totalPen ?? 0
            ).toFixed(2)}. Cambio registrado en auditoría.`
          : `Cotización ${saved.quoteCode} guardada por S/ ${Number(
              saved.totalPen ?? 0
            ).toFixed(2)}.`,
      });
      handleTabChange("cotizaciones");
      notifyLocalSync(["orders", "partners"]);
      await loadOrdersAndCatalog({ silent: true });
    } catch (error) {
      if (isAuthError(error)) {
        router.push("/login");
        return;
      }
      setFeedback({
        type: "err",
        msg: apiErrorMessage(error, "Error de conexión al guardar la cotización."),
      });
    } finally {
      setBusyCreateQuote(false);
    }
  }

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault();
    if (editingQuoteId !== null) {
      await handleCreateQuoteFromCart();
      return;
    }
    if (busyOrder) return;
    if (!validateCartLines()) return;

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
      const payload = buildSellerOrderPayload({
        editingOrderId,
        editReasonCode,
        editReasonNote,
        editReasonLabel: selectedEditReason?.label,
        selectedCustomer,
        customerNameRaw,
        paymentMode,
        paymentAccountId: paymentAccountId ?? null,
        requiresPartnerApproval,
        collectOnDelivery,
        creditDays,
        customPromiseDate,
        parsedInitialPaid,
        parsedGlobalDiscountPen,
        notes,
        cart,
      });
      const result =
        editingOrderId === null
          ? await submitOfflineCapable<SellerOrderMutationResultDto>({
              kind: "ORDER_CREATE",
              actorUsername: currentUser?.username || "",
              url: "/api/orders",
              body: payload,
            })
          : {
              queued: false,
              data: await postJson<SellerOrderMutationResultDto>(
                "/api/orders",
                payload
              ),
            };
      const wasEditing = editingOrderId !== null;
      resetOrderDraft();
      if (result.queued) {
        setFeedback({
          type: "warn",
          msg: "Pedido guardado en este dispositivo. Estado: pendiente de sincronización. Siguiente acción: mantener la sesión hasta recuperar Internet.",
        });
        return;
      }
      const saved = result.data!;
      setFeedback({
        type: saved.requiresApproval ? "warn" : "ok",
        msg: wasEditing
          ? saved.requiresApproval
            ? `Pedido ${saved.orderCode} modificado y enviado a aprobación por precio bajo costo.`
            : `Pedido ${saved.orderCode} modificado; el cambio quedó registrado. Siguiente estado: alistamiento.`
          : saved.requiresApproval
            ? `Pedido ${saved.orderCode} registrado. Estado: pendiente de aprobación de Socio o Gerencia.`
            : `Pedido ${saved.orderCode} registrado y enviado a Almacén.`,
        undoAction: wasEditing ? undefined : saved.undoAction,
      });
      notifyLocalSync(["orders", "inventory", "collections", "treasury", "partners"]);
      await loadAll({ silent: true });
    } catch (error) {
      if (isAuthError(error)) {
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

  const normalizedCatalog = useMemo(() => buildNormalizedCatalog(catalog), [catalog]);

  const filteredCatalog = useMemo(
    () => filterCatalogProducts(catalog, normalizedCatalog, deferredSearchProduct),
    [catalog, deferredSearchProduct, normalizedCatalog]
  );

  const catalogPreviewLimit = normalizeSearchText(deferredSearchProduct) ? 24 : 12;
  const visibleCatalog = useMemo(() => {
    return showAllCatalog || filteredCatalog.length <= catalogPreviewLimit
      ? filteredCatalog
      : filteredCatalog.slice(0, catalogPreviewLimit);
  }, [catalogPreviewLimit, filteredCatalog, showAllCatalog]);

  return {
    catalog,
    initialLoading,
    isPartnerControlUser,
    requiresPartnerApproval,
    showCustomPromiseDate,
    customerNameRaw,
    selectedCustomer,
    paymentMode,
    paymentAccountId,
    setPaymentAccountId,
    yapePlinChannel,
    sellerAccounts,
    handleSelectYapePlin,
    collectOnDelivery,
    creditDays,
    customPromiseDate,
    initialPaidPen,
    globalDiscountPen,
    notes,
    cart,
    setShowCustomPromiseDate,
    setCustomerNameRaw,
    setSelectedCustomer,
    setCollectOnDelivery,
    setCreditDays,
    setCustomPromiseDate,
    setInitialPaidPen,
    setGlobalDiscountPen,
    setNotes,
    setCart,
    busyOrder,
    busyCreateQuote,
    busyCancelDraft,
    searchProduct,
    setSearchProduct,
    showAllCatalog,
    setShowAllCatalog,
    customerDropdownOpen,
    setCustomerDropdownOpen,
    customerBoxRef,
    editingOrderId,
    editingOrderCode,
    editingQuoteId,
    editingQuoteCode,
    quoteEditReason,
    setQuoteEditReason,
    editReasonCode,
    setEditReasonCode,
    editReasonNote,
    setEditReasonNote,
    cancelDraftOpen,
    setCancelDraftOpen,
    cancelReasonCode,
    setCancelReasonCode,
    cancelCustomNote,
    setCancelCustomNote,
    cartQtyByProductId,
    cartSubtotalPen,
    parsedGlobalDiscountPen,
    cartTotalPen,
    filteredCustomerSuggestions,
    knownZones,
    actorRole: currentUser?.role || "EXTERNAL_SELLER",
    filteredCatalog,
    catalogPreviewLimit,
    visibleCatalog,
    hasOrderDraft: Boolean(cart.length || customerNameRaw.trim() || notes.trim()),
    addToCart,
    handleSelectCustomer,
    handleCustomerSaved,
    handleSelectPaymentMode,
    resetOrderDraft,
    beginEditingOrder,
    beginEditingQuote,
    handleConfirmCancelDraft,
    handleSubmitOrder,
    handleCreateQuoteFromCart,
  };
}

export type SellerOrderFlow = ReturnType<typeof useSellerOrderFlow>;
