export type PriorityCategory = "decision" | "cash" | "operation" | "risk";
export type PriorityLevel = "critical" | "due" | "attention" | "clear";

export interface PriorityItem {
  id: string;
  category: PriorityCategory;
  level: PriorityLevel;
  title: string;
  summary: string;
  dueLabel: string;
  entity: {
    type: "order" | "collection" | "purchase" | "inventory" | "group";
    count: number;
  };
  allowedAction: "review-decisions" | "open-collections" | "open-finance" | "open-inventory";
}
