"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  CloseIcon,
  EditIcon,
  NavigationIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  FieldLabel,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { buildGoogleMapsUrl, formatPartySecondaryName } from "@/lib/geo";
import { normalizeSearchText } from "@/features/seller/seller-utils";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

const CustomerFormModal = dynamic(
  () => import("@/components/directory/CustomerFormModal"),
  { ssr: false }
);

export default function SellerOrderClientStep({ flow }: { flow: SellerOrderFlow }) {
  const {
    customerNameRaw,
    setCustomerNameRaw,
    selectedCustomer,
    setSelectedCustomer,
    customerDropdownOpen,
    setCustomerDropdownOpen,
    customerBoxRef,
    filteredCustomerSuggestions,
    knownZones,
    actorRole,
    editingOrderId,
    handleSelectCustomer,
    handleCustomerSaved,
  } = flow;
  const isEditingOrder = editingOrderId !== null;

  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [modalInitialAlias, setModalInitialAlias] = useState("");

  const trimmedQuery = customerNameRaw.trim();
  const hasExactMatch = Boolean(
    trimmedQuery &&
    filteredCustomerSuggestions.some(
      (c) =>
        normalizeSearchText(c.name) === normalizeSearchText(trimmedQuery) ||
        (c.legal_name &&
          normalizeSearchText(c.legal_name) === normalizeSearchText(trimmedQuery))
    )
  );
  const showQuickCreateOption = Boolean(trimmedQuery && !hasExactMatch);
  const showDropdown =
    customerDropdownOpen &&
    (filteredCustomerSuggestions.length > 0 || showQuickCreateOption);

  return (
    <>
      <Card id="seller-step-client" className="scroll-mt-24 space-y-3">
        <div ref={customerBoxRef} className="relative">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel htmlFor="seller-customer-name" required>
              Cliente o ferretería
            </FieldLabel>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              compact
              onClick={() => {
                setModalInitialAlias(!selectedCustomer ? trimmedQuery : "");
                setModalMode("create");
                setCustomerDropdownOpen(false);
              }}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Nuevo cliente
            </Button>
          </div>

          <div className="relative mt-1.5">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-bht-ink-muted" />
            <input
              id="seller-customer-name"
              type="text"
              required
              disabled={isEditingOrder}
              autoComplete="off"
              role="combobox"
              aria-expanded={showDropdown && !isEditingOrder}
              aria-controls="seller-customer-listbox"
              value={customerNameRaw}
              onFocus={() => {
                if (!isEditingOrder) setCustomerDropdownOpen(true);
              }}
              onChange={(e) => {
                if (isEditingOrder) return;
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
              placeholder="Buscar por alias, nombre, RUC/DNI o zona..."
              className={`${INPUT_CLASS} pl-9 pr-9 font-medium disabled:bg-bht-paper disabled:text-bht-ink-soft`}
            />
            {customerNameRaw && !isEditingOrder && (
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bht-line bg-bht-surface-cool/75 px-3 py-2 text-xs">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5 font-medium text-bht-success">
                  <span>
                    Cliente vinculado ({selectedCustomer.doc_number || "registrado"})
                  </span>
                  {selectedCustomer.city_zone && (
                    <Badge tone="horizon">{selectedCustomer.city_zone}</Badge>
                  )}
                </div>
                {(selectedCustomer.phone ||
                  selectedCustomer.address ||
                  formatPartySecondaryName(
                    selectedCustomer.trade_name,
                    selectedCustomer.legal_name
                  )) && (
                  <p className="truncate text-xs text-bht-ink-soft">
                    {[
                      formatPartySecondaryName(
                        selectedCustomer.trade_name,
                        selectedCustomer.legal_name
                      ),
                      selectedCustomer.phone,
                      selectedCustomer.address,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>

              <div className="flex flex-shrink-0 items-center gap-2">
                {selectedCustomer.geo_lat != null &&
                  selectedCustomer.geo_lng != null && (
                    <a
                      href={buildGoogleMapsUrl(
                        selectedCustomer.geo_lat,
                        selectedCustomer.geo_lng
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-bht-slate-line bg-white px-2.5 py-1 text-xs font-semibold text-bht-cobalt hover:bg-bht-cobalt-bg"
                    >
                      <NavigationIcon className="h-3 w-3" />
                      Maps
                    </a>
                  )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  compact
                  onClick={() => setModalMode("edit")}
                >
                  <EditIcon className="h-3.5 w-3.5" />
                  Editar datos
                </Button>
              </div>
            </div>
          )}

          {showDropdown && (
            <ul
              id="seller-customer-listbox"
              role="listbox"
              aria-label="Clientes sugeridos"
              className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl border border-bht-line-blue bg-white p-1 shadow-bht-elev-17"
            >
              {filteredCustomerSuggestions.map((c) => {
                const secondary = formatPartySecondaryName(c.trade_name, c.legal_name);
                return (
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
                      className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3.5 py-2 text-left text-sm transition hover:bg-bht-mist cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-bht-ink-strong">
                          {c.name}
                        </div>
                        {secondary && (
                          <div className="truncate text-xs text-bht-ink-soft">
                            {secondary}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1.5">
                        {c.city_zone && <Badge tone="horizon">{c.city_zone}</Badge>}
                        {c.doc_number && (
                          <span className="text-xs text-bht-ink-soft tabular-nums">
                            {c.doc_number}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}

              {showQuickCreateOption && (
                <li role="option" aria-selected={false}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setModalInitialAlias(trimmedQuery);
                      setModalMode("create");
                      setCustomerDropdownOpen(false);
                    }}
                    onClick={() => {
                      setModalInitialAlias(trimmedQuery);
                      setModalMode("create");
                      setCustomerDropdownOpen(false);
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-lg border-t border-bht-line px-3.5 py-2 text-left text-xs font-semibold text-bht-cobalt transition hover:bg-bht-cobalt-bg cursor-pointer"
                  >
                    <PlusIcon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">
                      Crear cliente &ldquo;{trimmedQuery}&rdquo;
                    </span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      </Card>

      {modalMode !== null && (
        <CustomerFormModal
          open
          mode={modalMode}
          initialCustomer={
            modalMode === "edit" && selectedCustomer
              ? {
                  party_id: selectedCustomer.party_id,
                  legal_name: selectedCustomer.legal_name ?? selectedCustomer.name,
                  trade_name: selectedCustomer.trade_name ?? null,
                  doc_type: selectedCustomer.doc_type ?? "NONE",
                  doc_number: selectedCustomer.doc_number ?? null,
                  is_generic_doc: Boolean(selectedCustomer.is_generic_doc),
                  phone: selectedCustomer.phone ?? null,
                  email: selectedCustomer.email ?? null,
                  address: selectedCustomer.address ?? null,
                  city_zone: selectedCustomer.city_zone ?? null,
                  notes: selectedCustomer.notes ?? null,
                  geo_lat: selectedCustomer.geo_lat ?? null,
                  geo_lng: selectedCustomer.geo_lng ?? null,
                  has_orders: Boolean(selectedCustomer.has_orders),
                }
              : null
          }
          initialAlias={modalInitialAlias}
          knownZones={knownZones}
          actorRole={actorRole}
          onClose={() => setModalMode(null)}
          onSaved={(saved) => handleCustomerSaved(saved, modalMode)}
        />
      )}
    </>
  );
}
