"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { MapPinIcon, NavigationIcon } from "@/components/ui/Icons";
import { Button, INPUT_CLASS } from "@/components/ui/Primitives";
import { buildGoogleMapsUrl, parseGeoInput } from "@/lib/geo";

const LeafletLocationPicker = dynamic(() => import("./LeafletLocationPicker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-56 items-center justify-center rounded-xl border border-bht-slate-line bg-bht-surface-cool text-xs font-medium text-bht-ink-soft">
      Cargando mapa interactivo...
    </div>
  ),
});

interface CustomerGeoPickerSectionProps {
  geoLat: number | null;
  geoLng: number | null;
  geoAccuracyM: number | null;
  showMapPicker: boolean;
  onToggleMapPicker: () => void;
  onChangeGeo: (
    lat: number | null,
    lng: number | null,
    accuracyM: number | null
  ) => void;
  onError: (msg: string | null) => void;
}

export default function CustomerGeoPickerSection({
  geoLat,
  geoLng,
  geoAccuracyM,
  showMapPicker,
  onToggleMapPicker,
  onChangeGeo,
  onError,
}: CustomerGeoPickerSectionProps) {
  const [geoLinkInput, setGeoLinkInput] = useState("");
  const [locatingGps, setLocatingGps] = useState(false);

  function handleCaptureCurrentGps() {
    onError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      onError("Este navegador o dispositivo no soporta geolocalización GPS.");
      return;
    }
    setLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const acc = Number.isFinite(pos.coords.accuracy)
          ? Math.round(pos.coords.accuracy)
          : null;
        onChangeGeo(lat, lng, acc);
        setLocatingGps(false);
        if (!showMapPicker) onToggleMapPicker();
      },
      (err) => {
        setLocatingGps(false);
        const msg =
          err.code === 1
            ? "Permiso de ubicación denegado. Activa el GPS o elige el punto en el mapa."
            : "No se pudo obtener tu GPS actual; prueba en mapa o pega un enlace de Google Maps.";
        onError(msg);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  function handleApplyGeoLink() {
    onError(null);
    const parsed = parseGeoInput(geoLinkInput);
    if (!parsed) {
      onError(
        "No se reconocieron coordenadas válidas. Pega un enlace de Google Maps o algo como -12.7123, -69.5841."
      );
      return;
    }
    onChangeGeo(parsed.lat, parsed.lng, null);
    setGeoLinkInput("");
    if (!showMapPicker) onToggleMapPicker();
  }

  return (
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
          <Button type="button" variant="outline" size="sm" onClick={onToggleMapPicker}>
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
        <Button type="button" variant="outline" size="sm" onClick={handleApplyGeoLink}>
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
              onClick={() => onChangeGeo(null, null, null)}
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
          onChange={(lat, lng) => onChangeGeo(lat, lng, null)}
        />
      )}
    </div>
  );
}
