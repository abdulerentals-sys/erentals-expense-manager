import {
  Db,
  MongoClient,
  MongoServerError,
  type Collection,
  type Filter,
} from "mongodb";

type Payload = Record<string, unknown>;

type Customer = {
  id: string;
  name: string;
  businessName: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  openingBalance: number;
  createdAt: string;
};

type Person = {
  id: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  paymentMode: string;
  status: string;
  createdAt: string;
};

type Order = {
  id: string;
  orderNo: string;
  title: string;
  customerId: string;
  assignedPersonId: string;
  venue: string;
  eventDate: string;
  status: string;
  contractValue: number;
  createdAt: string;
};

type Invoice = {
  id: string;
  invoiceNo: string;
  customerId: string;
  orderId: string;
  billedPersonId: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  tax: number;
  total: number;
  paidAmount: number;
  status: string;
  notes: string;
  attachmentKey: string;
  attachmentName: string;
  attachmentType: string;
  createdAt: string;
};

type Expense = {
  id: string;
  expenseNo: string;
  orderId: string;
  personId: string;
  category: string;
  vendor: string;
  description: string;
  expenseDate: string;
  amount: number;
  paymentMode: string;
  receiptKey: string;
  receiptName: string;
  createdAt: string;
};

type Payment = {
  id: string;
  orderId: string;
  personId: string;
  invoiceId: string;
  customerId: string;
  direction: string;
  amount: number;
  paymentDate: string;
  method: string;
  reference: string;
  notes: string;
  createdAt: string;
};

type Collections = {
  customers: Collection<Customer>;
  persons: Collection<Person>;
  orders: Collection<Order>;
  invoices: Collection<Invoice>;
  expenses: Collection<Expense>;
  payments: Collection<Payment>;
};

const now = () => new Date().toISOString();
const clean = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

let mongoClientPromise: Promise<MongoClient> | null = null;
let mongoIndexesPromise: Promise<void> | null = null;

function required(payload: Payload, fields: string[]) {
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

function invalidDate(payload: Payload, fields: string[]) {
  return fields.find((field) => !validDate(payload[field]));
}

function getMongoUri() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MongoDB storage is not configured");
  return uri;
}

function getMongoClient() {
  if (!mongoClientPromise) {
    const uri = getMongoUri();
    const client = new MongoClient(uri, {
      appName: "erentals-expense-manager",
      maxIdleTimeMS: 30_000,
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5_000,
      waitQueueTimeoutMS: 5_000,
    });
    mongoClientPromise = client.connect().catch((error) => {
      mongoClientPromise = null;
      throw error;
    });
  }
  return mongoClientPromise;
}

function getCollections(db: Db): Collections {
  return {
    customers: db.collection<Customer>("customers"),
    persons: db.collection<Person>("persons"),
    orders: db.collection<Order>("orders"),
    invoices: db.collection<Invoice>("invoices"),
    expenses: db.collection<Expense>("expenses"),
    payments: db.collection<Payment>("payments"),
  };
}

function ensureMongoIndexes(collections: Collections) {
  if (!mongoIndexesPromise) {
    mongoIndexesPromise = Promise.all([
      collections.customers.createIndex({ createdAt: -1 }),
      collections.persons.createIndex({ createdAt: -1 }),
      collections.orders.createIndex({ orderNo: 1 }, { unique: true }),
      collections.orders.createIndex({ customerId: 1 }),
      collections.invoices.createIndex({ invoiceNo: 1 }, { unique: true }),
      collections.invoices.createIndex({ customerId: 1 }),
      collections.invoices.createIndex({ orderId: 1 }),
      collections.invoices.createIndex({ dueDate: 1 }),
      collections.expenses.createIndex({ expenseNo: 1 }, { unique: true }),
      collections.expenses.createIndex({ orderId: 1 }),
      collections.expenses.createIndex({ expenseDate: -1 }),
      collections.payments.createIndex({ customerId: 1 }),
      collections.payments.createIndex({ orderId: 1 }),
      collections.payments.createIndex({ personId: 1 }),
      collections.payments.createIndex({ invoiceId: 1 }),
      collections.payments.createIndex({ paymentDate: -1 }),
    ]).then(() => undefined).catch((error) => {
      mongoIndexesPromise = null;
      throw error;
    });
  }
  return mongoIndexesPromise;
}

async function getMongoDatabase() {
  const client = await getMongoClient();
  const databaseName = process.env.MONGODB_DB_NAME?.trim() || "erentals_expense_manager";
  const db = client.db(databaseName);
  const collections = getCollections(db);
  await ensureMongoIndexes(collections);
  return { collections };
}

async function findById<T extends { id: string }>(
  collection: Collection<T>,
  id: string,
) {
  return collection.findOne({ id } as Filter<T>, { projection: { _id: 0 } });
}

export async function GET() {
  try {
    const { collections } = await getMongoDatabase();
    const options = { projection: { _id: 0 } };
    const [customers, persons, orders, invoices, expenses, payments] = await Promise.all([
      collections.customers.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.persons.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.orders.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.invoices.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.expenses.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.payments.find({}, options).sort({ createdAt: -1 }).toArray(),
    ]);
    const orderByInvoice = new Map(invoices.map((invoice) => [invoice.id, invoice.orderId]));
    const normalizedPayments = payments.map((payment) => ({
      ...payment,
      orderId: payment.orderId || orderByInvoice.get(payment.invoiceId) || "",
      personId: payment.personId || "",
    }));
    return Response.json({ customers, persons, orders, invoices, expenses, payments: normalizedPayments });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load records" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { type?: string; payload?: Payload };
    const type = clean(body.type);
    const payload = body.payload ?? {};
    const { collections } = await getMongoDatabase();
    const createdAt = now();

    if (type === "customer") {
      const missing = required(payload, ["name", "businessName", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const row: Customer = {
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
      await collections.customers.insertOne(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "person") {
      const missing = required(payload, ["name", "role", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const row: Person = {
        id: crypto.randomUUID(),
        name: clean(payload.name),
        role: clean(payload.role),
        phone: clean(payload.phone),
        email: clean(payload.email),
        paymentMode: clean(payload.paymentMode) || "UPI",
        status: "Active",
        createdAt,
      };
      await collections.persons.insertOne(row);
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
      const [customer, assignedPerson] = await Promise.all([
        findById(collections.customers, customerId),
        findById(collections.persons, assignedPersonId),
      ]);
      if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
      if (!assignedPerson) {
        return Response.json({ error: "Select a valid execution lead" }, { status: 400 });
      }
      const contractValue = money(payload.contractValue);
      if (!contractValue) {
        return Response.json({ error: "Order value must be greater than zero" }, { status: 400 });
      }
      const row: Order = {
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
      await collections.orders.insertOne(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "invoice") {
      const missing = required(payload, [
        "invoiceNo", "customerId", "orderId", "billedPersonId", "issueDate", "dueDate",
      ]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["issueDate", "dueDate"])) {
        return Response.json({ error: "Enter valid invoice and due dates" }, { status: 400 });
      }
      if (clean(payload.dueDate) < clean(payload.issueDate)) {
        return Response.json(
          { error: "Due date cannot be before the invoice date" },
          { status: 400 },
        );
      }
      const customerId = clean(payload.customerId);
      const orderId = clean(payload.orderId);
      const billedPersonId = clean(payload.billedPersonId);
      const [customer, order, billedPerson] = await Promise.all([
        findById(collections.customers, customerId),
        findById(collections.orders, orderId),
        findById(collections.persons, billedPersonId),
      ]);
      if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
      if (!order) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (order.customerId !== customerId) {
        return Response.json(
          { error: "The selected order belongs to a different customer" },
          { status: 400 },
        );
      }
      if (!billedPerson) {
        return Response.json({ error: "Select a valid billed person" }, { status: 400 });
      }
      const subtotal = money(payload.subtotal);
      const tax = money(payload.tax);
      if (!subtotal) {
        return Response.json(
          { error: "Taxable amount must be greater than zero" },
          { status: 400 },
        );
      }
      const status = clean(payload.status) || "Sent";
      if (!["Draft", "Sent", "Overdue"].includes(status)) {
        return Response.json(
          { error: "Record payments separately after creating the invoice" },
          { status: 400 },
        );
      }
      const row: Invoice = {
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
      await collections.invoices.insertOne(row);
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
      const [order, person] = await Promise.all([
        findById(collections.orders, orderId),
        findById(collections.persons, personId),
      ]);
      if (!order) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (!person) {
        return Response.json({ error: "Select a valid responsible person" }, { status: 400 });
      }
      const amount = money(payload.amount);
      if (!amount) {
        return Response.json({ error: "Expense amount must be greater than zero" }, { status: 400 });
      }
      const row: Expense = {
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
      await collections.expenses.insertOne(row);
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
      const amount = money(payload.amount);
      if (!amount) {
        return Response.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
      }

      const orderId = clean(payload.orderId);
      const personId = direction === "Paid" ? clean(payload.personId) : "";
      const linkedOrder = await findById(collections.orders, orderId);
      if (!linkedOrder) throw new FormError("Select a valid order");
      if (direction === "Paid" && !personId) {
        throw new FormError("Select the vendor or payee");
      }
      if (personId) {
        const person = await findById(collections.persons, personId);
        if (!person) throw new FormError("Select a valid vendor or payee");
      }
      const row: Payment = {
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
      await collections.payments.insertOne(row);
      return Response.json({ record: row }, { status: 201 });
    }

    return Response.json({ error: "Unsupported record type" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save record";
    const friendly =
      error instanceof MongoServerError && error.code === 11000
        ? "That reference number already exists"
        : message;
    const status = error instanceof FormError ? 400 : 500;
    return Response.json({ error: friendly }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { type?: string; id?: string; payload?: Payload };
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

    const { collections } = await getMongoDatabase();
    const customerId = clean(payload.customerId);
    const assignedPersonId = clean(payload.assignedPersonId);
    const [existingOrder, customer, assignedPerson] = await Promise.all([
      findById(collections.orders, id),
      findById(collections.customers, customerId),
      findById(collections.persons, assignedPersonId),
    ]);
    if (!existingOrder) return Response.json({ error: "Order not found" }, { status: 404 });
    if (!customer) throw new FormError("Select a valid customer");
    if (!assignedPerson) throw new FormError("Select a valid execution lead");
    const contractValue = money(payload.contractValue);
    if (!contractValue) throw new FormError("Order value must be greater than zero");

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
    await collections.orders.updateOne({ id }, { $set: updates });
    return Response.json({ record: { ...existingOrder, ...updates } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update order";
    const friendly =
      error instanceof MongoServerError && error.code === 11000
        ? "That order number already exists"
        : message;
    return Response.json({ error: friendly }, { status: error instanceof FormError ? 400 : 500 });
  }
}

class FormError extends Error {}
