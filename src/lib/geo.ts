export const DEFAULT_MAP_CENTER = { lat: -12.5933, lng: -69.1891 } as const;
export const DEFAULT_MAP_ZOOM = 11;

function isValidCoordinatePair(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function toFixedCoordPair(
  lat: number,
  lng: number
): { lat: number; lng: number } | null {
  if (!isValidCoordinatePair(lat, lng)) return null;
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
  };
}

/**
 * Parse coordinates or Google Maps / OpenStreetMap URLs pasted by field staff or clients.
 */
export function parseGeoInput(raw: string): { lat: number; lng: number } | null {
  const input = String(raw || "").trim();
  if (!input) return null;

  // 1. Direct coordinates: "-12.7123, -69.5841" or "-12.7123 -69.5841"
  const directMatch = input.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)\s*$/
  );
  if (directMatch) {
    return toFixedCoordPair(Number(directMatch[1]), Number(directMatch[2]));
  }

  // 2. Google Maps pin parameters (!3d<lat>!4d<lng>) take precedence when present
  const bangMatch = input.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
  if (bangMatch) {
    return toFixedCoordPair(Number(bangMatch[1]), Number(bangMatch[2]));
  }

  // 3. Query params: ?q=lat,lng / ?query=lat,lng / ?ll=lat,lng
  const queryMatch = input.match(
    /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i
  );
  if (queryMatch) {
    return toFixedCoordPair(Number(queryMatch[1]), Number(queryMatch[2]));
  }

  // 4. Google Maps viewport coordinates: /@lat,lng,zoom
  const atMatch = input.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|$|\/|z)/);
  if (atMatch) {
    return toFixedCoordPair(Number(atMatch[1]), Number(atMatch[2]));
  }

  // 5. OpenStreetMap fragment: #map=zoom/lat/lng
  const osmMatch = input.match(/#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/i);
  if (osmMatch) {
    return toFixedCoordPair(Number(osmMatch[1]), Number(osmMatch[2]));
  }

  return null;
}

/**
 * Build a direct Google Maps destination URL from coordinates.
 */
export function buildGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Normalize zone labels (" km 110 " -> "KM 110") for consistent filtering and autocomplete.
 */
export function normalizeZone(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().replace(/\s+/g, " ").toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Normalize customer or supplier names (trim, collapse whitespace, uppercase).
 */
export function normalizePartyName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().replace(/\s+/g, " ").toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Return the legal name when it differs meaningfully from the trade/alias name.
 */
export function formatPartySecondaryName(
  tradeName?: string | null,
  legalName?: string | null
): string | null {
  const trade = normalizePartyName(tradeName);
  const legal = normalizePartyName(legalName);
  if (!trade || !legal || trade === legal) return null;
  return legal;
}
