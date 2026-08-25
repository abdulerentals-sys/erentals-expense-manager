import { desc, eq } from "drizzle-orm";
import { canCreateRecord, canRecordPayment, filterRecordData } from "../../auth/permissions";
import { getSessionUser } from "../../auth/session";
import { getDb } from "../../../db";
import { ensureSchema } from "../../../db/ensure";
import {
  customers,
  expenses,
  invoices,
  orders,
  payments,
  persons,
} from "../../../db/schema";

const now = () => new Date().toISOString();
const clean = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

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

function usesNetlifyStorage() {
  return typeof process !== "undefined" && Boolean(process.env.MONGODB_URI?.trim());
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
    return Response.json(filterRecordData(data, user.role));
  }

  try {
    await ensureSchema();
    const db = getDb();
    const [customerRows, personRows, orderRows, invoiceRows, expenseRows, paymentRows] =
      await Promise.all([
        db.select().from(customers).orderBy(desc(customers.createdAt)),
        db.select().from(persons).orderBy(desc(persons.createdAt)),
        db.select().from(orders).orderBy(desc(orders.createdAt)),
        db.select().from(invoices).orderBy(desc(invoices.createdAt)),
        db.select().from(expenses).orderBy(desc(expenses.createdAt)),
        db.select().from(payments).orderBy(desc(payments.createdAt)),
      ]);

    const orderByInvoice = new Map(invoiceRows.map((invoice) => [invoice.id, invoice.orderId]));
    const normalizedPayments = paymentRows.map((payment) => ({
      ...payment,
      orderId: payment.orderId || orderByInvoice.get(payment.invoiceId) || "",
      personId: payment.personId || "",
    }));

    return Response.json(filterRecordData({
      customers: customerRows,
      persons: personRows,
      orders: orderRows,
      invoices: invoiceRows,
      expenses: expenseRows,
      payments: normalizedPayments,
    }, user.role));
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
  try {
    const body = await request.clone().json() as { type?: unknown; payload?: Record<string, unknown> };
    requestedType = clean(body.type);
    requestedDirection = clean(body.payload?.direction);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!canCreateRecord(user.role, requestedType)) {
    return Response.json({ error: "Your role cannot create this record" }, { status: 403 });
  }
  if (requestedType === "payment" && !canRecordPayment(user.role, requestedDirection)) {
    return Response.json({ error: "Your role cannot record this payment type" }, { status: 403 });
  }
  if (usesNetlifyStorage()) {
    const mongodb = await import("./mongodb");
    return mongodb.POST(request);
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

    if (type === "customer") {
      const missing = required(payload, ["name", "businessName", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const row = {
        id: crypto.randomUUID(),
        name: clean(payload.name),
        businessName: clean(payload.businessName),
        phone: clean(payload.phone),
        email: clean(payload.email),
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
      const row = {
        id: crypto.randomUUID(),
        name: clean(payload.name),
        role: clean(payload.role),
        phone: clean(payload.phone),
        email: clean(payload.email),
        paymentMode: clean(payload.paymentMode) || "UPI",
        status: "Active",
        createdAt,
      };
      await db.insert(persons).values(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "order") {
      const missing = required(payload, ["title", "customerId", "assignedPersonId", "eventDate"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["eventDate"])) {
        return Response.json({ error: "Enter a valid event or delivery date" }, { status: 400 });
      }
      const customerId = clean(payload.customerId);
      const assignedPersonId = clean(payload.assignedPersonId);
      const [[customer], [assignedPerson]] = await Promise.all([
        db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1),
        db.select({ id: persons.id }).from(persons).where(eq(persons.id, assignedPersonId)).limit(1),
      ]);
      if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
      if (!assignedPerson) return Response.json({ error: "Select a valid execution lead" }, { status: 400 });
      const contractValue = money(payload.contractValue);
      if (!contractValue) return Response.json({ error: "Order value must be greater than zero" }, { status: 400 });
      const row = {
        id: crypto.randomUUID(),
        orderNo: clean(payload.orderNo) || `ORD-${Date.now().toString().slice(-6)}`,
        title: clean(payload.title),
        customerId,
        assignedPersonId,
        venue: clean(payload.venue),
        eventDate: clean(payload.eventDate),
        status: clean(payload.status) || "Planned",
        contractValue,
        createdAt,
      };
      await db.insert(orders).values(row);
      return Response.json({ record: row }, { status: 201 });
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
      const missing = required(payload, ["orderId", "personId", "category", "expenseDate", "amount"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["expenseDate"])) {
        return Response.json({ error: "Enter a valid expense date" }, { status: 400 });
      }
      const orderId = clean(payload.orderId);
      const personId = clean(payload.personId);
      const [[order], [person]] = await Promise.all([
        db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).limit(1),
        db.select({ id: persons.id }).from(persons).where(eq(persons.id, personId)).limit(1),
      ]);
      if (!order) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (!person) return Response.json({ error: "Select a valid responsible person" }, { status: 400 });
      const amount = money(payload.amount);
      if (!amount) return Response.json({ error: "Expense amount must be greater than zero" }, { status: 400 });
      const row = {
        id: crypto.randomUUID(),
        expenseNo: clean(payload.expenseNo) || `EXP-${Date.now().toString().slice(-6)}`,
        orderId,
        personId,
        category: clean(payload.category),
        vendor: clean(payload.vendor),
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
      const missing = required(payload, ["direction", "orderId", "amount", "paymentDate", "method"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["paymentDate"])) {
        return Response.json({ error: "Enter a valid payment date" }, { status: 400 });
      }
      const direction = clean(payload.direction);
      if (!["Received", "Paid"].includes(direction)) {
        return Response.json({ error: "Select a valid payment type" }, { status: 400 });
      }
      const orderId = clean(payload.orderId);
      const personId = direction === "Paid" ? clean(payload.personId) : "";
      const [linkedOrder] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!linkedOrder) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (direction === "Paid" && !personId) {
        return Response.json({ error: "Select the vendor or payee" }, { status: 400 });
      }
      if (personId) {
        const [person] = await db.select({ id: persons.id }).from(persons).where(eq(persons.id, personId)).limit(1);
        if (!person) return Response.json({ error: "Select a valid vendor or payee" }, { status: 400 });
      }
      const amount = money(payload.amount);
      if (!amount) return Response.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
      const row = {
        id: crypto.randomUUID(),
        orderId,
        personId,
        invoiceId: "",
        customerId: linkedOrder.customerId,
        direction,
        amount,
        paymentDate: clean(payload.paymentDate),
        method: clean(payload.method),
        reference: clean(payload.reference),
        notes: clean(payload.notes),
        createdAt,
      };
      await db.insert(payments).values(row);
      return Response.json({ record: row }, { status: 201 });
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
  if (user.role !== "admin") {
    return Response.json({ error: "Only an administrator can edit orders" }, { status: 403 });
  }
  if (usesNetlifyStorage()) {
    const mongodb = await import("./mongodb");
    return mongodb.PATCH(request);
  }

  try {
    await ensureSchema();
    const body = (await request.json()) as {
      type?: string;
      id?: string;
      payload?: Record<string, unknown>;
    };
    const type = clean(body.type);
    const id = clean(body.id);
    const payload = body.payload ?? {};
    if (type !== "order" || !id) {
      return Response.json({ error: "Select a valid order to edit" }, { status: 400 });
    }
    const missing = required(payload, ["orderNo", "title", "customerId", "assignedPersonId", "eventDate"]);
    if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
    if (invalidDate(payload, ["eventDate"])) {
      return Response.json({ error: "Enter a valid event or delivery date" }, { status: 400 });
    }

    const db = getDb();
    const customerId = clean(payload.customerId);
    const assignedPersonId = clean(payload.assignedPersonId);
    const [[existingOrder], [customer], [assignedPerson]] = await Promise.all([
      db.select().from(orders).where(eq(orders.id, id)).limit(1),
      db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1),
      db.select({ id: persons.id }).from(persons).where(eq(persons.id, assignedPersonId)).limit(1),
    ]);
    if (!existingOrder) return Response.json({ error: "Order not found" }, { status: 404 });
    if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
    if (!assignedPerson) return Response.json({ error: "Select a valid execution lead" }, { status: 400 });
    const contractValue = money(payload.contractValue);
    if (!contractValue) return Response.json({ error: "Order value must be greater than zero" }, { status: 400 });

    const updates = {
      orderNo: clean(payload.orderNo),
      title: clean(payload.title),
      customerId,
      assignedPersonId,
      venue: clean(payload.venue),
      eventDate: clean(payload.eventDate),
      status: clean(payload.status) || "Planned",
      contractValue,
    };
    await db.update(orders).set(updates).where(eq(orders.id, id));
    return Response.json({ record: { ...existingOrder, ...updates } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update order";
    const friendly = message.includes("UNIQUE") ? "That order number already exists" : message;
    return Response.json({ error: friendly }, { status: 500 });
  }
}
