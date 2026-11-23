import crypto from "crypto";
import type { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import { ConflictError, ValidationError, type SessionUser } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

export function hashMutationRequest(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

export async function runIdempotentMutation<T>(
  client: PoolClient,
  req: NextRequest,
  actor: SessionUser,
  mutationType: string,
  body: unknown,
  execute: () => Promise<T>
): Promise<T> {
  const mutationId = req.headers.get("idempotency-key")?.trim();
  if (!mutationId) return execute();
  if (!UUID_RE.test(mutationId)) {
    throw new ValidationError("Idempotency-Key debe ser un UUID válido");
  }

  const expectedActor = req.headers.get("x-bht-offline-actor")?.trim();
  if (expectedActor && expectedActor !== actor.username) {
    throw new ConflictError(
      "La operación pendiente pertenece a otro usuario; inicia sesión con la cuenta correcta",
      "OFFLINE_ACTOR_MISMATCH",
      mutationId
    );
  }

  const requestHash = hashMutationRequest(body);
  const inserted = await client.query(
    `INSERT INTO erp.client_mutations
       (mutation_id, actor_user_id, mutation_type, request_hash, status, result_json, applied_at)
     VALUES ($1::uuid, $2, $3, $4, 'APPLIED', '{}'::jsonb, NULL)
     ON CONFLICT (mutation_id) DO NOTHING
     RETURNING mutation_id`,
    [mutationId, actor.userId, mutationType, requestHash]
  );

  if (inserted.rowCount === 0) {
    const existing = await client.query<{
      actor_user_id: number;
      mutation_type: string;
      request_hash: string;
      status: string;
      result_json: T;
      applied_at: string | Date | null;
    }>(
      `SELECT actor_user_id, mutation_type, request_hash, status, result_json, applied_at
       FROM erp.client_mutations
       WHERE mutation_id = $1::uuid
       FOR UPDATE`,
      [mutationId]
    );
    const row = existing.rows[0];
    if (!row) {
      throw new ConflictError(
        "No se pudo recuperar la operación pendiente",
        "MUTATION_NOT_FOUND",
        mutationId
      );
    }
    if (
      Number(row.actor_user_id) !== actor.userId ||
      row.mutation_type !== mutationType ||
      row.request_hash !== requestHash
    ) {
      throw new ConflictError(
        "La clave de idempotencia ya fue usada con una operación diferente",
        "IDEMPOTENCY_KEY_REUSED",
        mutationId
      );
    }
    if (row.status !== "APPLIED" || row.applied_at === null) {
      throw new ConflictError(
        "La operación requiere revisión antes de reintentarse",
        "MUTATION_REVIEW_REQUIRED",
        mutationId
      );
    }
    return row.result_json;
  }

  const result = await execute();
  await client.query(
    `UPDATE erp.client_mutations
     SET result_json = $2::jsonb, applied_at = NOW()
     WHERE mutation_id = $1::uuid`,
    [mutationId, JSON.stringify(result ?? {})]
  );
  return result;
}
