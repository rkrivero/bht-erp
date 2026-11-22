import { z } from "zod";

const positiveInt = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z.number({ message: "ID inválido" }).int("ID inválido").positive("ID inválido")
);

const optionalNum = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().finite().optional()
);

const triStateNum = z.preprocess(
  (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v)),
  z.number().finite().nullable().optional()
);

export const resetNegativeStockSchema = z.object({
  action: z.literal("reset_negative_stock"),
});

export const updateProductPartnerSchema = z.object({
  action: z.literal("update_product"),
  productId: positiveInt,
  physicalStock: optionalNum,
  refCostPen: optionalNum,
  listSalePricePen: optionalNum,
  minSalePricePen: optionalNum,
  fulfillmentMode: z.enum(["STOCKED", "ON_DEMAND"]).optional(),
  minStockQty: triStateNum,
  leadTimeDays: triStateNum,
  defaultSupplierPartyId: triStateNum,
});

export const createUserPartnerSchema = z.object({
  action: z.literal("create_user"),
  username: z.string(),
  fullName: z.string(),
  email: z.string(),
  role: z.string(),
});

export const updateUserNamePartnerSchema = z.object({
  action: z.literal("update_user_name"),
  userId: positiveInt,
  fullName: z.string(),
});

export const updateUserEmailPartnerSchema = z.object({
  action: z.literal("update_user_email"),
  userId: positiveInt,
  email: z.string(),
});

export const updateUserRolePartnerSchema = z.object({
  action: z.literal("update_user_role"),
  userId: positiveInt,
  role: z.string(),
});

export const toggleUserActivePartnerSchema = z.object({
  action: z.literal("toggle_user_active"),
  userId: positiveInt,
  isActive: z.boolean().optional(),
});

export const deleteUserPartnerSchema = z.object({
  action: z.literal("delete_user"),
  userId: positiveInt,
});

export const partnersMutationSchema = z.discriminatedUnion("action", [
  resetNegativeStockSchema,
  updateProductPartnerSchema,
  createUserPartnerSchema,
  updateUserNamePartnerSchema,
  updateUserEmailPartnerSchema,
  updateUserRolePartnerSchema,
  toggleUserActivePartnerSchema,
  deleteUserPartnerSchema,
]);
