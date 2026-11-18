"use client";

import dynamic from "next/dynamic";
import { Card } from "@/components/ui/Primitives";
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

interface AccesosProps {
  data: PartnerData;
  setSubTabEditing: (editing: boolean) => void;
  showFeedback: ShowFeedback;
}

export function Accesos({ data, setSubTabEditing, showFeedback }: AccesosProps) {
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
  return (
    <UserManagementPanel
      currentUser={currentUser}
      users={appUsers}
      userAccessHistory={userAccessHistory}
      onRefresh={loadDashboard}
      onFeedback={showFeedback}
      onEditingChange={setSubTabEditing}
    />
  );
}
