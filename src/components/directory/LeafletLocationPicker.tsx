"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SegmentedControl } from "@/components/ui/Primitives";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "@/lib/geo";

type MapLayerMode = "street" | "satellite";

const STREET_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

interface Props {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
}

export default function LeafletLocationPicker({ lat, lng, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const streetLayerRef = useRef<L.TileLayer | null>(null);
  const satLayerRef = useRef<L.TileLayer | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [layerMode, setLayerMode] = useState<MapLayerMode>("street");

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const hasInitial = lat !== null && lng !== null;
    const map = L.map(el, {
      center: hasInitial
        ? [lat, lng]
        : [DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng],
      zoom: hasInitial ? 16 : DEFAULT_MAP_ZOOM,
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
    mapRef.current = map;
    streetLayerRef.current = streetLayer;
    satLayerRef.current = satLayer;

    const placeOrMoveMarker = (nextLat: number, nextLng: number) => {
      const icon = L.divIcon({
        className: "bht-map-pin-wrap",
        html: '<span class="bht-map-pin"></span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      if (!markerRef.current) {
        const marker = L.marker([nextLat, nextLng], { icon, draggable: true }).addTo(
          map
        );
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          onChangeRef.current(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
        });
        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng([nextLat, nextLng]);
      }
    };

    if (hasInitial) {
      placeOrMoveMarker(lat, lng);
    }

    map.on("click", (e: L.LeafletMouseEvent) => {
      const nextLat = Number(e.latlng.lat.toFixed(6));
      const nextLng = Number(e.latlng.lng.toFixed(6));
      placeOrMoveMarker(nextLat, nextLng);
      onChangeRef.current(nextLat, nextLng);
    });

    const timer = window.setTimeout(() => map.invalidateSize(), 80);

    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      streetLayerRef.current = null;
      satLayerRef.current = null;
    };
    // Initial map lifecycle only; external coordinate updates handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (lat === null || lng === null) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }

    const icon = L.divIcon({
      className: "bht-map-pin-wrap",
      html: '<span class="bht-map-pin"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    if (!markerRef.current) {
      const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        onChangeRef.current(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
      });
      markerRef.current = marker;
      map.setView([lat, lng], Math.max(map.getZoom(), 16));
    } else {
      const cur = markerRef.current.getLatLng();
      if (Math.abs(cur.lat - lat) > 0.000001 || Math.abs(cur.lng - lng) > 0.000001) {
        markerRef.current.setLatLng([lat, lng]);
        map.panTo([lat, lng]);
      }
    }
  }, [lat, lng]);

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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-bht-ink-soft">
          Toca el mapa o arrastra el pin azul para ubicar el local.
        </p>
        <SegmentedControl
          value={layerMode}
          onChange={setLayerMode}
          ariaLabel="Capa de mapa"
          options={[
            { id: "street", label: "Mapa" },
            { id: "satellite", label: "Satélite" },
          ]}
        />
      </div>
      <div
        ref={containerRef}
        aria-label="Selector interactivo de ubicación en mapa"
        className="bht-map-container h-56 w-full overflow-hidden rounded-xl border border-bht-slate-line bg-bht-surface-cool"
      />
    </div>
  );
}
