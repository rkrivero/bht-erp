"use client";

import { useEffect, useMemo, useState } from "react";
import { EditIcon, PlusIcon, TrashIcon } from "@/components/ui/Icons";
import {
  Badge,
  Button,
  Card,
  INPUT_CLASS,
  SegmentedControl,
} from "@/components/ui/Primitives";
import { formatRoleEs } from "@/lib/labels-es";
import { notifyLocalSync } from "@/lib/realtime/useLiveSync";
import type { AppUserItem, CurrentUserInfo, UserAccessAuditItem } from "./types";
import {
  AssignRoleModal,
  ConfirmUserActionModal,
  CreateUserModal,
  ROLE_OPTIONS,
  RoleSelect,
  UserAccessHistoryDetails,
  type CreateUserFormState,
  type RoleValue,
} from "./UserManagementModals";

interface UserManagementPanelProps {
  currentUser: CurrentUserInfo;
  users: AppUserItem[];
  userAccessHistory: UserAccessAuditItem[];
  onRefresh: () => Promise<void>;
  onFeedback: (message: string, isError?: boolean) => void;
  onEditingChange?: (editing: boolean) => void;
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
  const [createForm, setCreateForm] = useState<CreateUserFormState>({
    fullName: "",
    username: "",
    email: "",
    role: "EXTERNAL_SELLER",
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
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
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
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-bht-line pt-3">
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
                      className="mt-3 flex flex-col gap-2 border-t border-bht-line pt-3 sm:flex-row"
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

        <UserAccessHistoryDetails history={userAccessHistory} />
      </Card>

      <CreateUserModal
        open={createOpen}
        busy={busyUserActionId !== null}
        createForm={createForm}
        onChangeForm={setCreateForm}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateUser}
      />

      <AssignRoleModal
        roleModalUser={roleModalUser}
        busy={busyUserActionId !== null}
        onSelectRole={(role) =>
          setRoleModalUser((prev) => (prev ? { ...prev, role } : null))
        }
        onClose={() => setRoleModalUser(null)}
        onConfirm={() => {
          if (!roleModalUser) return;
          void submitRoleChange(roleModalUser.user, roleModalUser.role, () =>
            setRoleModalUser(null)
          );
        }}
      />

      <ConfirmUserActionModal
        confirmUserAction={confirmUserAction}
        busy={busyUserActionId !== null}
        onClose={() => setConfirmUserAction(null)}
        onConfirm={() => {
          if (!confirmUserAction) return;
          void (confirmUserAction.kind === "delete"
            ? handleDeleteUser(confirmUserAction.user)
            : handleToggleUserActive(confirmUserAction.user));
        }}
      />
    </>
  );
}
