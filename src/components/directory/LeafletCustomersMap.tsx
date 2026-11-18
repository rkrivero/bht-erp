"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { EditIcon, NavigationIcon, PhoneIcon } from "@/components/ui/Icons";
import { Badge, Button, Card, SegmentedControl } from "@/components/ui/Primitives";
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  buildGoogleMapsUrl,
  formatPartySecondaryName,
} from "@/lib/geo";
import type { CustomerDirectoryItem } from "@/lib/services/customers";

type MapLayerMode = "street" | "satellite";

const STREET_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

interface Props {
  customers: CustomerDirectoryItem[];
  onEditCustomer: (customer: CustomerDirectoryItem) => void;
}

export default function LeafletCustomersMap({ customers, onEditCustomer }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const streetLayerRef = useRef<L.TileLayer | null>(null);
  const satLayerRef = useRef<L.TileLayer | null>(null);

  const [layerMode, setLayerMode] = useState<MapLayerMode>("street");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const locatedCustomers = useMemo(
    () =>
      customers.filter(
        (c): c is CustomerDirectoryItem & { geo_lat: number; geo_lng: number } =>
          c.geo_lat !== null && c.geo_lng !== null
      ),
    [customers]
  );

  const selectedCustomer = useMemo(
    () =>
      locatedCustomers.find((c) => c.party_id === selectedId) ??
      locatedCustomers[0] ??
      null,
    [locatedCustomers, selectedId]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng],
      zoom: DEFAULT_MAP_ZOOM,
      zoomControl: true,
    });
    const streetLayer = L.tileLayer(STREET_TILE_URL, {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    });
    const satLayer = L.tileLayer(SATELLITE_TILE_URL, {
      maxZoom: 18,
      attribution: "Esri World Imagery",
    });
    streetLayer.addTo(map);
    const group = L.layerGroup().addTo(map);

    mapRef.current = map;
    streetLayerRef.current = streetLayer;
    satLayerRef.current = satLayer;
    markersLayerRef.current = group;

    const timer = window.setTimeout(() => map.invalidateSize(), 80);
    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      streetLayerRef.current = null;
      satLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const street = streetLayerRef.current;
    const sat = satLayerRef.current;
    if (!map || !street || !sat) return;

    if (layerMode === "satellite") {
      if (map.hasLayer(street)) map.removeLayer(street);
      if (!map.hasLayer(sat)) sat.addTo(map);
    } else {
      if (map.hasLayer(sat)) map.removeLayer(sat);
      if (!map.hasLayer(street)) street.addTo(map);
    }
  }, [layerMode]);

  useEffect(() => {
    const map = mapRef.current;
    const group = markersLayerRef.current;
    if (!map || !group) return;

    group.clearLayers();
    if (locatedCustomers.length === 0) {
      map.setView([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], DEFAULT_MAP_ZOOM);
      return;
    }

    const bounds: [number, number][] = [];
    for (const cust of locatedCustomers) {
      const isSelected = selectedCustomer?.party_id === cust.party_id;
      const pinClasses = [
        "bht-map-pin",
        !cust.is_active
          ? "bht-map-pin--inactive"
          : cust.open_balance_pen > 0.05
            ? "bht-map-pin--debt"
            : "",
        isSelected ? "bht-map-pin--selected" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const marker = L.marker([cust.geo_lat, cust.geo_lng], {
        icon: L.divIcon({
          className: "bht-map-pin-wrap",
          html: `<span class="${pinClasses}"></span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        title: cust.display_name,
      });
      marker.on("click", () => setSelectedId(cust.party_id));
      marker.addTo(group);
      bounds.push([cust.geo_lat, cust.geo_lng]);
    }

    if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
    }
  }, [locatedCustomers, selectedCustomer?.party_id]);

  const secondaryName = selectedCustomer
    ? formatPartySecondaryName(selectedCustomer.trade_name, selectedCustomer.legal_name)
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-bht-ink-soft">
          <span>
            <strong className="text-bht-ink-strong tabular-nums">
              {locatedCustomers.length}
            </strong>{" "}
            clientes geolocalizados
          </span>
          <Badge tone="brand">Azul: al día</Badge>
          <Badge tone="danger">Rojo: con saldo</Badge>
        </div>
        <SegmentedControl
          value={layerMode}
          onChange={setLayerMode}
          ariaLabel="Capa de mapa de clientes"
          options={[
            { id: "street", label: "Mapa" },
            { id: "satellite", label: "Satélite" },
          ]}
        />
      </div>

      <div
        ref={containerRef}
        aria-label="Mapa de clientes geolocalizados"
        className="bht-map-container h-80 w-full overflow-hidden rounded-2xl border border-bht-slate-line bg-bht-surface-cool sm:h-96"
      />

      {selectedCustomer && (
        <Card padding="md" className="border-bht-line-blue bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-bold text-bht-ink-strong sm:text-base">
                  {selectedCustomer.display_name}
                </h4>
                {selectedCustomer.city_zone && (
                  <Badge tone="horizon">{selectedCustomer.city_zone}</Badge>
                )}
                {selectedCustomer.open_balance_pen > 0.05 && (
                  <Badge tone="danger">
                    Debe S/ {selectedCustomer.open_balance_pen.toFixed(2)}
                  </Badge>
                )}
                {!selectedCustomer.is_active && <Badge tone="neutral">Inactivo</Badge>}
              </div>
              {secondaryName && (
                <p className="text-xs text-bht-ink-soft">
                  Razón social / nombre: {secondaryName}
                </p>
              )}
              {(selectedCustomer.address || selectedCustomer.phone) && (
                <p className="text-xs text-bht-ink-warm">
                  {selectedCustomer.address ? `${selectedCustomer.address} · ` : ""}
                  {selectedCustomer.phone && (
                    <a
                      href={`tel:${selectedCustomer.phone}`}
                      className="inline-flex items-center gap-1 font-medium text-bht-cobalt hover:underline"
                    >
                      <PhoneIcon className="h-3 w-3" />
                      {selectedCustomer.phone}
                    </a>
                  )}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <a
                href={buildGoogleMapsUrl(
                  selectedCustomer.geo_lat,
                  selectedCustomer.geo_lng
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-bht-slate-line bg-bht-surface-cool px-3 py-1.5 text-xs font-semibold text-bht-ink-deep transition hover:bg-bht-cobalt-bg"
              >
                <NavigationIcon className="h-3.5 w-3.5" />
                Abrir en Maps
              </a>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEditCustomer(selectedCustomer)}
              >
                <EditIcon className="h-3.5 w-3.5" />
                Editar
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
