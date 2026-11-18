"use client";

import { AbonoModal, DebtorDetailModal } from "@/components/shared/CollectionControls";
import type { SellerCollections } from "@/features/seller/useSellerCollections";

export default function SellerCollectionModals({
  collections,
}: {
  collections: SellerCollections;
}) {
  const {
    debtorsByOrder,
    debtorsByCustomer,
    sellerAccounts,
    debtDetailTarget,
    setDebtDetailTarget,
    selectedOrderForAbono,
    selectedCustomerForFifo,
    abonoAmount,
    setAbonoAmount,
    abonoMode,
    setAbonoMode,
    abonoNextDays,
    setAbonoNextDays,
    abonoAccountId,
    setAbonoAccountId,
    busyAbono,
    startOrderAbono,
    startCustomerAbono,
    closeAbonoModal,
    handleSubmitAbono,
  } = collections;
  return (
    <>
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
          const matchedOrder = debtorsByOrder.find((o) => o.orderId === order.orderId);
          if (!matchedOrder) return;
          setDebtDetailTarget(null);
          startOrderAbono(matchedOrder);
        }}
        onSelectCustomerAbono={() => {
          if (debtDetailTarget?.mode !== "customer") return;
          const matchedCustomer = debtorsByCustomer.find(
            (c) => c.customerKey === debtDetailTarget.customerKey
          );
          if (!matchedCustomer) return;
          setDebtDetailTarget(null);
          startCustomerAbono(matchedCustomer);
        }}
      />

      <AbonoModal
        open={Boolean(selectedOrderForAbono || selectedCustomerForFifo)}
        onClose={closeAbonoModal}
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
              <strong className="text-bht-danger tabular-nums">
                Deuda Total: S/ {selectedCustomerForFifo.totalBalanceDuePen.toFixed(2)}
              </strong>
            </>
          ) : selectedOrderForAbono ? (
            <>
              Pedido {selectedOrderForAbono.orderCode} · Total: S/{" "}
              {selectedOrderForAbono.totalPen.toFixed(2)} · Abonado: S/{" "}
              {selectedOrderForAbono.paidPen.toFixed(2)} ·{" "}
              <strong className="text-bht-danger tabular-nums">
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
    </>
  );
}
