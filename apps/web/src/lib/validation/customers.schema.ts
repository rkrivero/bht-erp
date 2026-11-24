import { z } from "zod";

const nullableNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number({ message: "Valor numérico inválido" }).finite().nullable().optional()
);

const triStateNum = z.preprocess(
  (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v)),
  z.number({ message: "Valor numérico inválido" }).finite().nullable().optional()
);

export const createCustomerSchema = z.object({
  tradeName: z.string().max(200).nullable().optional(),
  legalName: z.string().max(200).nullable().optional(),
  docType: z.string().max(32).nullable().optional(),
  docNumber: z.string().max(32).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().max(254).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  cityZone: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  geoLat: nullableNum,
  geoLng: nullableNum,
  geoAccuracyM: nullableNum,
  creditDaysAgreed: nullableNum,
  creditLimitPen: nullableNum,
  lastContactDate: z.string().max(32).nullable().optional(),
});

export const updateCustomerSchema = z.object({
  partyId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "ID de cliente debe ser un entero positivo" })
      .int("ID de cliente debe ser un entero positivo")
      .positive("ID de cliente debe ser un entero positivo")
  ),
  tradeName: z.string().max(200).nullable().optional(),
  legalName: z.string().max(200).nullable().optional(),
  docType: z.string().max(32).nullable().optional(),
  docNumber: z.string().max(32).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().max(254).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  cityZone: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
  geoLat: triStateNum,
  geoLng: triStateNum,
  geoAccuracyM: triStateNum,
  creditDaysAgreed: triStateNum,
  creditLimitPen: triStateNum,
  lastContactDate: z.string().max(32).nullable().optional(),
});
