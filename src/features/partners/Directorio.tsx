"use client";

import { useState } from "react";
import { Card, SegmentedControl } from "@/components/ui/Primitives";
import { DirectorioClientes } from "./DirectorioClientes";
import { DirectorioProveedores } from "./DirectorioProveedores";
import type { PartnerTab, ShowFeedback } from "./partnerShared";

type DirectorySubTab = "customers" | "suppliers";

interface Props {
  actorRole: string;
  showFeedback: ShowFeedback;
  handleTabChange: (tab: PartnerTab) => void;
  onDataChanged: () => void;
  setSubTabEditing: (editing: boolean) => void;
}

export default function Directorio({
  actorRole,
  showFeedback,
  handleTabChange,
  onDataChanged,
  setSubTabEditing,
}: Props) {
  const [subTab, setSubTab] = useState<DirectorySubTab>("customers");

  return (
    <div className="space-y-4">
      <Card
        accent="horizon"
        padding="md"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <div>
          <h2 className="text-base font-bold text-bht-ink-strong sm:text-lg">
            Directorio maestro
          </h2>
          <p className="text-xs text-bht-ink-soft">
            Datos de clientes (alias, zona y GPS) y fichas maestras de proveedores.
          </p>
        </div>
        <SegmentedControl
          value={subTab}
          onChange={setSubTab}
          ariaLabel="Sección del directorio"
          options={[
            { id: "customers", label: "Clientes" },
            { id: "suppliers", label: "Proveedores" },
          ]}
        />
      </Card>

      {subTab === "customers" ? (
        <DirectorioClientes
          actorRole={actorRole}
          showFeedback={showFeedback}
          handleTabChange={handleTabChange}
          onDataChanged={onDataChanged}
          setSubTabEditing={setSubTabEditing}
        />
      ) : (
        <DirectorioProveedores
          showFeedback={showFeedback}
          handleTabChange={handleTabChange}
          onDataChanged={onDataChanged}
          setSubTabEditing={setSubTabEditing}
        />
      )}
    </div>
  );
}
