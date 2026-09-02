export type AdminPeriod = "today" | "week" | "month" | "nextMonth" | "custom";

export type AdminDateRange = {
  from: string;
  to: string;
  label: string;
};

export type AnalyticsOrder = {
  id: string;
  salespersonId: string;
  deliveryDate: string;
  pickupDate: string;
  contractValue: number;
  status: string;
  createdAt: string;
};

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function keyFromUtcDate(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function shiftDateKey(value: string, days: number) {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return keyFromUtcDate(date);
}

export function indiaDateKey(value: string | Date = new Date()) {
  if (typeof value === "string" && dateKeyPattern.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function adminDateRange(period: AdminPeriod, reference: string | Date = new Date(), customFrom = "", customTo = ""): AdminDateRange {
  const referenceKey = indiaDateKey(reference) || indiaDateKey();
  const referenceDate = dateFromKey(referenceKey);
  if (period === "today") return { from: referenceKey, to: referenceKey, label: "Today" };
  if (period === "week") {
    const mondayOffset = (referenceDate.getUTCDay() + 6) % 7;
    const from = shiftDateKey(referenceKey, -mondayOffset);
    return { from, to: shiftDateKey(from, 6), label: "This week" };
  }
  if (period === "month" || period === "nextMonth") {
    const monthOffset = period === "nextMonth" ? 1 : 0;
    const first = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + monthOffset, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    return { from: keyFromUtcDate(first), to: keyFromUtcDate(last), label: period === "nextMonth" ? "Next month" : "This month" };
  }
  const from = dateKeyPattern.test(customFrom) ? customFrom : referenceKey;
  const to = dateKeyPattern.test(customTo) ? customTo : from;
  return from <= to ? { from, to, label: "Selected dates" } : { from: to, to: from, label: "Selected dates" };
}

export function dateIsInRange(value: string, range: AdminDateRange) {
  return Boolean(value && value >= range.from && value <= range.to);
}

export function summarizeAdminOrders<T extends AnalyticsOrder>(orders: T[], range: AdminDateRange) {
  const confirmedOrders = orders.filter((order) => !["Cancelled", "Archived"].includes(order.status));
  const newOrders = confirmedOrders.filter((order) => dateIsInRange(indiaDateKey(order.createdAt), range));
  const deliveries = confirmedOrders.filter((order) => dateIsInRange(order.deliveryDate, range)).sort((a, b) => `${a.deliveryDate}`.localeCompare(`${b.deliveryDate}`));
  const pickups = confirmedOrders.filter((order) => dateIsInRange(order.pickupDate, range)).sort((a, b) => `${a.pickupDate}`.localeCompare(`${b.pickupDate}`));
  return {
    newOrders,
    deliveries,
    pickups,
    salesAmount: newOrders.reduce((sum, order) => sum + order.contractValue, 0),
  };
}
