"use client";

import { CloseIcon, SearchIcon } from "@/components/ui/Icons";
import { Card, FieldLabel, INPUT_CLASS } from "@/components/ui/Primitives";
import { normalizeSearchText } from "@/features/seller/seller-utils";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export default function SellerOrderClientStep({ flow }: { flow: SellerOrderFlow }) {
  const {
    orderStep,
    customerNameRaw,
    setCustomerNameRaw,
    selectedCustomer,
    setSelectedCustomer,
    customerDropdownOpen,
    setCustomerDropdownOpen,
    customerBoxRef,
    filteredCustomerSuggestions,
    handleSelectCustomer,
  } = flow;
  return (
    <Card
      id="seller-step-client"
      className={`scroll-mt-24 space-y-3 ${orderStep !== "client" && customerNameRaw.trim() ? "hidden" : ""}`}
    >
      <div ref={customerBoxRef} className="relative">
        <FieldLabel htmlFor="seller-customer-name" required>
          1. Cliente o ferretería
        </FieldLabel>
        <div className="relative mt-1.5">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bht-ink-muted" />
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
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-bht-ink-muted hover:bg-bht-paper-alt hover:text-bht-ink-strong cursor-pointer"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {selectedCustomer && (
          <p className="mt-1.5 text-xs font-medium text-bht-success">
            Cliente vinculado ({selectedCustomer.doc_number || "registrado"}
            {selectedCustomer.address ? ` · ${selectedCustomer.address}` : ""})
          </p>
        )}
        {customerDropdownOpen && filteredCustomerSuggestions.length > 0 && (
          <ul
            id="seller-customer-listbox"
            role="listbox"
            aria-label="Clientes sugeridos"
            className="absolute z-30 mt-1.5 max-h-56 w-full overflow-y-auto rounded-xl border border-bht-line-blue bg-white p-1 shadow-bht-elev-17"
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
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-left text-sm transition hover:bg-bht-mist cursor-pointer"
                >
                  <span className="font-semibold text-bht-ink-strong">{c.name}</span>
                  {c.doc_number && (
                    <span className="flex-shrink-0 text-xs text-bht-ink-soft tabular-nums">
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
  );
}
