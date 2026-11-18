"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { MapPinIcon, NavigationIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import { ApiClientError, fetchJson } from "@/lib/api-client";
import { buildGoogleMapsUrl, normalizeZone, parseGeoInput } from "@/lib/geo";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { CustomerDirectoryItem } from "@/lib/services/customers";

const LeafletLocationPicker = dynamic(() => import("./LeafletLocationPicker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-56 items-center justify-center rounded-xl border border-bht-slate-line bg-bht-surface-cool text-xs font-medium text-bht-ink-soft">
      Cargando mapa interactivo...
    </div>
  ),
});

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
  const [isActive, setIsActive] = useState(true);
  const [geoLat, setGeoLat] = useState<number | null>(null);
  const [geoLng, setGeoLng] = useState<number | null>(null);
  const [geoAccuracyM, setGeoAccuracyM] = useState<number | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [geoLinkInput, setGeoLinkInput] = useState("");
  const [locatingGps, setLocatingGps] = useState(false);
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
    setGeoLinkInput("");
    setLocatingGps(false);

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

  function handleCaptureCurrentGps() {
    setLocalError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocalError("Este navegador o dispositivo no soporta geolocalización GPS.");
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLat(Number(pos.coords.latitude.toFixed(6)));
        setGeoLng(Number(pos.coords.longitude.toFixed(6)));
        setGeoAccuracyM(
          Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null
        );
        setLocatingGps(false);
        setShowMapPicker(true);
      },
      (err) => {
        setLocatingGps(false);
        const msg =
          err.code === 1
            ? "Permiso de ubicación denegado. Activa el GPS o elige el punto en el mapa."
            : "No se pudo obtener tu GPS actual; prueba en mapa o pega un enlace de Google Maps.";
        setLocalError(msg);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  function handleApplyGeoLink() {
    setLocalError(null);
    const parsed = parseGeoInput(geoLinkInput);
    if (!parsed) {
      setLocalError(
        "No se reconocieron coordenadas válidas. Pega un enlace de Google Maps o algo como -12.7123, -69.5841."
      );
      return;
    }
    setGeoLat(parsed.lat);
    setGeoLng(parsed.lng);
    setGeoAccuracyM(null);
    setGeoLinkInput("");
    setShowMapPicker(true);
  }

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

      if (isPartner) {
        payload.isActive = isActive;
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
            className="rounded-xl border border-bht-danger-line bg-bht-danger-bg px-3.5 py-2.5 text-xs font-medium text-bht-danger-text"
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
              <p className="mt-1 text-[11px] text-bht-ink-soft">
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
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition cursor-pointer ${
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
                  <p className="mt-1 text-[11px] text-bht-ink-soft">
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

            <div className="space-y-2.5 rounded-xl border border-bht-line bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-bht-ink-strong">
                  <MapPinIcon className="h-4 w-4 text-bht-cobalt" />
                  Geolocalización del local (opcional)
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={locatingGps}
                    onClick={handleCaptureCurrentGps}
                  >
                    <NavigationIcon className="h-3.5 w-3.5" />
                    {locatingGps ? "Ubicando..." : "Usar mi GPS actual"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowMapPicker((v) => !v)}
                  >
                    <MapPinIcon className="h-3.5 w-3.5" />
                    {showMapPicker ? "Ocultar mapa" : "Elegir en mapa"}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  aria-label="Pegar enlace de Google Maps o coordenadas"
                  value={geoLinkInput}
                  onChange={(e) => setGeoLinkInput(e.target.value)}
                  placeholder="Pegar link de Google Maps / WhatsApp o coords (-12.7123, -69.5841)"
                  className={`${INPUT_CLASS} min-w-[200px] flex-1 py-2 text-xs`}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleApplyGeoLink}
                >
                  Aplicar
                </Button>
              </div>

              {geoLat !== null && geoLng !== null && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bht-surface-cool px-3 py-2 text-xs">
                  <span className="font-medium text-bht-ink-deep tabular-nums">
                    Coords: {geoLat.toFixed(6)}, {geoLng.toFixed(6)}
                    {geoAccuracyM !== null ? ` (±${geoAccuracyM} m)` : ""}
                  </span>
                  <div className="flex items-center gap-3">
                    <a
                      href={buildGoogleMapsUrl(geoLat, geoLng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-bht-cobalt hover:underline"
                    >
                      Ver en Maps
                    </a>
                    <button
                      type="button"
                      data-compact="true"
                      onClick={() => {
                        setGeoLat(null);
                        setGeoLng(null);
                        setGeoAccuracyM(null);
                      }}
                      className="font-semibold text-bht-danger hover:underline cursor-pointer"
                    >
                      Quitar pin
                    </button>
                  </div>
                </div>
              )}

              {showMapPicker && (
                <LeafletLocationPicker
                  lat={geoLat}
                  lng={geoLng}
                  onChange={(lat, lng) => {
                    setGeoLat(lat);
                    setGeoLng(lng);
                    setGeoAccuracyM(null);
                  }}
                />
              )}
            </div>

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
