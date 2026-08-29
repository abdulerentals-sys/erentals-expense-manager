import { and, desc, eq, ne } from "drizzle-orm";
import { canCreateRecord, canRecordPayment, filterRecordData } from "../../auth/permissions";
import { getSessionUser } from "../../auth/session";
import { isOrderTeamPerson, resolveUserPersonId } from "../../auth/team";
import type { UserRole } from "../../auth/types";
import { expenseCategoryKey, isAllowedExpenseCategory, isBuiltInExpenseCategory, isExpenseResponsiblePerson } from "../../expense-rules";
import { calculateTentativeCost, isProductType, normalizeMeasurement, type PricingBasis } from "../../vendor-pricing";
import { getDb } from "../../../db";
import { ensureSchema } from "../../../db/ensure";
import {
  customers,
  expenseCategories,
  expenses,
  invoices,
  orderProducts,
  orderVendors,
  orders,
  payments,
  persons,
  vendorProducts,
  vendors,
} from "../../../db/schema";

const now = () => new Date().toISOString();
const clean = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
const positiveInteger = (value: unknown) => Math.max(1, Math.round(Number(value) || 1));

type PaymentAllocation = { orderId: string; amount: number };
type OrderProductInput = { name: string; quantity: number; price: number };
type VendorAssignmentInput = { vendorId: string; productName: string; amount: number; notes: string };

function orderProductInputs(payload: Record<string, unknown>): OrderProductInput[] {
  let raw: unknown = payload.products;
  if (typeof raw === "string" && raw.trim()) {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    return { name: clean(row.name), quantity: money(row.quantity), price: money(row.price) };
  }).filter((item) => item.name || item.quantity || item.price);
}

function vendorAssignments(payload: Record<string, unknown>): VendorAssignmentInput[] {
  let raw: unknown = payload.vendorAssignments;
  if (typeof raw === "string" && raw.trim()) {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    return { vendorId: clean(row.vendorId), productName: clean(row.productName), amount: money(row.amount), notes: clean(row.notes) };
  }).filter((item) => item.vendorId || item.productName || item.amount);
}

function paymentAllocations(payload: Record<string, unknown>): PaymentAllocation[] {
  let raw: unknown = payload.allocations;
  if (typeof raw === "string" && raw.trim()) {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => ({ orderId: clean((item as Record<string, unknown>).orderId), amount: money((item as Record<string, unknown>).amount) })).filter((item) => item.orderId && item.orderId !== "__manual__" && item.amount);
  }
  const orderId = clean(payload.orderId);
  const amount = money(payload.amount);
  return orderId && orderId !== "__manual__" && amount ? [{ orderId, amount }] : [];
}

function required(payload: Record<string, unknown>, fields: string[]) {
  return fields.find((field) => !clean(payload[field]));
}

function validDate(value: unknown) {
  const normalized = clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function invalidDate(payload: Record<string, unknown>, fields: string[]) {
  return fields.find((field) => !validDate(payload[field]));
}

function validTime(value: unknown) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean(value));
}

function asBoolean(value: unknown) {
  return value === true || ["true", "on", "1"].includes(clean(value).toLowerCase());
}

function orderScheduleError(payload: Record<string, unknown>, pickupFromGodown: boolean) {
  const missing = required(payload, ["deliveryDate", "deliveryTime", "pickupDate", "pickupTime"]);
  if (missing) return `${missing} is required`;
  if (invalidDate(payload, ["deliveryDate", "pickupDate"]) || !validTime(payload.deliveryTime) || !validTime(payload.pickupTime)) {
    return "Enter valid delivery and pickup dates and times";
  }
  if (`${clean(payload.pickupDate)}T${clean(payload.pickupTime)}` < `${clean(payload.deliveryDate)}T${clean(payload.deliveryTime)}`) {
    return "Pickup date and time cannot be before delivery date and time";
  }
  if (!pickupFromGodown) {
    const siteMissing = required(payload, ["deliveryAddress", "contactPerson", "contactPhone"]);
    if (siteMissing) return `${siteMissing} is required unless pickup from godown is selected`;
  }
  return "";
}

function usesNetlifyStorage() {
  return typeof process !== "undefined" && Boolean(process.env.MONGODB_URI?.trim());
}

async function findSessionPerson(db: ReturnType<typeof getDb>, user: { personId: string; name: string; email: string; role: UserRole }) {
  const people = await db.select().from(persons).where(eq(persons.status, "Active"));
  const personId = resolveUserPersonId(people, user);
  return people.find((person) => person.id === personId);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (user.mustChangePassword) return Response.json({ error: "Change your temporary password before using the dashboard" }, { status: 403 });
  if (usesNetlifyStorage()) {
    const mongodb = await import("./mongodb");
    const response = await mongodb.GET();
    if (!response.ok) return response;
    const data = await response.json() as Record<string, unknown>;
    return Response.json(filterRecordData(data, user.role, user.personId, user.name, user.email));
  }

  try {
    await ensureSchema();
    const db = getDb();
    const [customerRows, personRows, vendorRows, vendorProductRows, orderRows, orderProductRows, orderVendorRows, invoiceRows, expenseRows, expenseCategoryRows, paymentRows] =
      await Promise.all([
        db.select().from(customers).orderBy(desc(customers.createdAt)),
        db.select().from(persons).orderBy(desc(persons.createdAt)),
        db.select().from(vendors).orderBy(desc(vendors.createdAt)),
        db.select().from(vendorProducts).where(ne(vendorProducts.status, "Deleted")).orderBy(desc(vendorProducts.createdAt)),
        db.select().from(orders).orderBy(desc(orders.createdAt)),
        db.select().from(orderProducts).orderBy(desc(orderProducts.createdAt)),
        db.select().from(orderVendors).orderBy(desc(orderVendors.createdAt)),
        db.select().from(invoices).orderBy(desc(invoices.createdAt)),
        db.select().from(expenses).orderBy(desc(expenses.createdAt)),
        db.select().from(expenseCategories).where(eq(expenseCategories.status, "Active")).orderBy(expenseCategories.name),
        db.select().from(payments).orderBy(desc(payments.createdAt)),
      ]);

    const orderByInvoice = new Map(invoiceRows.map((invoice) => [invoice.id, invoice.orderId]));
    const normalizedPayments = paymentRows.map((payment) => ({
      ...payment,
      orderId: payment.orderId || orderByInvoice.get(payment.invoiceId) || "",
      manualOrderId: payment.manualOrderId || "",
      personId: payment.personId || "",
      vendorId: payment.vendorId || "",
    }));
    const normalizedOrders = orderRows.map((order) => ({
      ...order,
      deliveryDate: order.deliveryDate || order.eventDate,
      pickupDate: order.pickupDate || order.eventDate,
    }));

    return Response.json(filterRecordData({
      customers: customerRows,
      persons: personRows,
      vendors: vendorRows,
      vendorProducts: vendorProductRows,
      orders: normalizedOrders,
      orderProducts: orderProductRows,
      orderVendors: orderVendorRows,
      invoices: invoiceRows,
      expenses: expenseRows,
      expenseCategories: expenseCategoryRows,
      payments: normalizedPayments,
    }, user.role, user.personId, user.name, user.email));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load records" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (user.mustChangePassword) return Response.json({ error: "Change your temporary password before using the dashboard" }, { status: 403 });
  let requestedType = "";
  let requestedDirection = "";
  let requestedAllocationCount = 0;
  try {
    const body = await request.clone().json() as { type?: unknown; payload?: Record<string, unknown> };
    requestedType = clean(body.type);
    requestedDirection = clean(body.payload?.direction);
    requestedAllocationCount = paymentAllocations(body.payload ?? {}).length;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!canCreateRecord(user.role, requestedType)) {
    return Response.json({ error: "Your role cannot create this record" }, { status: 403 });
  }
  if (requestedType === "payment" && !canRecordPayment(user.role, requestedDirection)) {
    return Response.json({ error: "Your role cannot record this payment type" }, { status: 403 });
  }
  if (requestedType === "payment" && requestedAllocationCount > 1 && !["admin", "accountant"].includes(user.role)) {
    return Response.json({ error: "Only accountants and administrators can select multiple orders" }, { status: 403 });
  }
  if (usesNetlifyStorage()) {
    const mongodb = await import("./mongodb");
    return mongodb.POST(request, { userRole: user.role, userPersonId: user.personId, userName: user.name, userEmail: user.email });
  }

  try {
    await ensureSchema();
    const body = (await request.json()) as {
      type?: string;
      payload?: Record<string, unknown>;
    };
    const type = clean(body.type);
    const payload = body.payload ?? {};
    const db = getDb();
    const createdAt = now();
    const userRole = user.role;

    if (type === "customer") {
      const missing = required(payload, ["name", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const row = {
        id: crypto.randomUUID(),
        name: clean(payload.name),
        businessName: clean(payload.businessName),
        phone: clean(payload.phone),
        email: clean(payload.email).toLowerCase(),
        gstin: clean(payload.gstin),
        address: clean(payload.address),
        openingBalance: Math.round(Number(payload.openingBalance) || 0),
        createdAt,
      };
      await db.insert(customers).values(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "person") {
      const missing = required(payload, ["name", "role", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const orderId = clean(payload.orderId);
      if (user.role === "supervisor") {
        const supervisorPerson = await findSessionPerson(db, user);
        if (!supervisorPerson) return Response.json({ error: "Add an active People record with your name and Supervisor role" }, { status: 400 });
        const [ownedOrder] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.assignedPersonId, supervisorPerson.id), ne(orders.status, "Completed"), ne(orders.status, "Cancelled"))).limit(1);
        if (!ownedOrder) return Response.json({ error: "Supervisor actions require an active assigned order" }, { status: 403 });
      }
      const row = {
        id: crypto.randomUUID(),
        name: clean(payload.name),
        role: clean(payload.role),
        phone: clean(payload.phone),
        email: clean(payload.email).toLowerCase(),
        paymentMode: clean(payload.paymentMode) || "UPI",
        status: "Active",
        orderId,
        createdAt,
      };
      await db.insert(persons).values(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "vendor") {
      const missing = required(payload, ["name", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const row = { id: crypto.randomUUID(), name: clean(payload.name), contactPerson: clean(payload.contactPerson), phone: clean(payload.phone), email: clean(payload.email), gstin: clean(payload.gstin), address: clean(payload.address), paymentMode: clean(payload.paymentMode) || "Bank transfer", status: "Active", createdAt };
      await db.insert(vendors).values(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "vendorProduct") {
      const missing = required(payload, ["vendorId", "name", "productType", "pricingBasis", "rentalCharge"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const vendorId = clean(payload.vendorId);
      const pricingBasis = clean(payload.pricingBasis);
      const productType = clean(payload.productType);
      const rentalCharge = money(payload.rentalCharge);
      const [vendor] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
      if (!vendor) return Response.json({ error: "Select a valid vendor" }, { status: 400 });
      if (!isProductType(productType)) return Response.json({ error: "Select quantity-wise, length-wise or area-based pricing" }, { status: 400 });
      if (!["Per day", "Per event"].includes(pricingBasis)) return Response.json({ error: "Select per-day or per-event pricing" }, { status: 400 });
      if (!rentalCharge) return Response.json({ error: "Rental charge must be greater than zero" }, { status: 400 });
      const row = { id: crypto.randomUUID(), vendorId, name: clean(payload.name), productType, pricingBasis, rentalCharge, status: "Active", createdAt };
      await db.insert(vendorProducts).values(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "expenseCategory") {
      const name = clean(payload.name).replace(/\s+/g, " ");
      if (!name) return Response.json({ error: "Category name is required" }, { status: 400 });
      if (name.length > 60) return Response.json({ error: "Category name must be 60 characters or fewer" }, { status: 400 });
      if (isBuiltInExpenseCategory(name)) return Response.json({ error: "That built-in category already exists" }, { status: 400 });
      const nameKey = expenseCategoryKey(name);
      const [existing] = await db.select().from(expenseCategories).where(eq(expenseCategories.nameKey, nameKey)).limit(1);
      if (existing?.status === "Active") return Response.json({ error: "That category already exists" }, { status: 400 });
      if (existing) {
        await db.update(expenseCategories).set({ name, status: "Active" }).where(eq(expenseCategories.id, existing.id));
        return Response.json({ record: { ...existing, name, status: "Active" } }, { status: 201 });
      }
      const row = { id: crypto.randomUUID(), name, nameKey, status: "Active", createdAt };
      await db.insert(expenseCategories).values(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "order") {
      const missing = required(payload, ["customerId", "assignedPersonId", "eventDate"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["eventDate"])) {
        return Response.json({ error: "Enter a valid event or delivery date" }, { status: 400 });
      }
      const customerId = clean(payload.customerId);
      const userRole = user.role;
      const sessionPerson = userRole === "sales" ? await findSessionPerson(db, user) : undefined;
      const salespersonId = userRole === "sales" ? sessionPerson?.id ?? "" : clean(payload.salespersonId);
      const assignedPersonId = clean(payload.assignedPersonId);
      if (!salespersonId && userRole === "sales") return Response.json({ error: "Add an active People record with your name and Sales person role" }, { status: 400 });
      if (!salespersonId) return Response.json({ error: "salespersonId is required" }, { status: 400 });
      const pickupFromGodown = asBoolean(payload.pickupFromGodown);
      const scheduleError = orderScheduleError(payload, pickupFromGodown);
      if (scheduleError) return Response.json({ error: scheduleError }, { status: 400 });
      const [[customer], [salesperson], [assignedPerson]] = await Promise.all([
        db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1),
        db.select({ id: persons.id, role: persons.role, status: persons.status }).from(persons).where(eq(persons.id, salespersonId)).limit(1),
        db.select({ id: persons.id, role: persons.role, status: persons.status }).from(persons).where(eq(persons.id, assignedPersonId)).limit(1),
      ]);
      if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
      if (!salesperson) return Response.json({ error: "Select a valid salesperson from the team" }, { status: 400 });
      if (!assignedPerson) return Response.json({ error: "Select a valid supervisor from the team" }, { status: 400 });
      if (salesperson.status !== "Active" || assignedPerson.status !== "Active") return Response.json({ error: "Select active team members for the order" }, { status: 400 });
      if (!isOrderTeamPerson(salesperson, "salesperson")) return Response.json({ error: "Select a valid salesperson from People" }, { status: 400 });
      if (!isOrderTeamPerson(assignedPerson, "supervisor")) return Response.json({ error: "Select a valid supervisor from People" }, { status: 400 });
      const contractValue = money(payload.contractValue);
      if (!contractValue) return Response.json({ error: "Order value must be greater than zero" }, { status: 400 });
      const advancePayment = money(payload.advancePayment);
      if (advancePayment > contractValue) return Response.json({ error: "Advance payment cannot exceed the order value" }, { status: 400 });
      if (advancePayment && (invalidDate(payload, ["advancePaymentDate"]) || !clean(payload.advancePaymentMethod))) {
        return Response.json({ error: "Enter the advance payment date and method" }, { status: 400 });
      }
      const products = orderProductInputs(payload);
      if (products.some((item) => !item.name || !item.quantity || !item.price)) {
        return Response.json({ error: "Complete the product name, quantity and price for every product" }, { status: 400 });
      }
      const firstProduct = products[0];
      const row = {
        id: crypto.randomUUID(),
        orderNo: clean(payload.orderNo) || `ORD-${Date.now().toString().slice(-6)}`,
        title: clean(payload.title),
        customerId,
        salespersonId,
        assignedPersonId,
        venue: clean(payload.venue),
        eventDate: clean(payload.eventDate),
        deliveryAddress: clean(payload.deliveryAddress),
        deliveryDate: clean(payload.deliveryDate),
        deliveryTime: clean(payload.deliveryTime),
        pickupDate: clean(payload.pickupDate),
        pickupTime: clean(payload.pickupTime),
        pickupAddress: clean(payload.pickupAddress),
        pickupFromGodown,
        contactPerson: clean(payload.contactPerson),
        contactPhone: clean(payload.contactPhone),
        productName: firstProduct?.name ?? "",
        productPrice: firstProduct?.price ?? 0,
        attachmentKey: clean(payload.attachmentKey),
        attachmentName: clean(payload.attachmentName),
        attachmentType: clean(payload.attachmentType),
        status: clean(payload.status) || "Planned",
        contractValue,
        createdAt,
      };
      const assignments = vendorAssignments(payload);
      if (assignments.some((item) => !item.vendorId || !item.productName || !item.amount)) return Response.json({ error: "Complete the vendor, product and amount for every assignment" }, { status: 400 });
      const uniqueVendorIds = [...new Set(assignments.map((item) => item.vendorId))];
      const validVendors = await Promise.all(uniqueVendorIds.map(async (vendorId) => {
        const [vendor] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
        return vendor;
      }));
      if (validVendors.some((vendor) => !vendor)) return Response.json({ error: "Select valid vendors for the order" }, { status: 400 });
      const productRows = products.map((product) => ({ id: crypto.randomUUID(), orderId: row.id, ...product, amount: product.quantity * product.price, createdAt }));
      const assignmentRows = assignments.map((assignment) => ({ id: crypto.randomUUID(), orderId: row.id, ...assignment, createdAt }));
      const advanceRow = advancePayment ? {
        id: crypto.randomUUID(),
        orderId: row.id,
        manualOrderId: "",
        personId: "",
        vendorId: "",
        invoiceId: "",
        customerId,
        direction: "Received",
        amount: advancePayment,
        paymentDate: clean(payload.advancePaymentDate),
        method: clean(payload.advancePaymentMethod),
        reference: clean(payload.advanceReference),
        notes: clean(payload.advanceNotes) || "Advance payment received during order creation",
        createdAt,
      } : null;
      if (productRows.length && assignmentRows.length && advanceRow) {
        await db.batch([db.insert(orders).values(row), db.insert(orderProducts).values(productRows), db.insert(orderVendors).values(assignmentRows), db.insert(payments).values(advanceRow)]);
      } else if (productRows.length && assignmentRows.length) {
        await db.batch([db.insert(orders).values(row), db.insert(orderProducts).values(productRows), db.insert(orderVendors).values(assignmentRows)]);
      } else if (productRows.length && advanceRow) {
        await db.batch([db.insert(orders).values(row), db.insert(orderProducts).values(productRows), db.insert(payments).values(advanceRow)]);
      } else if (productRows.length) {
        await db.batch([db.insert(orders).values(row), db.insert(orderProducts).values(productRows)]);
      } else if (assignmentRows.length && advanceRow) {
        await db.batch([db.insert(orders).values(row), db.insert(orderVendors).values(assignmentRows), db.insert(payments).values(advanceRow)]);
      } else if (assignmentRows.length) {
        await db.batch([db.insert(orders).values(row), db.insert(orderVendors).values(assignmentRows)]);
      } else if (advanceRow) {
        await db.batch([db.insert(orders).values(row), db.insert(payments).values(advanceRow)]);
      } else {
        await db.insert(orders).values(row);
      }
      return Response.json({ record: row, payment: advanceRow }, { status: 201 });
    }

    if (type === "orderVendor") {
      const missing = required(payload, ["orderId", "vendorId", "productId"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const orderId = clean(payload.orderId); const vendorId = clean(payload.vendorId); const productId = clean(payload.productId);
      const [[order], [vendor], [product]] = await Promise.all([
        db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).limit(1),
        db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).limit(1),
        db.select().from(vendorProducts).where(eq(vendorProducts.id, productId)).limit(1),
      ]);
      if (!order) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (!vendor) return Response.json({ error: "Select a valid vendor" }, { status: 400 });
      if (!product || product.vendorId !== vendorId) return Response.json({ error: "Select a product listed by this vendor" }, { status: 400 });
      if (user.role === "supervisor") {
        const supervisorPerson = await findSessionPerson(db, user);
        if (!supervisorPerson) return Response.json({ error: "Add an active People record with your name and Supervisor role" }, { status: 400 });
        const [ownedOrder] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.assignedPersonId, supervisorPerson.id), ne(orders.status, "Completed"), ne(orders.status, "Cancelled"))).limit(1);
        if (!ownedOrder) return Response.json({ error: "Supervisor actions require an active assigned order" }, { status: 403 });
      }
      const productType = isProductType(product.productType) ? product.productType : "Quantity-wise";
      const measurement = normalizeMeasurement(payload.measurement ?? payload.quantity, productType);
      if (!measurement) return Response.json({ error: `Enter a valid ${productType === "Quantity-wise" ? "quantity" : productType === "Length-wise" ? "length" : "area"}` }, { status: 400 });
      const quantity = productType === "Quantity-wise" ? Math.round(measurement) : 1;
      const rentalDays = product.pricingBasis === "Per day" ? positiveInteger(payload.rentalDays) : 1;
      const calculatedAmount = calculateTentativeCost(product.rentalCharge, product.pricingBasis as PricingBasis, measurement, rentalDays);
      const requestedAmount = money(payload.amount);
      const amount = userRole === "supervisor" ? calculatedAmount : requestedAmount || calculatedAmount;
      const productName = product.name;
      const assignment = { productId, productName, productType, pricingBasis: product.pricingBasis, unitRate: product.rentalCharge, quantity, measurement, rentalDays, amount, notes: clean(payload.notes) };
      const [existing] = await db.select().from(orderVendors).where(and(eq(orderVendors.orderId, orderId), eq(orderVendors.productId, productId))).limit(1);
      if (existing && user.role !== "supervisor") {
        await db.update(orderVendors).set(assignment).where(eq(orderVendors.id, existing.id));
        return Response.json({ record: { ...existing, ...assignment } });
      }
      if (existing) return Response.json({ record: { ...existing, amount: 0, unitRate: 0 } });
      const row = { id: crypto.randomUUID(), orderId, vendorId, ...assignment, createdAt };
      await db.insert(orderVendors).values(row);
      const visibleRow = userRole === "supervisor" ? { ...row, amount: 0, unitRate: 0 } : row;
      return Response.json({ record: visibleRow }, { status: 201 });
    }

    if (type === "invoice") {
      const missing = required(payload, ["invoiceNo", "customerId", "orderId", "billedPersonId", "issueDate", "dueDate"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["issueDate", "dueDate"])) {
        return Response.json({ error: "Enter valid invoice and due dates" }, { status: 400 });
      }
      if (clean(payload.dueDate) < clean(payload.issueDate)) {
        return Response.json({ error: "Due date cannot be before the invoice date" }, { status: 400 });
      }
      const customerId = clean(payload.customerId);
      const orderId = clean(payload.orderId);
      const billedPersonId = clean(payload.billedPersonId);
      const [[customer], [order], [billedPerson]] = await Promise.all([
        db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1),
        db.select({ id: orders.id, customerId: orders.customerId }).from(orders).where(eq(orders.id, orderId)).limit(1),
        db.select({ id: persons.id }).from(persons).where(eq(persons.id, billedPersonId)).limit(1),
      ]);
      if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
      if (!order) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (order.customerId !== customerId) {
        return Response.json({ error: "The selected order belongs to a different customer" }, { status: 400 });
      }
      if (!billedPerson) return Response.json({ error: "Select a valid billed person" }, { status: 400 });
      const subtotal = money(payload.subtotal);
      const tax = money(payload.tax);
      if (!subtotal) return Response.json({ error: "Taxable amount must be greater than zero" }, { status: 400 });
      const status = clean(payload.status) || "Sent";
      if (!["Draft", "Sent", "Overdue"].includes(status)) {
        return Response.json({ error: "Record payments separately after creating the invoice" }, { status: 400 });
      }
      const row = {
        id: crypto.randomUUID(),
        invoiceNo: clean(payload.invoiceNo),
        customerId,
        orderId,
        billedPersonId,
        issueDate: clean(payload.issueDate),
        dueDate: clean(payload.dueDate),
        subtotal,
        tax,
        total: subtotal + tax,
        paidAmount: 0,
        status,
        notes: clean(payload.notes),
        attachmentKey: clean(payload.attachmentKey),
        attachmentName: clean(payload.attachmentName),
        attachmentType: clean(payload.attachmentType),
        createdAt,
      };
      await db.insert(invoices).values(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "expense") {
      const missing = required(payload, user.role === "supervisor" ? ["orderId", "category", "expenseDate", "amount"] : ["orderId", "personId", "category", "expenseDate", "amount"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["expenseDate"])) {
        return Response.json({ error: "Enter a valid expense date" }, { status: 400 });
      }
      const orderId = clean(payload.orderId);
      const category = clean(payload.category);
      const customCategories = await db.select({ name: expenseCategories.name }).from(expenseCategories).where(eq(expenseCategories.status, "Active"));
      if (!isAllowedExpenseCategory(category, customCategories.map((item) => item.name))) {
        return Response.json({ error: "Select a valid expense category" }, { status: 400 });
      }
      let personId = clean(payload.personId);
      if (user.role === "supervisor") {
        const supervisorPerson = await findSessionPerson(db, user);
        if (!supervisorPerson) return Response.json({ error: "Add an active People record with your name and Supervisor role" }, { status: 400 });
        if (personId && personId !== supervisorPerson.id) {
          return Response.json({ error: "Supervisor expenses are assigned to your People role automatically" }, { status: 400 });
        }
        if (clean(payload.vendorId) || clean(payload.vendor)) {
          return Response.json({ error: "Vendor or payee cannot be recorded on an expense" }, { status: 400 });
        }
        const [ownedOrder] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.assignedPersonId, supervisorPerson.id), ne(orders.status, "Completed"), ne(orders.status, "Cancelled"))).limit(1);
        if (!ownedOrder) return Response.json({ error: "Supervisor actions require an active assigned order" }, { status: 403 });
        personId = supervisorPerson.id;
      }
      const [[order], [person]] = await Promise.all([
        db.select({ id: orders.id, assignedPersonId: orders.assignedPersonId }).from(orders).where(eq(orders.id, orderId)).limit(1),
        db.select({ id: persons.id, role: persons.role, status: persons.status }).from(persons).where(eq(persons.id, personId)).limit(1),
      ]);
      if (!order) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (!person) return Response.json({ error: "Select a valid responsible person" }, { status: 400 });
      if (user.role !== "supervisor" && !isExpenseResponsiblePerson(person, order)) {
        return Response.json({ error: "Responsible person must be an active salesperson, this order's assigned supervisor, or an active manager" }, { status: 400 });
      }
      const amount = money(payload.amount);
      if (!amount) return Response.json({ error: "Expense amount must be greater than zero" }, { status: 400 });
      const row = {
        id: crypto.randomUUID(),
        expenseNo: clean(payload.expenseNo) || `EXP-${Date.now().toString().slice(-6)}`,
        orderId,
        personId,
        category,
        vendor: "",
        vendorId: "",
        description: clean(payload.description),
        expenseDate: clean(payload.expenseDate),
        amount,
        paymentMode: clean(payload.paymentMode) || "UPI",
        receiptKey: clean(payload.receiptKey),
        receiptName: clean(payload.receiptName),
        createdAt,
      };
      await db.insert(expenses).values(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "payment") {
      const missing = required(payload, ["direction", "amount", "paymentDate", "method"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["paymentDate"])) {
        return Response.json({ error: "Enter a valid payment date" }, { status: 400 });
      }
      const direction = clean(payload.direction);
      if (!["Received", "Paid"].includes(direction)) {
        return Response.json({ error: "Select a valid payment type" }, { status: 400 });
      }
      const personId = "";
      const customerId = direction === "Received" ? clean(payload.customerId) : "";
      const vendorId = direction === "Paid" ? clean(payload.vendorId) : "";
      const rawManualOrderId = clean(payload.manualOrderId);
      const manualOrderId = direction === "Received" ? rawManualOrderId : "";
      const allocations = paymentAllocations(payload);
      if (rawManualOrderId && direction !== "Received") return Response.json({ error: "Manual Order ID is only available for customer receipts" }, { status: 400 });
      if (manualOrderId && allocations.length) return Response.json({ error: "Choose either a listed order or a manual Order ID" }, { status: 400 });
      if (!manualOrderId && !allocations.length) return Response.json({ error: "Select at least one order or enter a manual Order ID" }, { status: 400 });
      if (new Set(allocations.map((item) => item.orderId)).size !== allocations.length) return Response.json({ error: "Each order can only be selected once" }, { status: 400 });
      if (direction === "Received" && !customerId) {
        return Response.json({ error: "Select the customer" }, { status: 400 });
      }
      if (direction === "Paid" && !vendorId) {
        return Response.json({ error: "Select the vendor or payee" }, { status: 400 });
      }
      if (customerId) {
        const [customer] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
        if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
      }
      if (vendorId) {
        const [vendor] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
        if (!vendor) return Response.json({ error: "Select a valid vendor or payee" }, { status: 400 });
      }
      const amount = money(payload.amount);
      if (!amount) return Response.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
      if (!manualOrderId && allocations.reduce((sum, item) => sum + item.amount, 0) !== amount) return Response.json({ error: "Allocation total must equal the payment amount" }, { status: 400 });
      const linkedOrders = await Promise.all(allocations.map(async (allocation) => {
        const [order] = await db.select().from(orders).where(eq(orders.id, allocation.orderId)).limit(1);
        return order;
      }));
      if (linkedOrders.some((order) => !order)) return Response.json({ error: "Select valid orders" }, { status: 400 });
      if (direction === "Received" && linkedOrders.some((order) => order!.customerId !== customerId)) return Response.json({ error: "Customer receipts can only use orders belonging to the selected customer" }, { status: 400 });
      if (direction === "Paid") {
        const assigned = await Promise.all(allocations.map(async (allocation) => {
          const rows = await db.select({ vendorId: orderVendors.vendorId }).from(orderVendors).where(eq(orderVendors.orderId, allocation.orderId));
          return rows.some((item) => item.vendorId === vendorId);
        }));
        if (assigned.some((value) => !value)) return Response.json({ error: "Vendor is not assigned to every selected order" }, { status: 400 });
      }
      const rows = (manualOrderId ? [{ orderId: "", amount }] : allocations).map((allocation, index) => ({
        id: crypto.randomUUID(), orderId: allocation.orderId, manualOrderId, personId, vendorId, invoiceId: "", customerId: direction === "Received" ? customerId : linkedOrders[index]!.customerId, direction, amount: allocation.amount,
        paymentDate: clean(payload.paymentDate), method: clean(payload.method), reference: clean(payload.reference), notes: clean(payload.notes), createdAt,
      }));
      await db.insert(payments).values(rows);
      return Response.json({ records: rows }, { status: 201 });
    }

    return Response.json({ error: "Unsupported record type" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save record";
    const friendly = message.includes("UNIQUE") ? "That reference number already exists" : message;
    return Response.json({ error: friendly }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (user.mustChangePassword) {
    return Response.json({ error: "Change your temporary password before using the dashboard" }, { status: 403 });
  }

  let body: { type?: string; id?: string; payload?: Record<string, unknown> };
  try {
    body = await request.clone().json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const type = clean(body.type);
  const id = clean(body.id);
  const payload = body.payload ?? {};
  if (!id || !["order", "payment", "vendorProduct"].includes(type)) {
    return Response.json({ error: "Select a valid record to edit" }, { status: 400 });
  }
  if (type === "order" && !["admin", "supervisor", "sales"].includes(user.role)) {
    return Response.json({ error: "Only an administrator, assigned salesperson or assigned supervisor can edit orders" }, { status: 403 });
  }
  if (type === "payment" && !canRecordPayment(user.role, clean(payload.direction))) {
    return Response.json({ error: "Your role cannot edit this payment" }, { status: 403 });
  }
  if (type === "vendorProduct" && !canCreateRecord(user.role, "vendorProduct")) {
    return Response.json({ error: "Your role cannot edit vendor products" }, { status: 403 });
  }
  if (usesNetlifyStorage()) {
    const mongodb = await import("./mongodb");
    return mongodb.PATCH(request, { userRole: user.role, userPersonId: user.personId, userName: user.name, userEmail: user.email });
  }

  try {
    await ensureSchema();
    const db = getDb();

    if (type === "vendorProduct") {
      const missing = required(payload, ["vendorId", "name", "productType", "pricingBasis", "rentalCharge"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const vendorId = clean(payload.vendorId);
      const productType = clean(payload.productType);
      const pricingBasis = clean(payload.pricingBasis);
      const rentalCharge = money(payload.rentalCharge);
      const [[existingProduct], [vendor]] = await Promise.all([
        db.select().from(vendorProducts).where(and(eq(vendorProducts.id, id), ne(vendorProducts.status, "Deleted"))).limit(1),
        db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).limit(1),
      ]);
      if (!existingProduct) return Response.json({ error: "Vendor product not found" }, { status: 404 });
      if (!vendor) return Response.json({ error: "Select a valid vendor" }, { status: 400 });
      if (!isProductType(productType)) return Response.json({ error: "Select quantity-wise, length-wise or area-based pricing" }, { status: 400 });
      if (!["Per day", "Per event"].includes(pricingBasis)) return Response.json({ error: "Select per-day or per-event pricing" }, { status: 400 });
      if (!rentalCharge) return Response.json({ error: "Rental charge must be greater than zero" }, { status: 400 });
      const updates = { vendorId, name: clean(payload.name), productType, pricingBasis, rentalCharge };
      await db.update(vendorProducts).set(updates).where(eq(vendorProducts.id, id));
      return Response.json({ record: { ...existingProduct, ...updates } });
    }

    if (type === "payment") {
      const missing = required(payload, ["direction", "amount", "paymentDate", "method"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["paymentDate"])) return Response.json({ error: "Enter a valid payment date" }, { status: 400 });
      const direction = clean(payload.direction);
      if (!["Received", "Paid"].includes(direction)) return Response.json({ error: "Select a valid payment type" }, { status: 400 });
      const rawManualOrderId = clean(payload.manualOrderId);
      const manualOrderId = direction === "Received" ? rawManualOrderId : "";
      const orderId = manualOrderId ? "" : clean(payload.orderId);
      const customerId = direction === "Received" ? clean(payload.customerId) : "";
      const vendorId = direction === "Paid" ? clean(payload.vendorId) : "";
      const amount = money(payload.amount);
      if (rawManualOrderId && direction !== "Received") return Response.json({ error: "Manual Order ID is only available for customer receipts" }, { status: 400 });
      if (manualOrderId && clean(payload.orderId) && clean(payload.orderId) !== "__manual__") return Response.json({ error: "Choose either a listed order or a manual Order ID" }, { status: 400 });
      if (!manualOrderId && (!orderId || orderId === "__manual__")) return Response.json({ error: "Select an order or enter a manual Order ID" }, { status: 400 });
      if (!amount) return Response.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
      const [[existingPayment], [order], [customer], [vendor]] = await Promise.all([
        db.select().from(payments).where(eq(payments.id, id)).limit(1),
        orderId ? db.select().from(orders).where(eq(orders.id, orderId)).limit(1) : Promise.resolve([]),
        customerId ? db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1) : Promise.resolve([]),
        vendorId ? db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).limit(1) : Promise.resolve([]),
      ]);
      if (!existingPayment) return Response.json({ error: "Payment not found" }, { status: 404 });
      if (user.role === "sales" && existingPayment.direction !== "Received") return Response.json({ error: "Your role cannot edit this payment" }, { status: 403 });
      if (!manualOrderId && !order) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (direction === "Received") {
        if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
        if (order && order.customerId !== customerId) return Response.json({ error: "Customer receipts can only use orders belonging to the selected customer" }, { status: 400 });
      } else {
        if (!vendor) return Response.json({ error: "Select a valid vendor or payee" }, { status: 400 });
        const [assignment] = await db.select({ id: orderVendors.id }).from(orderVendors).where(and(eq(orderVendors.orderId, orderId), eq(orderVendors.vendorId, vendorId))).limit(1);
        if (!assignment) return Response.json({ error: "Vendor is not assigned to the selected order" }, { status: 400 });
      }
      const updates = {
        orderId,
        manualOrderId,
        vendorId,
        invoiceId: "",
        customerId: direction === "Received" ? customerId : order!.customerId,
        direction,
        amount,
        paymentDate: clean(payload.paymentDate),
        method: clean(payload.method),
        reference: clean(payload.reference),
        notes: clean(payload.notes),
      };
      await db.update(payments).set(updates).where(eq(payments.id, id));
      return Response.json({ record: { ...existingPayment, ...updates } });
    }

    const missing = required(payload, user.role === "supervisor" ? ["eventDate"] : user.role === "sales" ? ["orderNo", "customerId", "assignedPersonId", "eventDate"] : ["orderNo", "customerId", "salespersonId", "assignedPersonId", "eventDate"]);
    if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
    if (invalidDate(payload, ["eventDate"])) {
      return Response.json({ error: "Enter a valid event or delivery date" }, { status: 400 });
    }
    const pickupFromGodown = asBoolean(payload.pickupFromGodown);
    const scheduleError = orderScheduleError(payload, pickupFromGodown);
    if (scheduleError) return Response.json({ error: scheduleError }, { status: 400 });

    const customerId = clean(payload.customerId);
    const sessionPerson = user.role === "sales" ? await findSessionPerson(db, user) : undefined;
    const salespersonId = user.role === "sales" ? sessionPerson?.id ?? "" : clean(payload.salespersonId);
    const assignedPersonId = clean(payload.assignedPersonId);
    const [[existingOrder], [customer], [salesperson], [assignedPerson]] = await Promise.all([
      db.select().from(orders).where(eq(orders.id, id)).limit(1),
      db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1),
      db.select({ id: persons.id, role: persons.role, status: persons.status }).from(persons).where(eq(persons.id, salespersonId)).limit(1),
      db.select({ id: persons.id, role: persons.role, status: persons.status }).from(persons).where(eq(persons.id, assignedPersonId)).limit(1),
    ]);
    if (!existingOrder) return Response.json({ error: "Order not found" }, { status: 404 });
    if (user.role === "supervisor") {
      const supervisorPerson = await findSessionPerson(db, user);
      if (!supervisorPerson) return Response.json({ error: "Add an active People record with your name and Supervisor role" }, { status: 400 });
      if (existingOrder.assignedPersonId !== supervisorPerson.id || ["Completed", "Cancelled"].includes(existingOrder.status)) return Response.json({ error: "Supervisor actions require an active assigned order" }, { status: 403 });
      const updates = {
        title: clean(payload.title),
        venue: clean(payload.venue),
        eventDate: clean(payload.eventDate),
        deliveryAddress: clean(payload.deliveryAddress),
        deliveryDate: clean(payload.deliveryDate),
        deliveryTime: clean(payload.deliveryTime),
        pickupDate: clean(payload.pickupDate),
        pickupTime: clean(payload.pickupTime),
        pickupAddress: clean(payload.pickupAddress),
        pickupFromGodown,
        contactPerson: clean(payload.contactPerson),
        contactPhone: clean(payload.contactPhone),
        status: clean(payload.status) || existingOrder.status,
      };
      await db.update(orders).set(updates).where(eq(orders.id, id));
      return Response.json({ record: { ...existingOrder, ...updates, salespersonId: existingOrder.salespersonId, assignedPersonId: existingOrder.assignedPersonId, contractValue: 0 } });
    }
    if (user.role === "sales" && (!salespersonId || existingOrder.salespersonId !== salespersonId)) {
      return Response.json({ error: "Salespeople can only edit orders assigned to their People role" }, { status: 403 });
    }
    if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
    if (!salesperson) return Response.json({ error: "Select a valid salesperson from the team" }, { status: 400 });
    if (!assignedPerson) return Response.json({ error: "Select a valid supervisor from the team" }, { status: 400 });
    if (salesperson.status !== "Active" || assignedPerson.status !== "Active") return Response.json({ error: "Select active team members for the order" }, { status: 400 });
    if (!isOrderTeamPerson(salesperson, "salesperson")) return Response.json({ error: "Select a valid salesperson from People" }, { status: 400 });
    if (!isOrderTeamPerson(assignedPerson, "supervisor")) return Response.json({ error: "Select a valid supervisor from People" }, { status: 400 });
    const contractValue = money(payload.contractValue);
    if (!contractValue) return Response.json({ error: "Order value must be greater than zero" }, { status: 400 });
    const products = orderProductInputs(payload);
    if (products.some((item) => !item.name || !item.quantity || !item.price)) {
      return Response.json({ error: "Complete the product name, quantity and price for every product" }, { status: 400 });
    }
    const assignments = user.role === "admin" ? vendorAssignments(payload) : [];
    if (assignments.some((item) => !item.vendorId || !item.productName || !item.amount)) {
      return Response.json({ error: "Complete the vendor, product and amount for every assignment" }, { status: 400 });
    }
    if (user.role === "admin") {
      const uniqueVendorIds = [...new Set(assignments.map((item) => item.vendorId))];
      const validVendors = await Promise.all(uniqueVendorIds.map(async (vendorId) => {
        const [vendor] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.id, vendorId)).limit(1);
        return vendor;
      }));
      if (validVendors.some((vendor) => !vendor)) return Response.json({ error: "Select valid vendors for the order" }, { status: 400 });
    }
    const firstProduct = products[0];

    const updates = {
      orderNo: clean(payload.orderNo),
      title: clean(payload.title),
      customerId,
      salespersonId,
      assignedPersonId,
      venue: clean(payload.venue),
      eventDate: clean(payload.eventDate),
      deliveryAddress: clean(payload.deliveryAddress),
      deliveryDate: clean(payload.deliveryDate),
      deliveryTime: clean(payload.deliveryTime),
      pickupDate: clean(payload.pickupDate),
      pickupTime: clean(payload.pickupTime),
      pickupAddress: clean(payload.pickupAddress),
      pickupFromGodown,
      contactPerson: clean(payload.contactPerson),
      contactPhone: clean(payload.contactPhone),
      productName: firstProduct?.name ?? "",
      productPrice: firstProduct?.price ?? 0,
      attachmentKey: clean(payload.attachmentKey) || existingOrder.attachmentKey,
      attachmentName: clean(payload.attachmentName) || existingOrder.attachmentName,
      attachmentType: clean(payload.attachmentType) || existingOrder.attachmentType,
      status: clean(payload.status) || "Planned",
      contractValue,
    };
    const productRows = products.map((product) => ({ id: crypto.randomUUID(), orderId: id, ...product, amount: product.quantity * product.price, createdAt: now() }));
    const assignmentRows = assignments.map((assignment) => ({ id: crypto.randomUUID(), orderId: id, productId: "", productType: "Quantity-wise", pricingBasis: "Per event", unitRate: assignment.amount, quantity: 1, measurement: 1, rentalDays: 1, ...assignment, createdAt: now() }));
    if (user.role === "admin" && productRows.length && assignmentRows.length) {
      await db.batch([db.update(orders).set(updates).where(eq(orders.id, id)), db.delete(orderProducts).where(eq(orderProducts.orderId, id)), db.insert(orderProducts).values(productRows), db.delete(orderVendors).where(eq(orderVendors.orderId, id)), db.insert(orderVendors).values(assignmentRows)]);
    } else if (user.role === "admin" && productRows.length) {
      await db.batch([db.update(orders).set(updates).where(eq(orders.id, id)), db.delete(orderProducts).where(eq(orderProducts.orderId, id)), db.insert(orderProducts).values(productRows), db.delete(orderVendors).where(eq(orderVendors.orderId, id))]);
    } else if (user.role === "admin" && assignmentRows.length) {
      await db.batch([db.update(orders).set(updates).where(eq(orders.id, id)), db.delete(orderProducts).where(eq(orderProducts.orderId, id)), db.delete(orderVendors).where(eq(orderVendors.orderId, id)), db.insert(orderVendors).values(assignmentRows)]);
    } else if (user.role === "admin") {
      await db.batch([db.update(orders).set(updates).where(eq(orders.id, id)), db.delete(orderProducts).where(eq(orderProducts.orderId, id)), db.delete(orderVendors).where(eq(orderVendors.orderId, id))]);
    } else if (productRows.length) {
      await db.batch([db.update(orders).set(updates).where(eq(orders.id, id)), db.delete(orderProducts).where(eq(orderProducts.orderId, id)), db.insert(orderProducts).values(productRows)]);
    } else {
      await db.batch([db.update(orders).set(updates).where(eq(orders.id, id)), db.delete(orderProducts).where(eq(orderProducts.orderId, id))]);
    }
    return Response.json({ record: { ...existingOrder, ...updates } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update record";
    const friendly = message.includes("UNIQUE") ? "That reference already exists" : message;
    return Response.json({ error: friendly }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (user.mustChangePassword) return Response.json({ error: "Change your temporary password before using the dashboard" }, { status: 403 });
  let body: { type?: string; id?: string };
  try {
    body = await request.clone().json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const type = clean(body.type);
  const id = clean(body.id);
  if (!id || !["vendorProduct", "expenseCategory"].includes(type)) return Response.json({ error: "Select a valid record to delete" }, { status: 400 });
  if (!canCreateRecord(user.role, type)) return Response.json({ error: "Your role cannot delete this record" }, { status: 403 });
  if (usesNetlifyStorage()) {
    const mongodb = await import("./mongodb");
    return mongodb.DELETE(request, { userRole: user.role, userPersonId: user.personId, userName: user.name, userEmail: user.email });
  }
  try {
    await ensureSchema();
    const db = getDb();
    if (type === "expenseCategory") {
      const [category] = await db.select().from(expenseCategories).where(and(eq(expenseCategories.id, id), eq(expenseCategories.status, "Active"))).limit(1);
      if (!category) return Response.json({ error: "Expense category not found" }, { status: 404 });
      await db.update(expenseCategories).set({ status: "Deleted" }).where(eq(expenseCategories.id, id));
      return Response.json({ record: { ...category, status: "Deleted" } });
    }
    const [product] = await db.select().from(vendorProducts).where(and(eq(vendorProducts.id, id), ne(vendorProducts.status, "Deleted"))).limit(1);
    if (!product) return Response.json({ error: "Vendor product not found" }, { status: 404 });
    await db.update(vendorProducts).set({ status: "Deleted" }).where(eq(vendorProducts.id, id));
    return Response.json({ record: { ...product, status: "Deleted" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete vendor product" }, { status: 500 });
  }
}
