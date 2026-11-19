"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button, Card, SegmentedControl } from "@/components/ui/Primitives";
import type { PartnerData } from "./usePartnerData";
import type { ShowFeedback } from "./partnerShared";

const UserManagementPanel = dynamic(
  () => import("@/components/socios/UserManagementPanel"),
  {
    loading: () => (
      <Card
        className="p-8 text-center text-sm font-medium text-bht-ink-soft"
        role="status"
      >
        Preparando gestión de usuarios…
      </Card>
    ),
  }
);

const AdminUndoPanel = dynamic(() => import("@/components/socios/AdminUndoPanel"), {
  loading: () => (
    <Card
      className="p-8 text-center text-sm font-medium text-bht-ink-soft"
      role="status"
    >
      Preparando centro de reversión…
    </Card>
  ),
});

interface AccesosProps {
  data: PartnerData;
  setSubTabEditing: (editing: boolean) => void;
  showFeedback: ShowFeedback;
  onGoBackHome?: () => void;
}

export function Accesos({
  data,
  setSubTabEditing,
  showFeedback,
  onGoBackHome,
}: AccesosProps) {
  const [adminSection, setAdminSection] = useState<"users" | "undo">("users");
  const { currentUser, appUsers, userAccessHistory, loadDashboard } = data;
  if (!currentUser) {
    return (
      <Card
        className="p-8 text-center text-sm font-medium text-bht-ink-soft"
        role="status"
      >
        Cargando equipo y permisos…
      </Card>
    );
  }
  if (currentUser.role !== "PARTNER_ADMIN") {
    return (
      <Card tone="warning" padding="md" className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-base font-bold text-bht-navy-deep">
            Administración de usuarios y roles
          </h2>
          <p className="text-sm text-bht-ink-strong">
            Solo el usuario Administrador (PARTNER_ADMIN) puede consultar o modificar
            cuentas y roles del equipo.
          </p>
        </div>
        {onGoBackHome && (
          <Button type="button" variant="primary" size="sm" onClick={onGoBackHome}>
            Volver a Hoy
          </Button>
        )}
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <SegmentedControl<"users" | "undo">
        ariaLabel="Secciones de administración"
        value={adminSection}
        onChange={setAdminSection}
        className="w-full sm:w-auto"
        options={[
          { id: "users", label: "Usuarios y permisos", count: appUsers.length },
          { id: "undo", label: "Deshacer acciones (Admin)" },
        ]}
      />
      {adminSection === "undo" ? (
        <AdminUndoPanel
          onRefreshDashboard={loadDashboard}
          onFeedback={showFeedback}
          onEditingChange={setSubTabEditing}
        />
      ) : (
        <UserManagementPanel
          currentUser={currentUser}
          users={appUsers}
          userAccessHistory={userAccessHistory}
          onRefresh={loadDashboard}
          onFeedback={showFeedback}
          onEditingChange={setSubTabEditing}
        />
      )}
    </div>
  );
}
