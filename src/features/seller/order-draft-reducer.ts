import { useMemo, useReducer } from "react";
import type { SellerOrderDraft, StateSetter } from "./types";

export const initialSellerOrderDraft: SellerOrderDraft = {
  customerNameRaw: "",
  selectedCustomer: null,
  paymentMode: "CASH",
  collectOnDelivery: true,
  creditDays: 7,
  customPromiseDate: "",
  initialPaidPen: "",
  notes: "",
  cart: [],
  orderStep: "client",
  showCustomPromiseDate: false,
};

export type SellerOrderDraftAction =
  | { type: "update"; update: (state: SellerOrderDraft) => Partial<SellerOrderDraft> }
  | { type: "hydrate"; draft: Partial<SellerOrderDraft> }
  | { type: "reset" };

export function sellerOrderDraftReducer(
  state: SellerOrderDraft,
  action: SellerOrderDraftAction
): SellerOrderDraft {
  switch (action.type) {
    case "update":
      return { ...state, ...action.update(state) };
    case "hydrate":
      return { ...state, ...action.draft };
    case "reset":
      return initialSellerOrderDraft;
  }
}

type SellerOrderDraftSetters = {
  [K in keyof SellerOrderDraft as `set${Capitalize<K>}`]: StateSetter<
    SellerOrderDraft[K]
  >;
};

function setterName<K extends keyof SellerOrderDraft>(field: K) {
  return `set${field.charAt(0).toUpperCase()}${field.slice(1)}` as `set${Capitalize<K>}`;
}

export function useSellerOrderDraftState() {
  const [state, dispatch] = useReducer(
    sellerOrderDraftReducer,
    initialSellerOrderDraft
  );
  const setters = useMemo(() => {
    const result = {} as SellerOrderDraftSetters;
    for (const field of Object.keys(initialSellerOrderDraft) as Array<
      keyof SellerOrderDraft
    >) {
      result[setterName(field)] = ((value: unknown) => {
        dispatch({
          type: "update",
          update: (current) => ({
            [field]:
              typeof value === "function"
                ? (value as (previous: unknown) => unknown)(current[field])
                : value,
          }),
        });
      }) as never;
    }
    return result;
  }, []);
  return { state, dispatch, ...setters };
}
