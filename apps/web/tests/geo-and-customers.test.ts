import { describe, expect, it } from "vitest";
import {
  buildGoogleMapsUrl,
  formatPartySecondaryName,
  normalizePartyName,
  normalizeZone,
  parseGeoInput,
} from "../src/lib/geo";
import {
  extractKnownZones,
  filterSellerCustomers,
} from "../src/features/seller/seller-utils";
import type { SellerCustomerDto } from "../src/features/seller/types";

describe("geo utilities & dual-name customer helpers", () => {
  it("parses direct coordinates and Google Maps / OSM URLs", () => {
    expect(parseGeoInput("-12.7123456, -69.5841234")).toEqual({
      lat: -12.712346,
      lng: -69.584123,
    });
    expect(parseGeoInput("-12.5933 -69.1891")).toEqual({
      lat: -12.5933,
      lng: -69.1891,
    });
    expect(parseGeoInput("https://maps.google.com/?q=-12.7123,-69.5841")).toEqual({
      lat: -12.7123,
      lng: -69.5841,
    });
    expect(
      parseGeoInput(
        "https://www.google.com/maps/place/Laberinto/@-12.7100,-69.5800,17z/data=!3m1!1e3!3d-12.71234!4d-69.58412"
      )
    ).toEqual({ lat: -12.71234, lng: -69.58412 });
    expect(
      parseGeoInput("https://www.google.com/maps/@-12.601234,-69.190456,16z")
    ).toEqual({ lat: -12.601234, lng: -69.190456 });
    expect(
      parseGeoInput("https://www.openstreetmap.org/#map=16/-12.5933/-69.1891")
    ).toEqual({ lat: -12.5933, lng: -69.1891 });

    expect(parseGeoInput("95.0, -69.1")).toBeNull();
    expect(parseGeoInput("-12.5, -200.0")).toBeNull();
    expect(parseGeoInput("Laberinto KM 110")).toBeNull();
  });

  it("normalizes zones, names, secondary legal names, and Maps URLs", () => {
    expect(buildGoogleMapsUrl(-12.7123, -69.5841)).toBe(
      "https://www.google.com/maps/search/?api=1&query=-12.7123,-69.5841"
    );
    expect(normalizeZone("  km   110 ")).toBe("KM 110");
    expect(normalizeZone("   ")).toBeNull();
    expect(normalizePartyName(" ferreteria  el   sol ")).toBe("FERRETERIA EL SOL");
    expect(
      formatPartySecondaryName("FERRETERIA EL SOL", "FERRETERIA EL SOL")
    ).toBeNull();
    expect(
      formatPartySecondaryName("FERRETERIA EL SOL", "INVERSIONES SOL S.A.C.")
    ).toBe("INVERSIONES SOL S.A.C.");
  });

  it("matches customers across alias, legal name, legacy aliases, doc, and zone", () => {
    const list: SellerCustomerDto[] = [
      {
        party_id: 1,
        name: "FERRETERÍA EL TIGRE",
        trade_name: "FERRETERÍA EL TIGRE",
        legal_name: "CARLOS MENDOZA RUIZ",
        doc_number: "10445566771",
        city_zone: "LABERINTO",
        phone: "982111222",
        aliases: ["TIENDA DEL TIGRE"],
      },
      {
        party_id: 2,
        name: "JUAN PÉREZ QUISPE",
        trade_name: null,
        legal_name: "JUAN PÉREZ QUISPE",
        doc_number: "44556677",
        city_zone: "KM 110",
        phone: null,
        aliases: [],
      },
    ];

    expect(
      filterSellerCustomers(list, "carlos mendoza").map((c) => c.party_id)
    ).toEqual([1]);
    expect(
      filterSellerCustomers(list, "ferreteria tigre").map((c) => c.party_id)
    ).toEqual([1]);
    expect(filterSellerCustomers(list, "tienda tigre").map((c) => c.party_id)).toEqual([
      1,
    ]);
    expect(filterSellerCustomers(list, "km 110 perez").map((c) => c.party_id)).toEqual([
      2,
    ]);
    expect(extractKnownZones(list)).toEqual(["KM 110", "LABERINTO"]);
  });
});
