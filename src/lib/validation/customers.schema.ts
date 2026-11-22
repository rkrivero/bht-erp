import { z } from "zod";

const nullableNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
  z.number({ message: "Valor numérico inválido" }).finite().nullable().optional()
);

const triStateNum = z.preprocess(
  (v) =>
    v === undefined
      ? undefined
      : v === "" || v === null
        ? null
        : Number(v),
  z.number({ message: "Valor numérico inválido" }).finite().nullable().optional()
);

export const createCustomerSchema = z.object({
  tradeName: z.string().nullable().optional(),
  legalName: z.string().nullable().optional(),
  docType: z.string().nullable().optional(),
  docNumber: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  cityZone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  geoLat: nullableNum,
  geoLng: nullableNum,
  geoAccuracyM: nullableNum,
  creditDaysAgreed: nullableNum,
  creditLimitPen: nullableNum,
  lastContactDate: z.string().nullable().optional(),
});

export const updateCustomerSchema = z.object({
  partyId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "ID de cliente debe ser un entero positivo" })
      .int("ID de cliente debe ser un entero positivo")
      .positive("ID de cliente debe ser un entero positivo")
  ),
  tradeName: z.string().nullable().optional(),
  legalName: z.string().nullable().optional(),
  docType: z.string().nullable().optional(),
  docNumber: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  cityZone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  geoLat: triStateNum,
  geoLng: triStateNum,
  geoAccuracyM: triStateNum,
  creditDaysAgreed: triStateNum,
  creditLimitPen: triStateNum,
  lastContactDate: z.string().nullable().optional(),
});
