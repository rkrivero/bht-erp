import type { UndoActionReceiptDto } from "@/lib/contracts";

export const STATUS_TABS = [
  { id: "PREPARING", label: "Por alistar" },
  { id: "READY", label: "Listos / En ruta" },
  { id: "DELIVERED", label: "Entregados" },
] as const;

export type WarehouseStage = (typeof STATUS_TABS)[number]["id"];
export type PreparingFilter = "ALL" | "NOT_STARTED" | "IN_PROGRESS";
export type CheckedLines = Record<number, boolean>;
export type NextOrderStatus = "PICKING" | "READY" | "IN_ROUTE" | "DELIVERED";

export interface WarehouseFeedback {
  type: "ok" | "err";
  msg: string;
  undoAction?: UndoActionReceiptDto;
}
