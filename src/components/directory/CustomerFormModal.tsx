"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { normalizeZone } from "@/lib/geo";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { CustomerDirectoryItem } from "@/lib/services/customers";
import CreditLimitSuggestionBox from "./CreditLimitSuggestionBox";
import CustomerGeoPickerSection from "./CustomerGeoPickerSection";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  initialCustomer?: Partial<CustomerDirectoryItem> | null;
  initialAlias?: string;
  knownZones: string[];
  actorRole: string;
  onClose: () => void;
  onSaved: (customer: CustomerDirectoryItem) => void;
  onError?: (msg: string) => void;
}

export default function CustomerFormModal({
  open,
  mode,
  initialCustomer,
  initialAlias,
  knownZones,
  actorRole,
  onClose,
  onSaved,
  onError,
}: Props) {
  const zonesListId = useId();
  const isPartner = actorRole === "PARTNER_ADMIN" || actorRole === "PARTNER_MANAGER";
  const isSeller = actorRole === "EXTERNAL_SELLER";
  const hasOrders = Boolean(initialCustomer?.has_orders);

  const legalNameLocked = mode === "edit" && isSeller && hasOrders;
  const hasRealDoc = Boolean(
    initialCustomer &&
    !initialCustomer.is_generic_doc &&
    initialCustomer.doc_number &&
    initialCustomer.doc_type &&
    initialCustomer.doc_type !== "NONE"
  );
  const docLocked = mode === "edit" && isSeller && hasOrders && hasRealDoc;

  const [tradeName, setTradeName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [cityZone, setCityZone] = useState("");
  const [phone, setPhone] = useState("");
  const [docType, setDocType] = useState("NONE");
  const [docNumber, setDocNumber] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [creditDaysAgreed, setCreditDaysAgreed] = useState("");
  const [creditLimitPen, setCreditLimitPen] = useState("");
  const [lastContactDate, setLastContactDate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [geoLat, setGeoLat] = useState<number | null>(null);
  const [geoLng, setGeoLng] = useState<number | null>(null);
  const [geoAccuracyM, setGeoAccuracyM] = useState<number | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [initialDocSnap, setInitialDocSnap] = useState({ type: "NONE", number: "" });
  const [initialGeoSnap, setInitialGeoSnap] = useState<{
    lat: number | null;
    lng: number | null;
  }>({ lat: null, lng: null });

  useEffect(() => {
    if (!open) return;
    setLocalError(null);

    if (mode === "edit" && initialCustomer) {
      const initDocType = initialCustomer.is_generic_doc
        ? "NONE"
        : String(initialCustomer.doc_type || "NONE");
      const initDocNum = initialCustomer.is_generic_doc
        ? ""
        : String(initialCustomer.doc_number || "");
      const latVal =
        initialCustomer.geo_lat !== undefined && initialCustomer.geo_lat !== null
          ? Number(initialCustomer.geo_lat)
          : null;
      const lngVal =
        initialCustomer.geo_lng !== undefined && initialCustomer.geo_lng !== null
          ? Number(initialCustomer.geo_lng)
          : null;

      setTradeName(String(initialCustomer.trade_name || ""));
      setLegalName(String(initialCustomer.legal_name || ""));
      setCityZone(String(initialCustomer.city_zone || ""));
      setPhone(String(initialCustomer.phone || ""));
      setDocType(initDocType);
      setDocNumber(initDocNum);
      setAddress(String(initialCustomer.address || ""));
      setEmail(String(initialCustomer.email || ""));
      setNotes(String(initialCustomer.notes || ""));
      setCreditDaysAgreed(
        initialCustomer.credit_days_agreed !== null &&
          initialCustomer.credit_days_agreed !== undefined
          ? String(initialCustomer.credit_days_agreed)
          : ""
      );
      setCreditLimitPen(
        initialCustomer.credit_limit_pen !== null &&
          initialCustomer.credit_limit_pen !== undefined
          ? String(initialCustomer.credit_limit_pen)
          : ""
      );
      setLastContactDate(String(initialCustomer.last_contact_date || ""));
      setIsActive(initialCustomer.is_active !== false);
      setGeoLat(latVal);
      setGeoLng(lngVal);
      setGeoAccuracyM(
        initialCustomer.geo_accuracy_m !== undefined &&
          initialCustomer.geo_accuracy_m !== null
          ? Number(initialCustomer.geo_accuracy_m)
          : null
      );
      setInitialDocSnap({ type: initDocType, number: initDocNum });
      setInitialGeoSnap({ lat: latVal, lng: lngVal });
      setShowAdvanced(true);
      setShowMapPicker(false);
    } else {
      setTradeName(String(initialAlias || "").trim());
      setLegalName("");
      setCityZone("");
      setPhone("");
      setDocType("NONE");
      setDocNumber("");
      setAddress("");
      setEmail("");
      setNotes("");
      setCreditDaysAgreed("");
      setCreditLimitPen("");
      setLastContactDate("");
      setIsActive(true);
      setGeoLat(null);
      setGeoLng(null);
      setGeoAccuracyM(null);
      setInitialDocSnap({ type: "NONE", number: "" });
      setInitialGeoSnap({ lat: null, lng: null });
      setShowAdvanced(false);
      setShowMapPicker(false);
    }
  }, [open, mode, initialCustomer, initialAlias]);

  const topZones = useMemo(() => {
    const clean = knownZones
      .map((z) => normalizeZone(z))
      .filter((z): z is string => Boolean(z));
    return Array.from(new Set(clean)).slice(0, 6);
  }, [knownZones]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setLocalError(null);

    if (!tradeName.trim() && !legalName.trim()) {
      setLocalError(
        "Ingresa al menos el alias / nombre comercial o el nombre completo."
      );
      return;
    }

    setSubmitting(true);
    try {
      const creditDaysVal =
        creditDaysAgreed.trim() === "" ? null : Number(creditDaysAgreed);
      const creditLimitVal =
        creditLimitPen.trim() === "" ? null : Number(creditLimitPen);
      const lastContactVal = lastContactDate.trim() || null;

      if (mode === "create") {
        const res = await fetchJson<{ customer: CustomerDirectoryItem }>(
          "/api/customers",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tradeName: tradeName.trim() || null,
              legalName: legalName.trim() || null,
              cityZone: cityZone.trim() || null,
              phone: phone.trim() || null,
              docType: docType || "NONE",
              docNumber: docNumber.trim() || null,
              address: address.trim() || null,
              email: email.trim() || null,
              notes: notes.trim() || null,
              geoLat,
              geoLng,
              geoAccuracyM,
              ...(isPartner
                ? {
                    creditDaysAgreed: creditDaysVal,
                    creditLimitPen: creditLimitVal,
                  }
                : {}),
              ...(isPartner || isSeller ? { lastContactDate: lastContactVal } : {}),
            }),
          }
        );
        notifyLocalSync(["orders", "partners"]);
        onSaved(res.customer);
        onClose();
        return;
      }

      if (!initialCustomer?.party_id) {
        setLocalError("Falta el identificador del cliente a actualizar.");
        return;
      }

      const payload: Record<string, unknown> = {
        partyId: initialCustomer.party_id,
        tradeName: tradeName.trim() || null,
        cityZone: cityZone.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
      };

      if (!legalNameLocked) {
        payload.legalName = legalName.trim() || null;
      }

      const docChanged =
        docType !== initialDocSnap.type || docNumber.trim() !== initialDocSnap.number;
      if (!docLocked && docChanged) {
        payload.docType = docType || "NONE";
        payload.docNumber = docNumber.trim() || null;
      }

      const geoChanged = geoLat !== initialGeoSnap.lat || geoLng !== initialGeoSnap.lng;
      if (geoChanged) {
        payload.geoLat = geoLat;
        payload.geoLng = geoLng;
        payload.geoAccuracyM = geoAccuracyM;
      }

      if (isPartner || isSeller) {
        payload.lastContactDate = lastContactVal;
      }

      if (isPartner) {
        payload.isActive = isActive;
        payload.creditDaysAgreed = creditDaysVal;
        payload.creditLimitPen = creditLimitVal;
      }

      const res = await fetchJson<{ customer: CustomerDirectoryItem }>(
        "/api/customers",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      notifyLocalSync(["orders", "partners"]);
      onSaved(res.customer);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : "No se pudo guardar los datos del cliente.";
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
      maxWidth="2xl"
      title={mode === "create" ? "Alta rápida de cliente" : "Editar cliente"}
      subtitle="Con llenar el alias (ferretería) o el nombre completo basta; la búsqueda encontrará ambos."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {localError && (
          <div
            role="alert"
            className="rounded-xl border border-bht-danger-line bg-bht-danger-bg px-3.5 py-2.5 text-xs font-medium text-bht-danger-strong"
          >
            {localError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel htmlFor="cust-trade-name">
              Alias / Nombre comercial (Ferretería)
            </FieldLabel>
            <input
              id="cust-trade-name"
              type="text"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              placeholder="Ej. Ferretería El Sol"
              className={`${INPUT_CLASS} mt-1`}
              autoFocus={mode === "create"}
            />
          </div>

          <div>
            <FieldLabel htmlFor="cust-legal-name">
              Nombre completo / Razón social
            </FieldLabel>
            <input
              id="cust-legal-name"
              type="text"
              value={legalName}
              disabled={legalNameLocked}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Ej. Inversiones Sol S.A.C. / Juan Pérez"
              className={`${INPUT_CLASS} mt-1 disabled:bg-bht-surface-cool disabled:text-bht-ink-muted`}
            />
            {legalNameLocked && (
              <p className="mt-1 text-xs text-bht-ink-soft">
                Bloqueado por tener pedidos; aún puedes actualizar el alias comercial.
              </p>
            )}
          </div>

          <div>
            <FieldLabel htmlFor="cust-zone">Zona / Sector</FieldLabel>
            <input
              id="cust-zone"
              type="text"
              list={zonesListId}
              value={cityZone}
              onChange={(e) => setCityZone(e.target.value)}
              placeholder="Ej. LABERINTO, KM 110, PTO. MALDONADO"
              className={`${INPUT_CLASS} mt-1`}
            />
            <datalist id={zonesListId}>
              {knownZones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            {topZones.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {topZones.map((zone) => (
                  <button
                    key={zone}
                    type="button"
                    data-compact="true"
                    onClick={() => setCityZone(zone)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition cursor-pointer ${
                      normalizeZone(cityZone) === zone
                        ? "border-bht-cobalt bg-bht-cobalt-bg text-bht-cobalt-strong"
                        : "border-bht-slate-line bg-bht-surface-cool text-bht-ink-soft hover:text-bht-ink-strong"
                    }`}
                  >
                    {zone}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <FieldLabel htmlFor="cust-phone">Teléfono / WhatsApp</FieldLabel>
            <input
              id="cust-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej. 982 345 678"
              className={`${INPUT_CLASS} mt-1`}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bht-line pt-3">
          <button
            type="button"
            data-compact="true"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs font-semibold text-bht-cobalt hover:underline cursor-pointer"
          >
            {showAdvanced
              ? "Ocultar RUC/DNI, dirección y mapa GPS"
              : "+ Agregar RUC/DNI, dirección y ubicación GPS"}
          </button>

          {geoLat !== null && geoLng !== null && (
            <Badge tone="success">
              GPS fijado ({geoLat.toFixed(4)}, {geoLng.toFixed(4)})
            </Badge>
          )}
        </div>

        {showAdvanced && (
          <div className="space-y-4 rounded-2xl border border-bht-line bg-bht-surface-cool/60 p-3.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <FieldLabel htmlFor="cust-doc-type">Tipo doc.</FieldLabel>
                <select
                  id="cust-doc-type"
                  value={docType}
                  disabled={docLocked}
                  onChange={(e) => setDocType(e.target.value)}
                  className={`${INPUT_CLASS} mt-1 disabled:bg-bht-paper-alt`}
                >
                  <option value="NONE">Sin doc.</option>
                  <option value="RUC">RUC</option>
                  <option value="DNI">DNI</option>
                  <option value="CE">CE</option>
                  <option value="PASSPORT">Pasaporte</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="cust-doc-number">Número RUC / DNI</FieldLabel>
                <input
                  id="cust-doc-number"
                  type="text"
                  value={docNumber}
                  disabled={docLocked || docType === "NONE"}
                  onChange={(e) => setDocNumber(e.target.value)}
                  placeholder={
                    docType === "NONE"
                      ? "Elige RUC o DNI si deseas registrarlo"
                      : "Número de documento"
                  }
                  className={`${INPUT_CLASS} mt-1 disabled:bg-bht-paper-alt`}
                />
                {initialCustomer?.is_generic_doc && (
                  <p className="mt-1 text-xs text-bht-ink-soft">
                    Este registro tenía un código genérico ({initialCustomer.doc_number}
                    ). Puedes ingresar su RUC o DNI real.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="cust-address">Dirección</FieldLabel>
                <input
                  id="cust-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Av. / Jr. / Referencia de carretera"
                  className={`${INPUT_CLASS} mt-1`}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-email">Correo (opcional)</FieldLabel>
                <input
                  id="cust-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className={`${INPUT_CLASS} mt-1`}
                />
              </div>
            </div>

            <div>
              <FieldLabel htmlFor="cust-notes">Referencia de local / Notas</FieldLabel>
              <input
                id="cust-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. Portón verde frente al grifo / horario de atención"
                className={`${INPUT_CLASS} mt-1`}
              />
            </div>

            {(isPartner || isSeller) && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <FieldLabel htmlFor="cust-last-contact">Último contacto</FieldLabel>
                  <input
                    id="cust-last-contact"
                    type="date"
                    value={lastContactDate}
                    onChange={(e) => setLastContactDate(e.target.value)}
                    className={`${INPUT_CLASS} mt-1 tabular-nums`}
                  />
                </div>
                {isPartner && (
                  <>
                    <div>
                      <FieldLabel htmlFor="cust-credit-days">
                        Plazo de crédito (días)
                      </FieldLabel>
                      <input
                        id="cust-credit-days"
                        type="number"
                        min="0"
                        max="365"
                        step="1"
                        value={creditDaysAgreed}
                        onChange={(e) => setCreditDaysAgreed(e.target.value)}
                        placeholder="Ej. 15"
                        className={`${INPUT_CLASS} mt-1 tabular-nums`}
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor="cust-credit-limit">
                        Límite de crédito (S/)
                      </FieldLabel>
                      <input
                        id="cust-credit-limit"
                        type="number"
                        min="0"
                        step="0.01"
                        value={creditLimitPen}
                        onChange={(e) => setCreditLimitPen(e.target.value)}
                        placeholder="Opcional"
                        className={`${INPUT_CLASS} mt-1 tabular-nums`}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {mode === "edit" && isPartner && initialCustomer?.party_id && (
              <CreditLimitSuggestionBox
                partyId={Number(initialCustomer.party_id)}
                onApplyLimit={(suggested) => setCreditLimitPen(suggested.toFixed(2))}
              />
            )}

            <CustomerGeoPickerSection
              geoLat={geoLat}
              geoLng={geoLng}
              geoAccuracyM={geoAccuracyM}
              showMapPicker={showMapPicker}
              onToggleMapPicker={() => setShowMapPicker((v) => !v)}
              onChangeGeo={(lat, lng, acc) => {
                setGeoLat(lat);
                setGeoLng(lng);
                setGeoAccuracyM(acc);
              }}
              onError={setLocalError}
            />

            {mode === "edit" && isPartner && (
              <label className="flex items-center gap-2.5 text-xs font-medium text-bht-ink-strong cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-bht-slate-line accent-bht-cobalt"
                />
                <span>Cliente activo en el buscador de pedidos</span>
              </label>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bht-line pt-3">
          <Button type="button" variant="outline" size="md" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" size="md" disabled={submitting}>
            {submitting
              ? "Guardando..."
              : mode === "create"
                ? "Guardar y seleccionar"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </ModalSheet>
  );
}
