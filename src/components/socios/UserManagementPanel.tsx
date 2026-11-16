"use client";

import { useEffect, useMemo, useState } from "react";
import { EditIcon, PlusIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
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

function auditActionLabel(action: string): string {
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
  const [editingNameUserId, setEditingNameUserId] = useState<number | null>(null);
  const [editingEmailUserId, setEditingEmailUserId] = useState<number | null>(null);
  const [newFullNameValue, setNewFullNameValue] = useState("");
  const [newEmailValue, setNewEmailValue] = useState("");
  const [busyUserActionId, setBusyUserActionId] = useState<number | "create" | null>(
    null
  );
  const [confirmToggleUser, setConfirmToggleUser] = useState<AppUserItem | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    user: AppUserItem;
    role: RoleValue;
  } | null>(null);

  const editing =
    createOpen ||
    editingNameUserId !== null ||
    editingEmailUserId !== null ||
    confirmToggleUser !== null ||
    pendingRoleChange !== null;

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

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyUserActionId !== null) return;
    setBusyUserActionId("create");
    try {
      await postUserAction({ action: "create_user", ...createForm });
      onFeedback(
        "Usuario creado. La persona ya puede crear su contraseña con el correo autorizado."
      );
      setCreateOpen(false);
      setCreateForm({ fullName: "", username: "", email: "", role: "EXTERNAL_SELLER" });
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : "No se pudo crear el usuario",
        true
      );
    } finally {
      setBusyUserActionId(null);
    }
  }

  async function handleUpdateName(user: AppUserItem) {
    if (busyUserActionId !== null) return;
    setBusyUserActionId(user.user_id);
    try {
      await postUserAction({
        action: "update_user_name",
        userId: user.user_id,
        fullName: newFullNameValue,
      });
      onFeedback(`Nombre actualizado para @${user.username}.`);
      setEditingNameUserId(null);
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : "No se pudo actualizar el nombre",
        true
      );
    } finally {
      setBusyUserActionId(null);
    }
  }

  async function handleUpdateEmail(user: AppUserItem) {
    if (busyUserActionId !== null) return;
    setBusyUserActionId(user.user_id);
    try {
      await postUserAction({
        action: "update_user_email",
        userId: user.user_id,
        email: newEmailValue,
      });
      onFeedback(
        "Correo actualizado. La persona deberá verificar ese correo para volver a ingresar."
      );
      setEditingEmailUserId(null);
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : "No se pudo actualizar el correo",
        true
      );
    } finally {
      setBusyUserActionId(null);
    }
  }

  async function handleRoleChange() {
    if (!pendingRoleChange || busyUserActionId !== null) return;
    const { user, role } = pendingRoleChange;
    setBusyUserActionId(user.user_id);
    try {
      await postUserAction({ action: "update_user_role", userId: user.user_id, role });
      onFeedback(`Rol de ${user.full_name} actualizado a ${formatRoleEs(role)}.`);
      setPendingRoleChange(null);
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : "No se pudo cambiar el rol",
        true
      );
    } finally {
      setBusyUserActionId(null);
    }
  }

  async function handleToggleUserActive(user: AppUserItem) {
    if (busyUserActionId !== null) return;
    setBusyUserActionId(user.user_id);
    try {
      await postUserAction({
        action: "toggle_user_active",
        userId: user.user_id,
        isActive: !user.is_active,
      });
      onFeedback(
        `Usuario ${user.username} ${user.is_active ? "desactivado" : "activado"}.`
      );
      setConfirmToggleUser(null);
    } catch (error) {
      onFeedback(
        error instanceof Error ? error.message : "No se pudo cambiar el estado",
        true
      );
    } finally {
      setBusyUserActionId(null);
    }
  }

  return (
    <>
      <Card accent="horizon" padding="md" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Badge tone="horizon">Equipo y seguridad</Badge>
            <h2 className="mt-2 text-base font-semibold text-[#18181B]">
              Usuarios y permisos ({users.length})
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[#5C5A55]">
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
            className="rounded-lg border border-[#E7E5E0] bg-[#FAF9F6] p-3 text-xs text-[#5C5A55]"
          >
            Puedes consultar el equipo. Solo un administrador puede cambiar accesos y
            roles.
          </div>
        )}

        <div className="space-y-2.5">
          {sortedUsers.map((user) => {
            const isSelf = user.user_id === currentUser.userId;
            const isEditingName = editingNameUserId === user.user_id;
            const isEditingEmail = editingEmailUserId === user.user_id;
            const isBusy = busyUserActionId !== null;
            return (
              <article
                key={user.user_id}
                className={`rounded-xl border p-3.5 ${
                  user.is_active
                    ? "border-[#E7E5E0] bg-white"
                    : "border-[#E7E5E0] bg-[#FAF9F6]"
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-[#18181B]">
                        {user.full_name}
                      </span>
                      <Badge tone="neutral">@{user.username}</Badge>
                      <Badge tone={user.is_active ? "success" : "danger"}>
                        {user.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                      {isSelf && <Badge tone="neutral">Tu cuenta</Badge>}
                    </div>
                    <p className="mt-1.5 break-all text-xs text-[#5C5A55]">
                      {user.email || "Sin correo autorizado"}
                    </p>
                  </div>

                  <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[280px]">
                    <label
                      className="text-[11px] font-semibold text-[#5C5A55]"
                      htmlFor={`role-${user.user_id}`}
                    >
                      Rol y alcance
                    </label>
                    <select
                      id={`role-${user.user_id}`}
                      value={user.role}
                      disabled={!isAdmin || isSelf || isBusy}
                      onChange={(event) =>
                        setPendingRoleChange({
                          user,
                          role: event.target.value as RoleValue,
                        })
                      }
                      className={`${INPUT_CLASS} min-h-11 w-full`}
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] leading-4 text-[#6D6A64]">
                      {roleDescription(user.role)}
                    </p>
                  </div>
                </div>

                {isAdmin && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-[#EEECE7] pt-3">
                    <Button
                      type="button"
                      variant={isEditingName ? "secondary" : "outline"}
                      size="sm"
                      disabled={isBusy}
                      aria-expanded={isEditingName}
                      onClick={() => {
                        setEditingEmailUserId(null);
                        setEditingNameUserId(isEditingName ? null : user.user_id);
                        setNewFullNameValue(isEditingName ? "" : user.full_name);
                      }}
                    >
                      <EditIcon className="h-3.5 w-3.5" />
                      Nombre
                    </Button>
                    <Button
                      type="button"
                      variant={isEditingEmail ? "secondary" : "outline"}
                      size="sm"
                      disabled={isBusy}
                      aria-expanded={isEditingEmail}
                      onClick={() => {
                        setEditingNameUserId(null);
                        setEditingEmailUserId(isEditingEmail ? null : user.user_id);
                        setNewEmailValue(isEditingEmail ? "" : user.email || "");
                      }}
                    >
                      <EditIcon className="h-3.5 w-3.5" />
                      Correo
                    </Button>
                    {!isSelf && (
                      <Button
                        type="button"
                        variant={user.is_active ? "danger" : "success"}
                        size="sm"
                        disabled={isBusy}
                        onClick={() =>
                          user.is_active
                            ? setConfirmToggleUser(user)
                            : void handleToggleUserActive(user)
                        }
                      >
                        {user.is_active ? "Desactivar" : "Activar"}
                      </Button>
                    )}
                  </div>
                )}

                {isEditingName && (
                  <form
                    className="mt-3 flex flex-col gap-2 border-t border-[#EEECE7] pt-3 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleUpdateName(user);
                    }}
                  >
                    <input
                      required
                      minLength={2}
                      maxLength={60}
                      value={newFullNameValue}
                      onChange={(event) => setNewFullNameValue(event.target.value)}
                      aria-label={`Nombre visible para ${user.username}`}
                      className={`${INPUT_CLASS} min-h-11 flex-1`}
                    />
                    <Button type="submit" variant="primary" disabled={isBusy}>
                      Guardar nombre
                    </Button>
                  </form>
                )}

                {isEditingEmail && (
                  <form
                    className="mt-3 flex flex-col gap-2 border-t border-[#EEECE7] pt-3 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleUpdateEmail(user);
                    }}
                  >
                    <input
                      required
                      type="email"
                      maxLength={254}
                      value={newEmailValue}
                      onChange={(event) => setNewEmailValue(event.target.value)}
                      aria-label={`Correo de acceso para ${user.username}`}
                      className={`${INPUT_CLASS} min-h-11 flex-1`}
                    />
                    <Button type="submit" variant="primary" disabled={isBusy}>
                      Guardar correo
                    </Button>
                  </form>
                )}
              </article>
            );
          })}
        </div>

        <details className="rounded-xl border border-[#E7E5E0] bg-[#FAF9F6] p-3.5">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[#18181B]">
            Historial de cambios de acceso ({userAccessHistory.length})
          </summary>
          <div className="mt-2 space-y-2 border-t border-[#E7E5E0] pt-3">
            {userAccessHistory.length === 0 ? (
              <p className="text-xs text-[#6D6A64]">
                Todavía no hay cambios registrados.
              </p>
            ) : (
              userAccessHistory.map((entry) => (
                <div
                  key={entry.audit_id}
                  className="rounded-lg bg-white p-3 text-xs text-[#5C5A55]"
                >
                  <p>
                    <strong className="text-[#18181B]">{entry.actor_name}</strong>{" "}
                    {auditActionLabel(entry.action)} de{" "}
                    <strong className="text-[#18181B]">{entry.target_name}</strong>.
                  </p>
                  <p className="mt-1 text-[11px] text-[#6D6A64]">
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
          <div>
            <FieldLabel htmlFor="new-user-name" required>
              Nombre completo
            </FieldLabel>
            <input
              id="new-user-name"
              required
              minLength={2}
              maxLength={60}
              autoComplete="name"
              value={createForm.fullName}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, fullName: event.target.value }))
              }
              className={`${INPUT_CLASS} mt-1.5 min-h-11 w-full`}
              placeholder="Ej. María López"
            />
          </div>
          <div>
            <FieldLabel htmlFor="new-user-username" required>
              Usuario interno
            </FieldLabel>
            <input
              id="new-user-username"
              required
              minLength={3}
              maxLength={32}
              autoCapitalize="none"
              value={createForm.username}
              onChange={(event) =>
                setCreateForm((prev) => ({
                  ...prev,
                  username: event.target.value.toLowerCase(),
                }))
              }
              className={`${INPUT_CLASS} mt-1.5 min-h-11 w-full`}
              placeholder="Ej. maria.lopez"
            />
            <p className="mt-1 text-[11px] text-[#6D6A64]">
              Se usa en auditorías y responsables; no es la contraseña.
            </p>
          </div>
          <div>
            <FieldLabel htmlFor="new-user-email" required>
              Correo autorizado
            </FieldLabel>
            <input
              id="new-user-email"
              required
              type="email"
              maxLength={254}
              autoCapitalize="none"
              autoComplete="email"
              value={createForm.email}
              onChange={(event) =>
                setCreateForm((prev) => ({
                  ...prev,
                  email: event.target.value.toLowerCase(),
                }))
              }
              className={`${INPUT_CLASS} mt-1.5 min-h-11 w-full`}
              placeholder="persona@empresa.com"
            />
          </div>
          <div>
            <FieldLabel htmlFor="new-user-role" required>
              Rol
            </FieldLabel>
            <select
              id="new-user-role"
              value={createForm.role}
              onChange={(event) =>
                setCreateForm((prev) => ({
                  ...prev,
                  role: event.target.value as RoleValue,
                }))
              }
              className={`${INPUT_CLASS} mt-1.5 min-h-11 w-full`}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-4 text-[#6D6A64]">
              {roleDescription(createForm.role)}
            </p>
          </div>
          <div className="rounded-lg border border-[#CFE0F0] bg-[#F2F7FB] p-3 text-xs leading-5 text-[#1E446B]">
            No se envía una contraseña. La persona usará “Crear cuenta” con este mismo
            correo y Neon Auth verificará su identidad.
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busyUserActionId !== null}
              onClick={() => setCreateOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busyUserActionId !== null}
            >
              {busyUserActionId === "create" ? "Creando..." : "Crear usuario"}
            </Button>
          </div>
        </form>
      </ModalSheet>

      <ModalSheet
        open={Boolean(pendingRoleChange)}
        onClose={() => busyUserActionId === null && setPendingRoleChange(null)}
        title="Confirmar cambio de rol"
        subtitle={pendingRoleChange?.user.full_name}
      >
        {pendingRoleChange && (
          <div className="space-y-4 text-sm text-[#5C5A55]">
            <p>
              Cambiarás el acceso de{" "}
              <strong className="text-[#18181B]">
                {formatRoleEs(pendingRoleChange.user.role)}
              </strong>{" "}
              a{" "}
              <strong className="text-[#18181B]">
                {formatRoleEs(pendingRoleChange.role)}
              </strong>
              . El cambio se aplicará en su siguiente solicitud y quedará auditado.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busyUserActionId !== null}
                onClick={() => setPendingRoleChange(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={busyUserActionId !== null}
                onClick={() => void handleRoleChange()}
              >
                {busyUserActionId !== null ? "Guardando..." : "Confirmar rol"}
              </Button>
            </div>
          </div>
        )}
      </ModalSheet>

      <ModalSheet
        open={Boolean(confirmToggleUser)}
        onClose={() => busyUserActionId === null && setConfirmToggleUser(null)}
        title="Confirmar desactivación"
        subtitle={confirmToggleUser?.full_name}
      >
        {confirmToggleUser && (
          <div className="space-y-4 text-sm text-[#5C5A55]">
            <p>
              La persona perderá acceso inmediatamente. Su historial no se elimina y
              podrás reactivar la cuenta después.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={busyUserActionId !== null}
                onClick={() => setConfirmToggleUser(null)}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busyUserActionId !== null}
                onClick={() => void handleToggleUserActive(confirmToggleUser)}
              >
                {busyUserActionId !== null ? "Desactivando..." : "Sí, desactivar"}
              </Button>
            </div>
          </div>
        )}
      </ModalSheet>
    </>
  );
}
