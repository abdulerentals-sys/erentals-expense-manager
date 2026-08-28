import type { UserRole } from "./types";

export type DashboardSection =
  | "overview"
  | "customers"
  | "persons"
  | "vendors"
  | "orders"
  | "expenses"
  | "payments"
  | "reports"
  | "history"
  | "users";

export type RecordType = "customer" | "person" | "vendor" | "vendorProduct" | "order" | "orderVendor" | "expense" | "payment";
export type PaymentDirection = "Received" | "Paid";

export const roleLabels: Record<UserRole, string> = {
  admin: "Administrator",
  accountant: "Accountant",
  supervisor: "Supervisor",
  sales: "Sales person",
};

export const roleDescriptions: Record<UserRole, string> = {
  admin: "Full access, including user administration and every financial record.",
  accountant: "Customers, vendors, order expenses, payments and financial reports.",
  supervisor: "Assigned active orders, order contacts, vendor assignment, own expenses and read-only order history.",
  sales: "Customers, people, orders and customer receipts.",
};

const sectionsByRole: Record<UserRole, DashboardSection[]> = {
  admin: ["overview", "customers", "persons", "vendors", "orders", "expenses", "payments", "reports", "users"],
  accountant: ["overview", "customers", "vendors", "orders", "expenses", "payments", "reports"],
  supervisor: ["overview", "customers", "persons", "orders", "expenses", "history"],
  sales: ["overview", "customers", "persons", "orders", "payments"],
};

const recordsByRole: Record<UserRole, RecordType[]> = {
  admin: ["customer", "person", "vendor", "vendorProduct", "order", "orderVendor", "expense", "payment"],
  accountant: ["customer", "vendor", "vendorProduct", "orderVendor", "expense", "payment"],
  supervisor: ["person", "orderVendor", "expense"],
  sales: ["customer", "person", "order", "payment"],
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

export function filterRecordData<T extends Record<string, unknown>>(data: T, role: UserRole, userPersonId = "", legacyUserEmail = ""): T {
  if (role === "admin" || role === "accountant") return data;
  if (role === "supervisor") {
    const people = Array.isArray(data.persons) ? data.persons as Array<Record<string, unknown>> : [];
    const allOrders = Array.isArray(data.orders) ? data.orders as Array<Record<string, unknown>> : [];
    const normalizedEmail = legacyUserEmail.trim().toLowerCase();
    const supervisorPersonIds = new Set(
      userPersonId
        ? people.filter((person) => String(person.id ?? "") === userPersonId).map((person) => String(person.id ?? ""))
        : people.filter((person) => normalizedEmail && String(person.email ?? "").trim().toLowerCase() === normalizedEmail).map((person) => String(person.id ?? "")),
    );
    const ownOrders = allOrders.filter((order) => supervisorPersonIds.has(String(order.assignedPersonId ?? "")));
    const activeOrders = ownOrders.filter((order) => order.status !== "Completed" && order.status !== "Cancelled");
    const activeOrderIds = new Set(activeOrders.map((order) => String(order.id ?? "")));
    const allOrderIds = new Set(ownOrders.map((order) => String(order.id ?? "")));
    const activeCustomerIds = new Set(activeOrders.map((order) => String(order.customerId ?? "")));
    const allCustomerIds = new Set(ownOrders.map((order) => String(order.customerId ?? "")));
    const sanitizeOrder = (order: Record<string, unknown>) => ({ ...order, contractValue: 0, productPrice: 0, attachmentKey: "", attachmentName: "", attachmentType: "" });
    const customers = Array.isArray(data.customers) ? data.customers as Array<Record<string, unknown>> : [];
    const orderProducts = Array.isArray(data.orderProducts) ? data.orderProducts as Array<Record<string, unknown>> : [];
    const orderVendors = Array.isArray(data.orderVendors) ? data.orderVendors as Array<Record<string, unknown>> : [];
    const vendorProducts = Array.isArray(data.vendorProducts) ? data.vendorProducts as Array<Record<string, unknown>> : [];
    const vendors = Array.isArray(data.vendors) ? data.vendors as Array<Record<string, unknown>> : [];
    const expenses = Array.isArray(data.expenses) ? data.expenses as Array<Record<string, unknown>> : [];
    return {
      ...data,
      customers: customers.filter((customer) => activeCustomerIds.has(String(customer.id ?? ""))).map((customer) => ({ ...customer, openingBalance: 0 })),
      historyCustomers: customers.filter((customer) => allCustomerIds.has(String(customer.id ?? ""))).map((customer) => ({ id: customer.id, name: customer.name, businessName: customer.businessName })),
      persons: people.filter((person) => supervisorPersonIds.has(String(person.id ?? "")) || activeOrderIds.has(String(person.orderId ?? ""))).map((person) => ({ ...person, paymentMode: "" })),
      vendors: vendors.map((vendor) => ({ id: vendor.id, name: vendor.name, contactPerson: "", phone: "", email: "", gstin: "", address: "", paymentMode: "", status: vendor.status, createdAt: vendor.createdAt })),
      vendorProducts: vendorProducts.map((product) => ({ ...product, rentalCharge: 0 })),
      orders: activeOrders.map(sanitizeOrder),
      historyOrders: ownOrders.map(sanitizeOrder),
      orderProducts: orderProducts.filter((product) => activeOrderIds.has(String(product.orderId ?? ""))).map((product) => ({ ...product, price: 0, amount: 0 })),
      orderVendors: orderVendors.filter((assignment) => activeOrderIds.has(String(assignment.orderId ?? ""))).map((assignment) => ({ ...assignment, amount: 0, unitRate: 0 })),
      invoices: [],
      expenses: expenses.filter((expense) => activeOrderIds.has(String(expense.orderId ?? "")) && supervisorPersonIds.has(String(expense.personId ?? ""))),
      payments: [],
      supervisorLinked: supervisorPersonIds.size > 0,
      supervisorOrderIds: [...allOrderIds],
    } as T;
  }
  const hidden = ["expenses", "vendors", "vendorProducts", "orderVendors"];
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
