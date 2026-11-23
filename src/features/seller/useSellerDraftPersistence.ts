"use client";

import { useEffect, useRef } from "react";
import { fetchJson, hasTopLevelKeys } from "@/lib/api-client";
import type { SessionResponseDto } from "@/lib/contracts";
import {
  deleteOfflineSnapshot,
  readOfflineSnapshot,
  saveOfflineSnapshot,
} from "@/lib/offline/outbox";
import type { useSellerOrderDraftState } from "@/features/seller/order-draft-reducer";
import type { SellerOrderDraft } from "@/features/seller/types";
import {
  SELLER_DRAFT_ACTOR_STORAGE_KEY,
  SELLER_DRAFT_STORAGE_KEY,
  SELLER_LAST_ACTOR_STORAGE_KEY,
} from "@/features/seller/seller-utils";

type DraftApi = ReturnType<typeof useSellerOrderDraftState>;

/**
 * Restores the order draft for the signed-in actor (IndexedDB first, then the
 * tab's sessionStorage) and mirrors every later change back to both stores.
 */
export function useSellerDraftPersistence(
  draftApi: DraftApi,
  actorUsername: string | undefined,
  isEditing = false
) {
  const { state, dispatch } = draftApi;
  const {
    orderStep,
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
  } = state;
  const draftHydratedRef = useRef(false);
  const dirtyBeforeHydrationRef = useRef(false);

  useEffect(() => {
    if (
      !draftHydratedRef.current &&
      (isEditing ||
        cart.length > 0 ||
        customerNameRaw.trim() !== "" ||
        notes.trim() !== "")
    ) {
      dirtyBeforeHydrationRef.current = true;
    }
  }, [isEditing, cart.length, customerNameRaw, notes]);

  useEffect(() => {
    let active = true;
    const hydrateDraft = async () => {
      let actor: string | null = null;
      let savedDraft: SellerOrderDraft | null = null;
      try {
        if (navigator.onLine) {
          const data = await fetchJson<SessionResponseDto>(
            "/api/erp/session",
            { cache: "no-store" },
            hasTopLevelKeys<SessionResponseDto>("session")
          );
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
      if (
        active &&
        !dirtyBeforeHydrationRef.current &&
        savedDraft &&
        typeof savedDraft === "object"
      ) {
        const nextDraft: Partial<SellerOrderDraft> = {};
        if (typeof savedDraft.customerNameRaw === "string")
          nextDraft.customerNameRaw = savedDraft.customerNameRaw;
        if (savedDraft.selectedCustomer)
          nextDraft.selectedCustomer = savedDraft.selectedCustomer;
        if (
          savedDraft.paymentMode === "CASH" ||
          savedDraft.paymentMode === "CREDIT" ||
          savedDraft.paymentMode === "YAPE_PLIN" ||
          savedDraft.paymentMode === "TRANSFER"
        ) {
          nextDraft.paymentMode = savedDraft.paymentMode;
        }
        if (
          savedDraft.paymentAccountId === null ||
          (typeof savedDraft.paymentAccountId === "number" &&
            Number.isFinite(savedDraft.paymentAccountId))
        ) {
          nextDraft.paymentAccountId = savedDraft.paymentAccountId;
        }
        if (typeof savedDraft.collectOnDelivery === "boolean")
          nextDraft.collectOnDelivery = savedDraft.collectOnDelivery;
        if (typeof savedDraft.creditDays === "number")
          nextDraft.creditDays = savedDraft.creditDays;
        if (typeof savedDraft.customPromiseDate === "string")
          nextDraft.customPromiseDate = savedDraft.customPromiseDate;
        if (typeof savedDraft.initialPaidPen === "string")
          nextDraft.initialPaidPen = savedDraft.initialPaidPen;
        if (typeof savedDraft.globalDiscountPen === "string")
          nextDraft.globalDiscountPen = savedDraft.globalDiscountPen;
        if (typeof savedDraft.notes === "string") nextDraft.notes = savedDraft.notes;
        if (Array.isArray(savedDraft.cart)) {
          nextDraft.cart = savedDraft.cart.map((rawLine) => {
            const legacy = rawLine as Partial<SellerOrderDraft["cart"][number]> & {
              unitDiscountPen?: number;
            };
            const listPrice = Number(rawLine.product?.list_sale_price_pen ?? 0);
            const unitPricePen =
              typeof legacy.unitPricePen === "number" &&
              Number.isFinite(legacy.unitPricePen)
                ? legacy.unitPricePen
                : Math.max(
                    0,
                    Number((listPrice - Number(legacy.unitDiscountPen ?? 0)).toFixed(2))
                  );
            return {
              ...rawLine,
              unitPricePen,
              unitPriceInput:
                typeof legacy.unitPriceInput === "string"
                  ? legacy.unitPriceInput
                  : unitPricePen.toFixed(2),
            };
          });
        }
        if (
          savedDraft.orderStep === "client" ||
          savedDraft.orderStep === "products" ||
          savedDraft.orderStep === "payment" ||
          savedDraft.orderStep === "confirmation"
        ) {
          nextDraft.orderStep = savedDraft.orderStep;
        }
        if (typeof savedDraft.showCustomPromiseDate === "boolean") {
          nextDraft.showCustomPromiseDate = savedDraft.showCustomPromiseDate;
        }
        dispatch({ type: "hydrate", draft: nextDraft });
      }
      if (active) draftHydratedRef.current = true;
    };
    void hydrateDraft();
    return () => {
      active = false;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!draftHydratedRef.current || isEditing) return;
    const draft: SellerOrderDraft = {
      customerNameRaw,
      selectedCustomer,
      paymentMode,
      paymentAccountId: paymentAccountId ?? null,
      collectOnDelivery,
      creditDays,
      customPromiseDate,
      initialPaidPen,
      globalDiscountPen,
      notes,
      cart,
      orderStep,
      showCustomPromiseDate,
    };
    const hasDraft = Boolean(cart.length || customerNameRaw.trim() || notes.trim());
    let actor = actorUsername || null;
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
    actorUsername,
    isEditing,
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
    orderStep,
    showCustomPromiseDate,
  ]);
}
