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
  SellerCancelledDraftPayload,
  SellerCartLine,
  SellerCatalogItemDto,
  SellerCustomerDto,
  SellerFeedbackSetter,
  SellerOrderDto,
  SellerOrderMutationResultDto,
  SellerOrderPayload,
  SellerOrderStep,
  SellerPaymentMode,
  SellerQuoteCreatePayload,
  SellerQuoteCreateResultDto,
} from "@/features/seller/types";
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
 * State and actions of the progressive order flow: draft, catalog search,
 * customer picker, edit mode, order/quote submission and draft cancellation.
 */
export function useSellerOrderFlow({
  data,
  setFeedback,
  handleTabChange,
  clearExpandedOrder,
}: SellerOrderFlowParams) {
  const router = useRouter();
  const { currentUser, catalog, customers, initialLoading } = data;
  const { loadAll, loadOrdersAndCatalog } = data;
  const draftApi = useSellerOrderDraftState();
  const {
    state: orderDraft,
    setOrderStep,
    setShowCustomPromiseDate,
    setCustomerNameRaw,
    setSelectedCustomer,
    setPaymentMode,
    setCollectOnDelivery,
    setCreditDays,
    setCustomPromiseDate,
    setInitialPaidPen,
    setNotes,
    setCart,
  } = draftApi;
  const {
    orderStep,
    showCustomPromiseDate,
    customerNameRaw,
    selectedCustomer,
    paymentMode,
    collectOnDelivery,
    creditDays,
    customPromiseDate,
    initialPaidPen,
    notes,
    cart,
  } = orderDraft;

  useSellerDraftPersistence(draftApi, currentUser?.username);

  const [busyCreateQuote, setBusyCreateQuote] = useState(false);
  const [busyOrder, setBusyOrder] = useState(false);
  const [searchProduct, setSearchProduct] = useState("");
  const deferredSearchProduct = useDeferredValue(searchProduct);
  const [showAllCatalog, setShowAllCatalog] = useState(false);
  const deferredCustomerQuery = useDeferredValue(customerNameRaw);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerBoxRef = useRef<HTMLDivElement | null>(null);
  const [expandedDiscountIds, setExpandedDiscountIds] = useState<
    Record<number, boolean>
  >({});
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [editingOrderCode, setEditingOrderCode] = useState("");
  const [editReasonCode, setEditReasonCode] = useState("CUSTOMER_INCREASED");
  const [editReasonNote, setEditReasonNote] = useState("");
  const [cancelDraftOpen, setCancelDraftOpen] = useState(false);
  const [cancelReasonCode, setCancelReasonCode] = useState<string>("CHANGED_MIND");
  const [cancelCustomNote, setCancelCustomNote] = useState("");
  const [busyCancelDraft, setBusyCancelDraft] = useState(false);

  const openOrderStep = useCallback(
    (step: SellerOrderStep) => {
      setOrderStep(step);
      window.requestAnimationFrame(() => {
        document.getElementById(`seller-step-${step}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    },
    [setOrderStep]
  );

  const addToCart = useCallback(
    (prod: SellerCatalogItemDto) => {
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
    },
    [setCart]
  );

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

  function handleSelectPaymentMode(mode: SellerPaymentMode) {
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
    setShowCustomPromiseDate(false);
    setOrderStep("client");
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

  function beginEditingOrder(order: SellerOrderDto) {
    const nextCart: SellerCartLine[] = [];
    for (const line of order.lines) {
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
    const mode = String(order.payment_mode) as SellerPaymentMode;
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
    clearExpandedOrder();
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
      const payload: SellerCancelledDraftPayload = {
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
      };
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
      const payload: SellerOrderPayload = {
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
            ? `Pedido ${saved.orderCode} registrado. Estado: pendiente de aprobación de Socio o Gerencia. Siguiente acción: esperar la decisión autorizada.`
            : `Pedido ${saved.orderCode} registrado. Estado: enviado a Almacén. Siguiente acción: consultar su avance en Ventas.`,
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
      const payload: SellerQuoteCreatePayload = {
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
      };
      const created = await postJson<SellerQuoteCreateResultDto>(
        "/api/quotes",
        payload
      );
      resetOrderDraft();
      setFeedback({
        type: "ok",
        msg: `Cotización ${created.quoteCode} guardada por S/ ${Number(
          created.totalPen ?? 0
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

  return {
    catalog,
    initialLoading,
    isPartnerControlUser,
    requiresPartnerApproval,
    // draft state and setters
    orderStep,
    showCustomPromiseDate,
    customerNameRaw,
    selectedCustomer,
    paymentMode,
    collectOnDelivery,
    creditDays,
    customPromiseDate,
    initialPaidPen,
    notes,
    cart,
    setShowCustomPromiseDate,
    setCustomerNameRaw,
    setSelectedCustomer,
    setCollectOnDelivery,
    setCreditDays,
    setCustomPromiseDate,
    setInitialPaidPen,
    setNotes,
    setCart,
    // UI state
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
    expandedDiscountIds,
    setExpandedDiscountIds,
    editingOrderId,
    editingOrderCode,
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
    // derived
    cartQtyByProductId,
    cartTotalPen,
    filteredCustomerSuggestions,
    knownZones,
    actorRole: currentUser?.role || "EXTERNAL_SELLER",
    filteredCatalog,
    catalogPreviewLimit,
    visibleCatalog,
    hasOrderDraft: Boolean(cart.length || customerNameRaw.trim() || notes.trim()),
    // actions
    openOrderStep,
    addToCart,
    handleSelectCustomer,
    handleCustomerSaved,
    handleSelectPaymentMode,
    resetOrderDraft,
    beginEditingOrder,
    handleConfirmCancelDraft,
    handleSubmitOrder,
    handleCreateQuoteFromCart,
  };
}

export type SellerOrderFlow = ReturnType<typeof useSellerOrderFlow>;
