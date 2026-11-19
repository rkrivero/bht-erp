import type {
  ApObligationItem,
  AppUserItem,
  AuditFlagCounts,
  AuditFlagItem,
  BiSummary,
  CashAccountItem,
  CashLedgerEntry,
  CurrentUserInfo,
  DataCutSummary,
  KpiQ1Summary,
  OperationalQualitySummary,
  PartnerCatalogItem,
  PendingOnDemandItem,
  RecentPurchaseItem,
  SupplierItem,
  UserAccessAuditItem,
} from "@/components/socios/types";
import type {
  SellerCatalogItemDto,
  SellerCustomerDto,
  SellerOrderDto,
  SellerQuoteDto,
} from "@/features/seller/types";
import type { FulfillmentMode, LineFulfillmentStatus } from "./types";

export interface PaginationDto {
  limit: number;
  offset: number;
  totalCount: number;
  hasMore: boolean;
}

export interface OrdersResponseDto<
  TOrder = SellerOrderDto,
  TCatalog = SellerCatalogItemDto,
  TCustomer = SellerCustomerDto,
> {
  orders: TOrder[];
  catalog: TCatalog[];
  customers?: TCustomer[];
  accounts: CashAccountItem[];
  currentUser?: CurrentUserInfo;
  pagination?: PaginationDto;
}

export interface CollectionsResponseDto<TOrder, TCustomer> {
  byOrder: TOrder[];
  byCustomer: TCustomer[];
}

export interface DebtOrderLineDto {
  orderLineId: number;
  lineNo: number;
  productId: number;
  sku: string;
  rawDescription: string;
  unitOfMeasure: string;
  quantity: number;
  baseUnitPricePen: number;
  unitDiscountPen: number;
  unitPricePen: number;
  lineTotalPen: number;
  fulfillmentMode: FulfillmentMode;
  fulfillmentStatus: LineFulfillmentStatus;
}

export interface DebtOrderDto {
  orderId: number;
  orderCode: string;
  orderDate: string;
  dueDate?: string | null;
  customerKey: string;
  customerPartyId: number | null;
  customerName: string;
  paymentMode: string;
  operationalStatus: string;
  totalPen: number;
  paidPen: number;
  balanceDuePen: number;
  daysOverdue: number;
  invoiceAgeDays?: number;
  daysPastDue?: number | null;
  dueStatus?: "OVERDUE" | "DUE_SOON" | "CURRENT" | "NO_DUE_DATE";
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  promisedPaymentDate: string | null;
  promiseStatus:
    "DUE_TODAY_OR_TOMORROW" | "PROMISE_BROKEN" | "ON_SCHEDULE" | "NO_PROMISE_DATE";
  paymentCount: number;
  lastPaymentDate: string | null;
  createdByName: string | null;
  lines: DebtOrderLineDto[];
}

export interface CustomerDebtDto {
  customerKey: string;
  customerPartyId: number | null;
  customerName: string;
  openOrdersCount: number;
  totalSoldPen: number;
  totalPaidPen: number;
  totalBalanceDuePen: number;
  maxDaysOverdue: number;
  maxInvoiceAgeDays?: number;
  hasExplicitDueDate?: boolean;
  agingBucket: "GREEN_0_7" | "AMBER_8_29" | "RED_30_PLUS";
  earliestPromisedPaymentDate: string | null;
  promiseStatus:
    "DUE_TODAY_OR_TOMORROW" | "PROMISE_BROKEN" | "ON_SCHEDULE" | "NO_PROMISE_DATE";
}

export interface QuotesResponseDto {
  quotes: SellerQuoteDto[];
}

export interface SessionResponseDto {
  session: CurrentUserInfo | null;
}

export interface RouteTripDto {
  trip_id: number;
  trip_code: string;
  trip_date: string;
  status: "OPEN" | "CLOSED" | "RECONCILED";
  zone_name: string | null;
  driver_name: string | null;
  order_count: number;
  in_route_count: number;
  delivered_count: number;
  computed_sales_pen: number;
}

export interface TripsResponseDto {
  trips: RouteTripDto[];
}

export interface WarehouseLineDto {
  order_line_id: number;
  line_no: number;
  sku: string;
  raw_description: string;
  unit_of_measure?: string;
  quantity: number;
  fulfillment_mode: FulfillmentMode;
  fulfillment_status: string;
  needs_supplier_pickup: boolean;
}

export interface WarehouseOrderDto {
  order_id: number;
  order_code: string;
  order_date: string;
  customer_party_id?: number | null;
  customer_name: string;
  customer_zone?: string | null;
  customer_address?: string | null;
  customer_phone?: string | null;
  customer_geo_lat?: number | null;
  customer_geo_lng?: number | null;
  was_modified?: boolean;
  trip_id?: number | null;
  trip_code?: string | null;
  operational_status: "REGISTERED" | "PICKING" | "READY" | "IN_ROUTE" | "DELIVERED";
  notes: string | null;
  created_by_name: string | null;
  picked_by_name: string | null;
  delivered_by_name: string | null;
  lines: WarehouseLineDto[];
}

export interface WarehouseTripDto {
  trip_id: number;
  trip_code: string;
  trip_date: string;
  end_date: string | null;
  zone_name: string | null;
  driver_name: string | null;
  status: "OPEN" | "CLOSED" | "RECONCILED";
  notes: string | null;
  order_count: number;
  ready_count: number;
  in_route_count: number;
  delivered_count: number;
}

export interface WarehouseOrdersResponseDto {
  orders?: WarehouseOrderDto[];
  currentUser?: CurrentUserInfo;
}

export interface WarehouseTripsResponseDto {
  trips?: WarehouseTripDto[];
}

export interface WarehouseTripMutationResponseDto {
  tripCode?: string;
}

export interface PartnerTopSkuDto {
  product_id: number;
  sku: string;
  product_name: string;
  total_units_sold: number;
  total_revenue_pen: number;
  total_cogs_pen: number | null;
  gross_margin_pen: number | null;
  gross_margin_pct: number | null;
  margin_health_status?: string | null;
}

export interface PartnerQualityGapDto {
  metric_code: string;
  gap_count: number;
  impacted_amount_pen: number;
  recommended_action?: string | null;
}

export interface PartnerDashboardResponseDto {
  currentUser: CurrentUserInfo;
  kpiQ1: KpiQ1Summary;
  kpiQ2TopSkus: PartnerTopSkuDto[];
  qualityGaps: PartnerQualityGapDto[];
  openDebtorsCount: number;
  negativeStockSkuCount: number;
  unpurchasedRegularizationCount?: number;
  pendingOnDemand: PendingOnDemandItem[];
  auditFlags: AuditFlagItem[];
  auditFlagCounts: AuditFlagCounts;
  biSummary: BiSummary;
  users: AppUserItem[];
  userAccessHistory: UserAccessAuditItem[];
  dataCut?: DataCutSummary;
  operationalQuality?: OperationalQualitySummary;
}

export interface TreasuryResponseDto {
  accounts: CashAccountItem[];
  ledger: CashLedgerEntry[];
  apObligations: ApObligationItem[];
  suppliers: SupplierItem[];
}

export interface PurchasesResponseDto {
  accounts: CashAccountItem[];
  apObligations: ApObligationItem[];
  pendingOnDemand: PendingOnDemandItem[];
  recentPurchases: RecentPurchaseItem[];
  suppliers: SupplierItem[];
}

export type PartnerOrdersResponseDto = OrdersResponseDto<
  SellerOrderDto,
  PartnerCatalogItem,
  SellerCustomerDto
>;

export interface UndoActionReceiptDto {
  undoId: number;
  actionType: string;
  entityTable?: string;
  entityId?: string;
  entityCode?: string | null;
  summary: string;
  createdAt?: string;
  expiresAt: string;
  windowSeconds?: number;
}

export interface UndoableActionDto {
  undo_id: number;
  action_type: string;
  entity_table: string;
  entity_id: string;
  entity_code: string | null;
  summary: string;
  actor_user_id: number;
  actor_username: string;
  actor_name: string;
  actor_role: string;
  created_at: string;
  expires_at: string;
  undone_at: string | null;
  undone_by_user_id: number | null;
  undone_by_name: string | null;
  undone_reason: string | null;
  is_expired: boolean;
  can_undo: boolean;
  remaining_seconds: number;
}

export interface UndoListResponseDto {
  scope: "mine" | "all";
  windowSeconds: number;
  isAdmin: boolean;
  actions: UndoableActionDto[];
}

export interface UndoExecuteResponseDto {
  ok: true;
  undoId: number;
  actionType: string;
  entityCode: string | null;
  restoredMessage: string;
}
