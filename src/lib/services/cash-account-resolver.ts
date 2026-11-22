import type { PoolClient } from "pg";
import { AuthorizationError, ValidationError, type SessionUser } from "../types";

export const INACTIVE_ACCOUNT_FALLBACK_CODES: Readonly<Record<string, string>> = {
  YAPE_PLIN_BHT: "BCP_BHT",
  CAJA_GENERAL: "CAJA_RUTA",
};

export interface ResolvedCashAccount {
  accountId: number;
  code: string;
  name: string;
  accountType: string;
}

export async function resolveActiveCashAccount(
  client: PoolClient,
  actor: SessionUser,
  explicitAccountId?: number
): Promise<ResolvedCashAccount> {
  const targetId = explicitAccountId || actor.defaultCashAccountId || null;

  if (targetId) {
    const res = await client.query<{
      account_id: number;
      code: string;
      name: string;
      account_type: string;
      is_active: boolean;
    }>(
      `SELECT account_id, code, name, account_type, is_active
       FROM erp.cash_accounts
       WHERE account_id = $1
       LIMIT 1`,
      [targetId]
    );

    if (res.rowCount === 0) {
      throw new ValidationError("Cuenta de caja inválida o inactiva");
    }

    let row = res.rows[0];
    if (!row.is_active) {
      const fallbackCode = INACTIVE_ACCOUNT_FALLBACK_CODES[String(row.code)];
      if (!fallbackCode) {
        throw new ValidationError("Cuenta de caja inválida o inactiva");
      }
      console.warn(
        `[cash-account-resolver] Fallback de cuenta inactiva ${row.code} (id=${row.account_id}) -> ${fallbackCode}`
      );
      const fallbackRes = await client.query<{
        account_id: number;
        code: string;
        name: string;
        account_type: string;
        is_active: boolean;
      }>(
        `SELECT account_id, code, name, account_type, is_active
         FROM erp.cash_accounts
         WHERE code = $1 AND is_active = TRUE
         LIMIT 1`,
        [fallbackCode]
      );
      if (fallbackRes.rowCount === 0) {
        throw new ValidationError("Cuenta de caja inválida o inactiva");
      }
      row = fallbackRes.rows[0];
    }

    if (actor.role === "EXTERNAL_SELLER" && row.account_type === "PARTNER_CUSTODY") {
      throw new AuthorizationError(
        "El Vendedor Externo no puede operar sobre cuentas de custodia de socio"
      );
    }

    return {
      accountId: Number(row.account_id),
      code: String(row.code),
      name: String(row.name),
      accountType: String(row.account_type),
    };
  }

  const defaultRes = await client.query<{
    account_id: number;
    code: string;
    name: string;
    account_type: string;
  }>(
    `SELECT account_id, code, name, account_type
     FROM erp.cash_accounts
     WHERE code = 'CAJA_RUTA' AND is_active = TRUE
     LIMIT 1`
  );
  if (defaultRes.rowCount === 0) {
    throw new ValidationError("Cuenta de caja por defecto no encontrada");
  }
  const def = defaultRes.rows[0];
  return {
    accountId: Number(def.account_id),
    code: String(def.code),
    name: String(def.name),
    accountType: String(def.account_type),
  };
}
