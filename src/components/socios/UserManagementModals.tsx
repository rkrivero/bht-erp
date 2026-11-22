"use client";

import type { FormEvent } from "react";
import {
  Button,
  FieldLabel,
  INPUT_CLASS,
  ModalSheet,
} from "@/components/ui/Primitives";
import { formatRoleEs } from "@/lib/labels-es";
import type { AppUserItem, UserAccessAuditItem } from "./types";

export const ROLE_OPTIONS = [
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

export type RoleValue = (typeof ROLE_OPTIONS)[number]["value"];

export interface CreateUserFormState {
  fullName: string;
  username: string;
  email: string;
  role: RoleValue;
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

function formatAuditDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(date);
}

export function RoleSelect({
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

export function UserAccessHistoryDetails({
  history,
}: {
  history: UserAccessAuditItem[];
}) {
  return (
    <details className="rounded-xl border border-bht-line bg-bht-paper p-3.5">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-bht-ink-strong">
        Historial de cambios de acceso ({history.length})
      </summary>
      <div className="mt-2 space-y-2 border-t border-bht-line pt-3">
        {history.length === 0 ? (
          <p className="text-xs text-bht-ink-muted">
            Todavía no hay cambios registrados.
          </p>
        ) : (
          history.map((entry) => (
            <div
              key={entry.audit_id}
              className="rounded-lg bg-white p-3 text-xs text-bht-ink-soft"
            >
              <p>
                <strong className="text-bht-ink-strong">{entry.actor_name}</strong>{" "}
                {auditActionLabel(entry.action, entry.after_data)} de{" "}
                <strong className="text-bht-ink-strong">{entry.target_name}</strong>.
              </p>
              <p className="mt-1 text-xs text-bht-ink-muted">
                {formatAuditDate(entry.created_at)}
              </p>
            </div>
          ))
        )}
      </div>
    </details>
  );
}

export function CreateUserModal({
  open,
  busy,
  createForm,
  onChangeForm,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  createForm: CreateUserFormState;
  onChangeForm: (updater: (prev: CreateUserFormState) => CreateUserFormState) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <ModalSheet
      open={open}
      onClose={() => !busy && onClose()}
      title="Crear usuario"
      subtitle="Autoriza primero su correo y define exactamente qué podrá hacer"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
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
                onChangeForm((prev) => ({
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
            onChange={(role) => onChangeForm((prev) => ({ ...prev, role }))}
            className="mt-1.5 w-full"
          />
        </div>
        <div className="rounded-lg border border-bht-info-line bg-bht-surface-cool p-3 text-xs leading-5 text-bht-navy-mid">
          No se envía una contraseña. La persona usará “Crear cuenta” con este mismo
          correo y Neon Auth verificará su identidad.
        </div>
        <ModalFooter
          busy={busy}
          onCancel={onClose}
          confirmLabel="Crear usuario"
          busyLabel="Creando..."
        />
      </form>
    </ModalSheet>
  );
}

export function AssignRoleModal({
  roleModalUser,
  busy,
  onSelectRole,
  onClose,
  onConfirm,
}: {
  roleModalUser: { user: AppUserItem; role: RoleValue } | null;
  busy: boolean;
  onSelectRole: (role: RoleValue) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalSheet
      open={Boolean(roleModalUser)}
      onClose={() => !busy && onClose()}
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
                  onClick={() => onSelectRole(option.value)}
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
            busy={busy}
            onCancel={onClose}
            confirmLabel="Asignar rol"
            busyLabel="Guardando..."
            onConfirm={onConfirm}
          />
        </div>
      )}
    </ModalSheet>
  );
}

export function ConfirmUserActionModal({
  confirmUserAction,
  busy,
  onClose,
  onConfirm,
}: {
  confirmUserAction: { kind: "deactivate" | "delete"; user: AppUserItem } | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalSheet
      open={Boolean(confirmUserAction)}
      onClose={() => !busy && onClose()}
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
              y su correo para poder reutilizarlos, conservando la auditoría histórica.
            </p>
          ) : (
            <p>
              La persona perderá acceso inmediatamente. Su historial no se elimina y
              podrás reactivar la cuenta después.
            </p>
          )}
          <ModalFooter
            busy={busy}
            onCancel={onClose}
            confirmVariant="danger"
            confirmLabel={
              confirmUserAction.kind === "delete" ? "Sí, eliminar" : "Sí, desactivar"
            }
            busyLabel={
              confirmUserAction.kind === "delete"
                ? "Eliminando..."
                : "Desactivando..."
            }
            onConfirm={onConfirm}
          />
        </div>
      )}
    </ModalSheet>
  );
}
