import { z } from "zod";

export const createSupplierDirectorySchema = z.object({
  tradeName: z.string().nullable().optional(),
  legalName: z.string().nullable().optional(),
  docType: z.string().nullable().optional(),
  docNumber: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  cityZone: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const updateSupplierDirectorySchema = z.object({
  partyId: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "ID de proveedor debe ser un entero positivo" })
      .int("ID de proveedor debe ser un entero positivo")
      .positive("ID de proveedor debe ser un entero positivo")
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
});
