export const ARCHIVED_ORDER_STATUS = "Archived";

export type OrderLifecycleRecord = { status: unknown };

const historicalStatuses = new Set(["Completed", "Cancelled", ARCHIVED_ORDER_STATUS]);

export function isActiveOrder(order: OrderLifecycleRecord) {
  return !historicalStatuses.has(String(order.status || ""));
}

export function isHistoricalOrder(order: OrderLifecycleRecord) {
  return historicalStatuses.has(String(order.status || ""));
}

export function isFinancialOrder(order: OrderLifecycleRecord) {
  return !["Cancelled", ARCHIVED_ORDER_STATUS].includes(String(order.status || ""));
}
