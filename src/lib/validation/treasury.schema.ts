import { z } from "zod";

const optionalPositiveInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? undefined : Number(v)),
  z.number().int().positive().optional()
);

export const treasuryCashOutflowSchema = z.object({
  amountPen: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z
      .number({ message: "Monto de egreso inválido" })
      .positive("El monto debe ser mayor a 0")
  ),
  expenseBucket: z
    .enum(["ROUTE_OPEX", "ADMIN_OPEX", "MERCHANDISE_PAYMENT", "NON_OPEX_OR_CAPEX"])
    .nullable()
    .optional(),
  expenseCategory: z.string().trim().optional().default("GASTO_RUTA"),
  txDate: z.string().trim().optional(),
  description: z.string().optional().default(""),
  accountId: optionalPositiveInt,
  toAccountId: optionalPositiveInt,
  isInternalTransfer: z.boolean().optional().default(false),
  tripId: optionalPositiveInt,
});

export type TreasuryLedgerQuery =
  | {
      ok: true;
      accountId: number | null;
      ledgerOnly: boolean;
      limit: number;
      offset: number;
    }
  | {
      ok: false;
      error: string;
    };

export function parseTreasuryLedgerQuery(
  searchParams: URLSearchParams
): TreasuryLedgerQuery {
  const rawAccountId = searchParams.get("accountId")?.trim() ?? "";
  let accountId: number | null = null;
  if (rawAccountId !== "") {
    if (!/^\d+$/.test(rawAccountId)) {
      return { ok: false, error: "accountId inválido" };
    }
    const parsed = Number(rawAccountId);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return { ok: false, error: "accountId inválido" };
    }
    accountId = parsed;
  }

  const rawLedgerOnly = searchParams.get("ledgerOnly")?.trim().toLowerCase() ?? "";
  const ledgerOnly = rawLedgerOnly === "1" || rawLedgerOnly === "true";

  const defaultLimit = accountId !== null ? 200 : 150;
  const rawLimit = searchParams.get("limit")?.trim() ?? "";
  const parsedLimit = rawLimit !== "" ? Number(rawLimit) : Number.NaN;
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(500, Math.max(1, Math.trunc(parsedLimit)))
    : defaultLimit;

  const rawOffset = searchParams.get("offset")?.trim() ?? "";
  const parsedOffset = rawOffset !== "" ? Number(rawOffset) : Number.NaN;
  const offset = Number.isFinite(parsedOffset)
    ? Math.max(0, Math.trunc(parsedOffset))
    : 0;

  return { ok: true, accountId, ledgerOnly, limit, offset };
}
