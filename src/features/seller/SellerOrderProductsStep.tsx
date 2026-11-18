"use client";

import { CloseIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  FieldLabel,
  INPUT_CLASS,
} from "@/components/ui/Primitives";
import { formatFulfillmentModeEs, formatUnitTitleEs } from "@/lib/labels-es";
import type { SellerOrderFlow } from "@/features/seller/useSellerOrderFlow";

export default function SellerOrderProductsStep({ flow }: { flow: SellerOrderFlow }) {
  const {
    orderStep,
    cart,
    catalog,
    initialLoading,
    searchProduct,
    setSearchProduct,
    showAllCatalog,
    setShowAllCatalog,
    filteredCatalog,
    visibleCatalog,
    catalogPreviewLimit,
    cartQtyByProductId,
    addToCart,
    openOrderStep,
  } = flow;
  return (
    <Card
      id="seller-step-products"
      className={`scroll-mt-24 space-y-3 ${orderStep !== "products" && cart.length > 0 ? "hidden" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor="seller-search-product">
          2. Buscar y agregar productos
        </FieldLabel>
        <span id="seller-catalog-count" className="text-xs text-[#5C5A55] tabular-nums">
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
              const inCartQty = cartQtyByProductId.get(prod.product_id) ?? 0;
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
                        S/ {Number(prod.list_sale_price_pen ?? 0).toFixed(2)}{" "}
                        <span
                          title={formatUnitTitleEs(prod.unit_of_measure || "NIU")}
                          className="text-xs font-normal text-[#6D6A64]"
                        >
                          / {prod.unit_of_measure || "NIU"}
                        </span>
                      </span>
                      <span>
                        · Mín: S/ {Number(prod.min_sale_price_pen ?? 0).toFixed(2)}
                      </span>
                      <span>
                        · Stock:{" "}
                        <strong>
                          {prod.stock_on_hand} {prod.unit_of_measure || "NIU"}
                        </strong>
                      </span>
                      <Badge
                        tone={
                          prod.fulfillment_mode === "ON_DEMAND" ? "warning" : "neutral"
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
      {cart.length > 0 && (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => openOrderStep("payment")}
          className="w-full sm:w-auto"
        >
          Continuar al pago ({cart.length})
        </Button>
      )}
    </Card>
  );
}
