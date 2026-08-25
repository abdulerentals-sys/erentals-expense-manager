import type { UserRole } from "./types";

export type DashboardSection =
  | "overview"
  | "customers"
  | "invoices"
  | "persons"
  | "orders"
  | "expenses"
  | "payments"
  | "reports"
  | "users";

export type RecordType = "customer" | "person" | "order" | "invoice" | "expense" | "payment";
export type PaymentDirection = "Received" | "Paid";

export const roleLabels: Record<UserRole, string> = {
  admin: "Administrator",
  accountant: "Accountant",
  supervisor: "Supervisor",
  sales: "Sales person",
};

export const roleDescriptions: Record<UserRole, string> = {
  admin: "Full access, including user administration and every financial record.",
  accountant: "Customers, invoices, expenses, payments and financial reports.",
  supervisor: "Customers, people, orders and execution expenses.",
  sales: "Customers, people, orders, sales invoices and customer receipts.",
};

const sectionsByRole: Record<UserRole, DashboardSection[]> = {
  admin: ["overview", "customers", "invoices", "persons", "orders", "expenses", "payments", "reports", "users"],
  accountant: ["overview", "customers", "invoices", "expenses", "payments", "reports"],
  supervisor: ["overview", "customers", "persons", "orders", "expenses"],
  sales: ["overview", "customers", "persons", "orders", "invoices", "payments"],
};

const recordsByRole: Record<UserRole, RecordType[]> = {
  admin: ["customer", "person", "order", "invoice", "expense", "payment"],
  accountant: ["customer", "invoice", "expense", "payment"],
  supervisor: ["customer", "person", "order", "expense"],
  sales: ["customer", "person", "order", "invoice", "payment"],
};

export function canViewSection(role: UserRole, section: string): section is DashboardSection {
  return sectionsByRole[role].includes(section as DashboardSection);
}

export function canCreateRecord(role: UserRole, type: string): type is RecordType {
  return recordsByRole[role].includes(type as RecordType);
}

export function canRecordPayment(role: UserRole, direction: string): direction is PaymentDirection {
  if (direction === "Received") return ["admin", "accountant", "sales"].includes(role);
  if (direction === "Paid") return ["admin", "accountant"].includes(role);
  return false;
}

export function visibleSections(role: UserRole) {
  return sectionsByRole[role];
}

export function filterRecordData<T extends Record<string, unknown>>(data: T, role: UserRole): T {
  if (role === "admin" || role === "accountant") return data;
  const hidden = role === "supervisor" ? ["invoices", "payments"] : ["expenses"];
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (hidden.includes(key)) return [key, []];
      if (role === "sales" && key === "payments" && Array.isArray(value)) {
        return [key, value.filter((item) => item && typeof item === "object" && (item as { direction?: unknown }).direction === "Received")];
      }
      return [key, value];
    }),
  ) as T;
}
