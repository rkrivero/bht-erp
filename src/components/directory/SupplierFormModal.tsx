"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { SupplierDirectoryItem } from "@/lib/services/customers";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialSupplier?: SupplierDirectoryItem | null;
  onClose: () => void;
  onSaved: (supplier: SupplierDirectoryItem) => void;
  onError?: (msg: string) => void;
}

export default function SupplierFormModal({
  open,
  mode,
  initialSupplier,
  onClose,
  onSaved,
  onError,
}: Props) {
  const [tradeName, setTradeName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [docType, setDocType] = useState("RUC");
  const [docNumber, setDocNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [cityZone, setCityZone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    if (mode === "edit" && initialSupplier) {
      setTradeName(String(initialSupplier.trade_name || ""));
      setLegalName(String(initialSupplier.legal_name || ""));
      setDocType(String(initialSupplier.doc_type || "NONE"));
      setDocNumber(String(initialSupplier.doc_number || ""));
      setPhone(String(initialSupplier.phone || ""));
      setCityZone(String(initialSupplier.city_zone || ""));
      setAddress(String(initialSupplier.address || ""));
      setEmail(String(initialSupplier.email || ""));
      setNotes(String(initialSupplier.notes || ""));
      setIsActive(initialSupplier.is_active !== false);
    } else {
      setTradeName("");
      setLegalName("");
      setDocType("RUC");
      setDocNumber("");
      setPhone("");
      setCityZone("");
      setAddress("");
      setEmail("");
      setNotes("");
      setIsActive(true);
    }
  }, [open, mode, initialSupplier]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setLocalError(null);

    if (!tradeName.trim() && !legalName.trim()) {
      setLocalError(
        "Ingresa al menos el nombre comercial o la razón social del proveedor."
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        tradeName: tradeName.trim() || null,
        legalName: legalName.trim() || null,
        docType: docType || "NONE",
        docNumber: docNumber.trim() || null,
        phone: phone.trim() || null,
        cityZone: cityZone.trim() || null,
        address: address.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
      };

      const res =
        mode === "create"
          ? await fetchJson<{ supplier: SupplierDirectoryItem }>("/api/suppliers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetchJson<{ supplier: SupplierDirectoryItem }>("/api/suppliers", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...payload,
                partyId: initialSupplier?.party_id,
                isActive,
              }),
            });

      notifyLocalSync(["purchases", "partners"]);
      onSaved(res.supplier);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : "No se pudo guardar los datos del proveedor.";
      setLocalError(msg);
      onError?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      maxWidth="lg"
      title={mode === "create" ? "Nuevo proveedor" : "Editar proveedor"}
      subtitle="Datos maestros de contacto y facturación; las compras y CxP se operan en Caja."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {localError && (
          <div
            role="alert"
            className="rounded-xl border border-bht-danger-line bg-bht-danger-bg px-3.5 py-2.5 text-xs font-medium text-bht-danger-text"
          >
            {localError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="supp-trade-name">Alias / Nombre comercial</FieldLabel>
            <input
              id="supp-trade-name"
              type="text"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              placeholder="Ej. Aceros Arequipa"
              className={`${INPUT_CLASS} mt-1`}
              autoFocus={mode === "create"}
            />
          </div>
          <div>
            <FieldLabel htmlFor="supp-legal-name">Razón social / Nombre</FieldLabel>
            <input
              id="supp-legal-name"
              type="text"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Ej. Corporación Aceros S.A."
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="supp-doc-type">Tipo documento</FieldLabel>
            <select
              id="supp-doc-type"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className={`${INPUT_CLASS} mt-1`}
            >
              <option value="RUC">RUC</option>
              <option value="DNI">DNI</option>
              <option value="CE">CE</option>
              <option value="PASSPORT">Pasaporte</option>
              <option value="NONE">Sin doc.</option>
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="supp-doc-number">Número RUC / DNI</FieldLabel>
            <input
              id="supp-doc-number"
              type="text"
              value={docNumber}
              disabled={docType === "NONE"}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="Número de documento"
              className={`${INPUT_CLASS} mt-1 disabled:bg-bht-paper-alt`}
            />
          </div>

          <div>
            <FieldLabel htmlFor="supp-phone">Teléfono</FieldLabel>
            <input
              id="supp-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Teléfono o contacto de pedidos"
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>
          <div>
            <FieldLabel htmlFor="supp-zone">Ciudad / Zona</FieldLabel>
            <input
              id="supp-zone"
              type="text"
              value={cityZone}
              onChange={(e) => setCityZone(e.target.value)}
              placeholder="Ej. LIMA, CUSCO, PTO. MALDONADO"
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="supp-address">Dirección</FieldLabel>
            <input
              id="supp-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Dirección fiscal o almacén de recojo"
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>
          <div>
            <FieldLabel htmlFor="supp-email">Correo (opcional)</FieldLabel>
            <input
              id="supp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ventas@proveedor.com"
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="supp-notes">Notas / Condiciones</FieldLabel>
          <input
            id="supp-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej. Cuenta bancaria, plazo de crédito, horario"
            className={`${INPUT_CLASS} mt-1`}
          />
        </div>

        {mode === "edit" && (
          <label className="flex items-center gap-2.5 text-xs font-medium text-bht-ink-strong cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-bht-slate-line accent-bht-cobalt"
            />
            <span>Proveedor activo para nuevas compras</span>
          </label>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bht-line pt-3">
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={submitting}>
            {submitting
              ? "Guardando..."
              : mode === "create"
                ? "Crear proveedor"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
