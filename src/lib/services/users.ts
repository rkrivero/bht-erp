import type { PoolClient } from "pg";
import { assertRole } from "../rbac";
import { type SessionUser, type UserRole, ValidationError } from "../types";

const USER_ROLES: UserRole[] = [
  "PARTNER_ADMIN",
  "PARTNER_MANAGER",
  "EXTERNAL_SELLER",
  "WAREHOUSE_DELIVERY",
];

export type UserAccessSnapshot = {
  user_id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  is_active: boolean;
  deleted?: boolean;
};

function parseUserRole(value: unknown): UserRole {
  const role = String(value || "") as UserRole;
  if (!USER_ROLES.includes(role)) {
    throw new ValidationError("Selecciona un rol de usuario válido");
  }
  return role;
}

function normalizeUsername(value: unknown): string {
  const username = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new ValidationError(
      "El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo"
    );
  }
  return username;
}

function normalizeFullName(value: unknown): string {
  const fullName = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (fullName.length < 2 || fullName.length > 60) {
    throw new ValidationError("El nombre visible debe tener entre 2 y 60 caracteres");
  }
  return fullName;
}

function normalizeRequiredEmail(value: unknown): string {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ValidationError("Ingresa un correo electrónico válido");
  }
  return email;
}

function toUserSnapshot(row: Record<string, unknown>): UserAccessSnapshot {
  return {
    user_id: Number(row.user_id),
    username: String(row.username),
    full_name: String(row.full_name),
    email: row.email ? String(row.email) : null,
    role: String(row.role) as UserRole,
    is_active: Boolean(row.is_active),
  };
}

async function lockActiveUser(
  client: PoolClient,
  targetUserId: number
): Promise<UserAccessSnapshot> {
  const res = await client.query(
    `SELECT user_id, username, full_name, email, role::text AS role, is_active
     FROM erp.app_users
     WHERE user_id = $1
       AND username NOT LIKE '%\\_\\_deleted\\_%' ESCAPE '\\'
     FOR UPDATE`,
    [targetUserId]
  );
  if (res.rowCount === 0) {
    throw new ValidationError("Usuario no encontrado");
  }
  return toUserSnapshot(res.rows[0]);
}

async function assertAtLeastOneActiveAdminRemains(client: PoolClient): Promise<void> {
  const admins = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM erp.app_users
     WHERE role = 'PARTNER_ADMIN' AND is_active = TRUE`
  );
  if (Number(admins.rows[0]?.count ?? 0) <= 1) {
    throw new ValidationError("Debe permanecer al menos un administrador activo");
  }
}

async function assertEmailAvailable(
  client: PoolClient,
  email: string,
  excludeUserId?: number
): Promise<void> {
  const dupEmail = await client.query(
    `SELECT 1 FROM erp.app_users
     WHERE LOWER(BTRIM(email)) = LOWER(BTRIM($1))
       AND ($2::bigint IS NULL OR user_id <> $2)
       AND username NOT LIKE '%\\_\\_deleted\\_%' ESCAPE '\\'
     LIMIT 1`,
    [email, excludeUserId ?? null]
  );
  if ((dupEmail.rowCount ?? 0) > 0) {
    throw new ValidationError("Ya existe otro usuario activo con ese correo electrónico");
  }
}

async function recordUserAccessAudit(
  client: PoolClient,
  actorUserId: number,
  action: string,
  before: UserAccessSnapshot | null,
  after: UserAccessSnapshot
): Promise<void> {
  await client.query(
    `INSERT INTO erp.user_access_audit_log
       (target_user_id, actor_user_id, action, before_data, after_data)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      after.user_id,
      actorUserId,
      action,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
    ]
  );
}

export async function createErpUser(
  client: PoolClient,
  actor: SessionUser,
  input: { username: unknown; fullName: unknown; email: unknown; role: unknown }
): Promise<{ ok: true; user: UserAccessSnapshot }> {
  assertRole(actor, ["PARTNER_ADMIN"]);
  const username = normalizeUsername(input.username);
  const fullName = normalizeFullName(input.fullName);
  const email = normalizeRequiredEmail(input.email);
  const role = parseUserRole(input.role);

  await assertEmailAvailable(client, email);

  const createdRes = await client.query(
    `WITH generated AS (
       SELECT encode(sha256(gen_random_uuid()::text::bytea), 'hex') AS legacy_hash
     )
     INSERT INTO erp.app_users
       (username, full_name, email, role, password_hash,
        must_change_password, is_active)
     SELECT $1, $2, $3, $4::erp.user_role, legacy_hash, FALSE, TRUE
     FROM generated
     RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
    [username, fullName, email, role]
  );
  const created = toUserSnapshot(createdRes.rows[0]);
  await recordUserAccessAudit(client, actor.userId, "USER_CREATED", null, created);
  return { ok: true, user: created };
}

export async function updateErpUserName(
  client: PoolClient,
  actor: SessionUser,
  input: { userId: number; fullName: unknown }
): Promise<{ ok: true; user: UserAccessSnapshot }> {
  assertRole(actor, ["PARTNER_ADMIN"]);
  const targetUserId = Number(input.userId);
  const fullName = normalizeFullName(input.fullName);
  const before = await lockActiveUser(client, targetUserId);

  const updRes = await client.query(
    `UPDATE erp.app_users
     SET full_name = $1
     WHERE user_id = $2
     RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
    [fullName, targetUserId]
  );
  const after = toUserSnapshot(updRes.rows[0]);
  await recordUserAccessAudit(client, actor.userId, "USER_NAME_CHANGED", before, after);
  return { ok: true, user: after };
}

export async function updateErpUserEmail(
  client: PoolClient,
  actor: SessionUser,
  input: { userId: number; email: unknown }
): Promise<{ ok: true; user: UserAccessSnapshot }> {
  assertRole(actor, ["PARTNER_ADMIN"]);
  const targetUserId = Number(input.userId);
  const email = normalizeRequiredEmail(input.email);
  const before = await lockActiveUser(client, targetUserId);

  await assertEmailAvailable(client, email, targetUserId);

  const updRes = await client.query(
    `UPDATE erp.app_users
     SET neon_auth_user_id = CASE
           WHEN LOWER(BTRIM(COALESCE(email, ''))) = LOWER(BTRIM(COALESCE($1, '')))
             THEN neon_auth_user_id
           ELSE NULL
         END,
         email = $1
     WHERE user_id = $2
     RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
    [email, targetUserId]
  );
  const after = toUserSnapshot(updRes.rows[0]);
  await recordUserAccessAudit(client, actor.userId, "USER_EMAIL_CHANGED", before, after);
  return { ok: true, user: after };
}

export async function updateErpUserRole(
  client: PoolClient,
  actor: SessionUser,
  input: { userId: number; role: unknown }
): Promise<{ ok: true; user: UserAccessSnapshot }> {
  assertRole(actor, ["PARTNER_ADMIN"]);
  const targetUserId = Number(input.userId);
  if (targetUserId === actor.userId) {
    throw new ValidationError("No puedes cambiar el rol de tu propia cuenta");
  }
  const role = parseUserRole(input.role);
  const before = await lockActiveUser(client, targetUserId);
  if (before.role === "PARTNER_ADMIN" && role !== "PARTNER_ADMIN" && before.is_active) {
    await assertAtLeastOneActiveAdminRemains(client);
  }
  const updRes = await client.query(
    `UPDATE erp.app_users
     SET role = $1::erp.user_role
     WHERE user_id = $2
     RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
    [role, targetUserId]
  );
  const after = toUserSnapshot(updRes.rows[0]);
  await recordUserAccessAudit(client, actor.userId, "USER_ROLE_CHANGED", before, after);
  return { ok: true, user: after };
}

export async function toggleErpUserActive(
  client: PoolClient,
  actor: SessionUser,
  input: { userId: number; isActive?: boolean }
): Promise<{ ok: true; user: UserAccessSnapshot }> {
  assertRole(actor, ["PARTNER_ADMIN"]);
  const targetUserId = Number(input.userId);
  if (targetUserId === actor.userId) {
    throw new ValidationError("No puedes desactivar tu propia cuenta de usuario");
  }
  const before = await lockActiveUser(client, targetUserId);
  const nextActive =
    typeof input.isActive === "boolean" ? input.isActive : !before.is_active;
  if (before.role === "PARTNER_ADMIN" && before.is_active && !nextActive) {
    await assertAtLeastOneActiveAdminRemains(client);
  }
  const updRes = await client.query(
    `UPDATE erp.app_users
     SET is_active = $1
     WHERE user_id = $2
     RETURNING user_id, username, full_name, email, role::text AS role, is_active`,
    [nextActive, targetUserId]
  );
  const after = toUserSnapshot(updRes.rows[0]);
  await recordUserAccessAudit(
    client,
    actor.userId,
    nextActive ? "USER_ACTIVATED" : "USER_DEACTIVATED",
    before,
    after
  );
  return { ok: true, user: after };
}

export async function deleteErpUser(
  client: PoolClient,
  actor: SessionUser,
  input: { userId: number }
): Promise<{ ok: true; deletedUserId: number }> {
  assertRole(actor, ["PARTNER_ADMIN"]);
  const targetUserId = Number(input.userId);
  if (targetUserId === actor.userId) {
    throw new ValidationError("No puedes eliminar tu propia cuenta de usuario");
  }
  const before = await lockActiveUser(client, targetUserId);
  if (before.role === "PARTNER_ADMIN" && before.is_active) {
    await assertAtLeastOneActiveAdminRemains(client);
  }
  await client.query(
    `UPDATE erp.app_users
     SET is_active = FALSE,
         email = NULL,
         neon_auth_user_id = NULL,
         username = username || '__deleted_' || user_id::text
     WHERE user_id = $1`,
    [targetUserId]
  );
  await recordUserAccessAudit(client, actor.userId, "USER_DEACTIVATED", before, {
    ...before,
    email: null,
    is_active: false,
    deleted: true,
  });
  return { ok: true, deletedUserId: targetUserId };
}
