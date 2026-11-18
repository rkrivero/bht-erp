"use client";

import { useEffect, useMemo, useState } from "react";
import { EditIcon, PlusIcon, TrashIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { formatRoleEs } from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { AppUserItem, CurrentUserInfo, UserAccessAuditItem } from "./types";

const ROLE_OPTIONS = [
  {
    value: "PARTNER_ADMIN",
    label: "Administrador",
    description: "Control total, usuarios, ventas, caja e inventario.",
  },
  {
    value: "PARTNER_MANAGER",
    label: "Gerencia",
    description:
      "Operación, compras, caja, reportes e inventario; sin administrar accesos.",
  },
  {
    value: "EXTERNAL_SELLER",
    label: "Vendedor",
    description: "Clientes, cotizaciones, pedidos y cobranza de su operación.",
  },
  {
    value: "WAREHOUSE_DELIVERY",
    label: "Almacén y reparto",
    description: "Alistamiento, rutas, entrega y confirmaciones operativas.",
  },
] as const;

type RoleValue = (typeof ROLE_OPTIONS)[number]["value"];

interface UserManagementPanelProps {
  currentUser: CurrentUserInfo;
  users: AppUserItem[];
  userAccessHistory: UserAccessAuditItem[];
  onRefresh: () => Promise<void>;
  onFeedback: (message: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
}

function roleDescription(role: string): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.description ?? "";
}

function auditActionLabel(action: string, afterData?: Record<string, unknown>): string {
  if (action === "USER_DEACTIVATED" && afterData?.deleted === true) {
    return "eliminó la cuenta";
  }
  const labels: Record<string, string> = {
    USER_CREATED: "creó la cuenta",
    USER_NAME_CHANGED: "actualizó el nombre",
    USER_EMAIL_CHANGED: "cambió el correo de acceso",
    USER_ROLE_CHANGED: "cambió el rol",
    USER_ACTIVATED: "activó la cuenta",
    USER_DEACTIVATED: "desactivó la cuenta",
  };
  return labels[action] ?? "actualizó el acceso";
}

const CREATE_TEXT_FIELDS = [
  {
    key: "fullName",
    id: "new-user-name",
    label: "Nombre completo",
    type: "text",
    minLength: 2,
    maxLength: 60,
    autoComplete: "name",
    placeholder: "Ej. María López",
    lowercase: false,
  },
  {
    key: "username",
    id: "new-user-username",
    label: "Usuario interno",
    type: "text",
    minLength: 3,
    maxLength: 32,
    autoComplete: "off",
    placeholder: "Ej. maria.lopez",
    hint: "Se usa en auditorías y responsables; no es la contraseña.",
    lowercase: true,
  },
  {
    key: "email",
    id: "new-user-email",
    label: "Correo autorizado",
    type: "email",
    maxLength: 254,
    autoComplete: "email",
    placeholder: "persona@empresa.com",
    lowercase: true,
  },
] as const;

function RoleSelect({
  id,
  value,
  disabled,
  onChange,
  className = "w-full",
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (role: RoleValue) => void;
  className?: string;
}) {
  return (
    <>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as RoleValue)}
        className={`${INPUT_CLASS} min-h-11 ${className}`}
      >
        {ROLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs leading-4 text-bht-ink-muted">
        {roleDescription(value)}
      </p>
    </>
  );
}

function ModalFooter({
  busy,
  onCancel,
  confirmLabel,
  busyLabel,
  confirmVariant = "primary",
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  confirmLabel: string;
  busyLabel: string;
  confirmVariant?: "primary" | "danger";
  onConfirm?: () => void;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
        Cancelar
      </Button>
      <Button
        type={onConfirm ? "button" : "submit"}
        variant={confirmVariant}
        disabled={busy}
        onClick={onConfirm}
      >
        {busy ? busyLabel : confirmLabel}
      </Button>
    </div>
  );
}

function formatAuditDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(date);
}

export default function UserManagementPanel({
  currentUser,
  users,
  userAccessHistory,
  onRefresh,
  onFeedback,
  onEditingChange,
}: UserManagementPanelProps) {
  const isAdmin = currentUser.role === "PARTNER_ADMIN";
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    fullName: "",
    username: "",
    email: "",
    role: "EXTERNAL_SELLER" as RoleValue,
  });
  const [editingField, setEditingField] = useState<{
    userId: number;
    kind: "name" | "email";
    value: string;
  } | null>(null);
  const [busyUserActionId, setBusyUserActionId] = useState<number | "create" | null>(
    null
  );
  const [confirmUserAction, setConfirmUserAction] = useState<{
    kind: "deactivate" | "delete";
    user: AppUserItem;
  } | null>(null);
  const [roleModalUser, setRoleModalUser] = useState<{
    user: AppUserItem;
    role: RoleValue;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">(
    "ALL"
  );

  const editing =
    createOpen ||
    editingField !== null ||
    confirmUserAction !== null ||
    roleModalUser !== null;

  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);

  const sortedUsers = useMemo(
    () =>
      [...users].sort(
        (a, b) =>
          Number(b.is_active) - Number(a.is_active) ||
          a.full_name.localeCompare(b.full_name, "es")
      ),
    [users]
  );

  const activeCount = useMemo(() => users.filter((u) => u.is_active).length, [users]);
  const inactiveCount = users.length - activeCount;
  const filteredUsers = useMemo(() => {
    if (statusFilter === "ACTIVE") return sortedUsers.filter((u) => u.is_active);
    if (statusFilter === "INACTIVE") return sortedUsers.filter((u) => !u.is_active);
    return sortedUsers;
  }, [sortedUsers, statusFilter]);

  async function postUserAction(payload: Record<string, unknown>) {
    const response = await fetch("/api/partners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo actualizar el acceso");
    notifyLocalSync(["partners"]);
    await onRefresh();
    return data;
  }

  async function runUserMutation(
    actionKey: number | "create",
    payload: Record<string, unknown>,
    successMessage: string,
    fallbackMessage: string,
    onSuccess?: () => void
  ) {
    if (busyUserActionId !== null) return;
    setBusyUserActionId(actionKey);
    try {
      await postUserAction(payload);
      onFeedback(successMessage);
      onSuccess?.();
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : fallbackMessage, true);
    } finally {
      setBusyUserActionId(null);
    }
  }

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runUserMutation(
      "create",
      { action: "create_user", ...createForm },
      "Usuario creado. La persona ya puede crear su contraseña con el correo autorizado.",
      "No se pudo crear el usuario",
      () => {
        setCreateOpen(false);
        setCreateForm({
          fullName: "",
          username: "",
          email: "",
          role: "EXTERNAL_SELLER",
        });
      }
    );
  }

  async function handleSaveEditingField(user: AppUserItem) {
    if (!editingField || editingField.userId !== user.user_id) return;
    if (editingField.kind === "name") {
      await runUserMutation(
        user.user_id,
        {
          action: "update_user_name",
          userId: user.user_id,
          fullName: editingField.value,
        },
        `Nombre actualizado para @${user.username}.`,
        "No se pudo actualizar el nombre",
        () => setEditingField(null)
      );
      return;
    }
    await runUserMutation(
      user.user_id,
      { action: "update_user_email", userId: user.user_id, email: editingField.value },
      "Correo actualizado. La persona deberá verificar ese correo para volver a ingresar.",
      "No se pudo actualizar el correo",
      () => setEditingField(null)
    );
  }

  async function submitRoleChange(
    user: AppUserItem,
    role: RoleValue,
    onDone: () => void
  ) {
    await runUserMutation(
      user.user_id,
      { action: "update_user_role", userId: user.user_id, role },
      `Rol de ${user.full_name} actualizado a ${formatRoleEs(role)}.`,
      "No se pudo cambiar el rol",
      onDone
    );
  }

  async function handleToggleUserActive(user: AppUserItem) {
    await runUserMutation(
      user.user_id,
      { action: "toggle_user_active", userId: user.user_id, isActive: !user.is_active },
      `Usuario ${user.username} ${user.is_active ? "desactivado" : "activado"}.`,
      "No se pudo cambiar el estado",
      () => setConfirmUserAction(null)
    );
  }

  async function handleDeleteUser(user: AppUserItem) {
    await runUserMutation(
      user.user_id,
      { action: "delete_user", userId: user.user_id },
      "Usuario eliminado. Su correo y usuario quedaron liberados.",
      "No se pudo eliminar el usuario",
      () => setConfirmUserAction(null)
    );
  }

  return (
    <>
      <Card accent="horizon" padding="md" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Badge tone="horizon">Equipo y seguridad</Badge>
            <h2 className="mt-2 text-base font-semibold text-bht-ink-strong">
              Usuarios y permisos ({users.length})
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-bht-ink-soft">
              Neon Auth protege correo y contraseña. Aquí defines quién está autorizado,
              qué puede hacer y si su acceso continúa activo.
            </p>
          </div>
          {isAdmin && (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => setCreateOpen(true)}
            >
              <PlusIcon className="h-4 w-4" />
              Crear usuario
            </Button>
          )}
        </div>

        {!isAdmin && (
          <div
            role="status"
            className="rounded-lg border border-bht-line bg-bht-paper p-3 text-xs text-bht-ink-soft"
          >
            Puedes consultar el equipo. Solo un administrador puede cambiar accesos y
            roles.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl<"ALL" | "ACTIVE" | "INACTIVE">
            ariaLabel="Filtrar usuarios por estado"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { id: "ALL", label: "Todos", count: users.length },
              { id: "ACTIVE", label: "Activos", count: activeCount },
              { id: "INACTIVE", label: "De baja", count: inactiveCount },
            ]}
          />
        </div>

        <div className="space-y-2.5">
          {filteredUsers.length === 0 ? (
            <div className="rounded-xl border border-bht-line bg-bht-paper p-4 text-center text-xs text-bht-ink-muted">
              No hay usuarios en este estado.
            </div>
          ) : (
            filteredUsers.map((user) => {
              const isSelf = user.user_id === currentUser.userId;
              const isEditingName =
                editingField?.userId === user.user_id && editingField.kind === "name";
              const isEditingEmail =
                editingField?.userId === user.user_id && editingField.kind === "email";
              const isBusy = busyUserActionId !== null;
              return (
                <article
                  key={user.user_id}
                  className={`rounded-xl border p-3.5 ${
                    user.is_active
                      ? "border-bht-line bg-white"
                      : "border-bht-line bg-bht-paper"
                  }`}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-bht-ink-strong">
                          {user.full_name}
                        </span>
                        <Badge tone="neutral">@{user.username}</Badge>
                        <Badge tone={user.is_active ? "success" : "danger"}>
                          {user.is_active ? "Activo" : "De baja"}
                        </Badge>
                        {isSelf && <Badge tone="neutral">Tu cuenta</Badge>}
                      </div>
                      <p className="mt-1.5 break-all text-xs text-bht-ink-soft">
                        {user.email || "Sin correo autorizado"}
                      </p>
                    </div>

                    <div className="flex w-full flex-col gap-1 lg:w-auto lg:min-w-[280px]">
                      <label
                        className="mb-1 text-xs font-semibold text-bht-ink-soft"
                        htmlFor={`role-${user.user_id}`}
                      >
                        Cargo / Rol asignado
                      </label>
                      <RoleSelect
                        id={`role-${user.user_id}`}
                        value={user.role}
                        disabled={!isAdmin || isSelf || isBusy}
                        onChange={(role) => setRoleModalUser({ user, role })}
                      />
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-bht-tone-eeece7 pt-3">
                      <Button
                        type="button"
                        variant={isEditingName ? "secondary" : "outline"}
                        size="sm"
                        disabled={isBusy}
                        aria-expanded={isEditingName}
                        onClick={() =>
                          setEditingField(
                            isEditingName
                              ? null
                              : {
                                  userId: user.user_id,
                                  kind: "name",
                                  value: user.full_name,
                                }
                          )
                        }
                      >
                        <EditIcon className="h-3.5 w-3.5" />
                        Editar nombre
                      </Button>
                      <Button
                        type="button"
                        variant={isEditingEmail ? "secondary" : "outline"}
                        size="sm"
                        disabled={isBusy}
                        aria-expanded={isEditingEmail}
                        onClick={() =>
                          setEditingField(
                            isEditingEmail
                              ? null
                              : {
                                  userId: user.user_id,
                                  kind: "email",
                                  value: user.email || "",
                                }
                          )
                        }
                      >
                        <EditIcon className="h-3.5 w-3.5" />
                        Editar correo
                      </Button>
                      {!isSelf && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() =>
                              setRoleModalUser({
                                user,
                                role: (ROLE_OPTIONS.some(
                                  (option) => option.value === user.role
                                )
                                  ? user.role
                                  : "EXTERNAL_SELLER") as RoleValue,
                              })
                            }
                          >
                            Cambiar rol
                          </Button>
                          <Button
                            type="button"
                            variant={user.is_active ? "outline" : "success"}
                            size="sm"
                            disabled={isBusy}
                            onClick={() =>
                              user.is_active
                                ? setConfirmUserAction({ kind: "deactivate", user })
                                : void handleToggleUserActive(user)
                            }
                          >
                            {user.is_active ? "Desactivar" : "Reactivar acceso"}
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            disabled={isBusy}
                            onClick={() =>
                              setConfirmUserAction({ kind: "delete", user })
                            }
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                            Eliminar
                          </Button>
                        </>
                      )}
                    </div>
                  )}

                  {editingField?.userId === user.user_id && (
                    <form
                      className="mt-3 flex flex-col gap-2 border-t border-bht-tone-eeece7 pt-3 sm:flex-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleSaveEditingField(user);
                      }}
                    >
                      <input
                        required
                        type={editingField.kind === "email" ? "email" : "text"}
                        minLength={editingField.kind === "name" ? 2 : undefined}
                        maxLength={editingField.kind === "email" ? 254 : 60}
                        value={editingField.value}
                        onChange={(event) =>
                          setEditingField((prev) =>
                            prev ? { ...prev, value: event.target.value } : null
                          )
                        }
                        aria-label={
                          editingField.kind === "email"
                            ? `Correo de acceso para ${user.username}`
                            : `Nombre visible para ${user.username}`
                        }
                        className={`${INPUT_CLASS} min-h-11 flex-1`}
                      />
                      <Button type="submit" variant="primary" disabled={isBusy}>
                        {editingField.kind === "email"
                          ? "Guardar correo"
                          : "Guardar nombre"}
                      </Button>
                    </form>
                  )}
                </article>
              );
            })
          )}
        </div>

        <details className="rounded-xl border border-bht-line bg-bht-paper p-3.5">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-bht-ink-strong">
            Historial de cambios de acceso ({userAccessHistory.length})
          </summary>
          <div className="mt-2 space-y-2 border-t border-bht-line pt-3">
            {userAccessHistory.length === 0 ? (
              <p className="text-xs text-bht-ink-muted">
                Todavía no hay cambios registrados.
              </p>
            ) : (
              userAccessHistory.map((entry) => (
                <div
                  key={entry.audit_id}
                  className="rounded-lg bg-white p-3 text-xs text-bht-ink-soft"
                >
                  <p>
                    <strong className="text-bht-ink-strong">{entry.actor_name}</strong>{" "}
                    {auditActionLabel(entry.action, entry.after_data)} de{" "}
                    <strong className="text-bht-ink-strong">{entry.target_name}</strong>
                    .
                  </p>
                  <p className="mt-1 text-xs text-bht-ink-muted">
                    {formatAuditDate(entry.created_at)}
                  </p>
                </div>
              ))
            )}
          </div>
        </details>
      </Card>

      <ModalSheet
        open={createOpen}
        onClose={() => busyUserActionId === null && setCreateOpen(false)}
        title="Crear usuario"
        subtitle="Autoriza primero su correo y define exactamente qué podrá hacer"
      >
        <form className="space-y-4" onSubmit={handleCreateUser}>
          {CREATE_TEXT_FIELDS.map((field) => (
            <div key={field.key}>
              <FieldLabel htmlFor={field.id} required>
                {field.label}
              </FieldLabel>
              <input
                id={field.id}
                required
                type={field.type}
                minLength={"minLength" in field ? field.minLength : undefined}
                maxLength={field.maxLength}
                autoCapitalize={field.lowercase ? "none" : undefined}
                autoComplete={field.autoComplete}
                value={createForm[field.key]}
                onChange={(event) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    [field.key]: field.lowercase
                      ? event.target.value.toLowerCase()
                      : event.target.value,
                  }))
                }
                className={`${INPUT_CLASS} mt-1.5 min-h-11 w-full`}
                placeholder={field.placeholder}
              />
              {"hint" in field && (
                <p className="mt-1 text-xs text-bht-ink-muted">{field.hint}</p>
              )}
            </div>
          ))}
          <div>
            <FieldLabel htmlFor="new-user-role" required>
              Rol
            </FieldLabel>
            <RoleSelect
              id="new-user-role"
              value={createForm.role}
              onChange={(role) => setCreateForm((prev) => ({ ...prev, role }))}
              className="mt-1.5 w-full"
            />
          </div>
          <div className="rounded-lg border border-bht-tone-cfe0f0 bg-bht-tone-f2f7fb p-3 text-xs leading-5 text-bht-navy-mid">
            No se envía una contraseña. La persona usará “Crear cuenta” con este mismo
            correo y Neon Auth verificará su identidad.
          </div>
          <ModalFooter
            busy={busyUserActionId !== null}
            onCancel={() => setCreateOpen(false)}
            confirmLabel="Crear usuario"
            busyLabel="Creando..."
          />
        </form>
      </ModalSheet>

      <ModalSheet
        open={Boolean(roleModalUser)}
        onClose={() => busyUserActionId === null && setRoleModalUser(null)}
        title="Asignar cargo o rol"
        subtitle={roleModalUser?.user.full_name}
      >
        {roleModalUser && (
          <div className="space-y-3 text-sm text-bht-ink-soft">
            <p className="text-xs">
              Actual:{" "}
              <strong className="text-bht-ink-strong">
                {formatRoleEs(roleModalUser.user.role)}
              </strong>{" "}
              → Nuevo:{" "}
              <strong className="text-bht-ink-strong">
                {formatRoleEs(roleModalUser.role)}
              </strong>
            </p>
            <div className="space-y-2" role="radiogroup" aria-label="Roles disponibles">
              {ROLE_OPTIONS.map((option) => {
                const selected = roleModalUser.role === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() =>
                      setRoleModalUser((prev) =>
                        prev ? { ...prev, role: option.value } : null
                      )
                    }
                    className={`w-full rounded-xl border p-3 text-left transition cursor-pointer ${
                      selected
                        ? "border-bht-cobalt bg-bht-cobalt-bg"
                        : "border-bht-line bg-white hover:bg-bht-paper"
                    }`}
                  >
                    <p className="text-xs font-semibold text-bht-ink-strong">
                      {option.label}
                    </p>
                    <p className="mt-0.5 text-xs text-bht-ink-soft">
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
            <ModalFooter
              busy={busyUserActionId !== null}
              onCancel={() => setRoleModalUser(null)}
              confirmLabel="Asignar rol"
              busyLabel="Guardando..."
              onConfirm={() =>
                void submitRoleChange(roleModalUser.user, roleModalUser.role, () =>
                  setRoleModalUser(null)
                )
              }
            />
          </div>
        )}
      </ModalSheet>

      <ModalSheet
        open={Boolean(confirmUserAction)}
        onClose={() => busyUserActionId === null && setConfirmUserAction(null)}
        title={
          confirmUserAction?.kind === "delete"
            ? "Confirmar eliminación de usuario"
            : "Confirmar desactivación"
        }
        subtitle={confirmUserAction?.user.full_name}
      >
        {confirmUserAction && (
          <div className="space-y-4 text-sm text-bht-ink-soft">
            {confirmUserAction.kind === "delete" ? (
              <p>
                Se revocará el acceso y se liberarán el usuario{" "}
                <strong className="text-bht-ink-strong">
                  @{confirmUserAction.user.username}
                </strong>{" "}
                y su correo para poder reutilizarlos, conservando la auditoría
                histórica.
              </p>
            ) : (
              <p>
                La persona perderá acceso inmediatamente. Su historial no se elimina y
                podrás reactivar la cuenta después.
              </p>
            )}
            <ModalFooter
              busy={busyUserActionId !== null}
              onCancel={() => setConfirmUserAction(null)}
              confirmVariant="danger"
              confirmLabel={
                confirmUserAction.kind === "delete" ? "Sí, eliminar" : "Sí, desactivar"
              }
              busyLabel={
                confirmUserAction.kind === "delete"
                  ? "Eliminando..."
                  : "Desactivando..."
              }
              onConfirm={() =>
                void (confirmUserAction.kind === "delete"
                  ? handleDeleteUser(confirmUserAction.user)
                  : handleToggleUserActive(confirmUserAction.user))
              }
            />
          </div>
        )}
      </ModalSheet>
    </>
  );
}
