import {
  Db,
  MongoClient,
  MongoServerError,
  type Collection,
  type Filter,
} from "mongodb";
import { canEditCustomerProfile, canEditVendorProfile } from "../../auth/permissions";
import { isOrderTeamPerson, resolveUserPersonId } from "../../auth/team";
import type { UserRole } from "../../auth/types";
import { createExpenseNumber, expenseCategoryKey, isAllowedExpenseCategory, isBuiltInExpenseCategory, isExpenseResponsiblePerson } from "../../expense-rules";
import { isOrderSupervisor, normalizeSupervisorIds, orderSupervisorIds } from "../../order-supervisors";
import { ARCHIVED_ORDER_STATUS, isActiveOrder } from "../../order-lifecycle";
import { DEFAULT_PAYMENT_ACCOUNTS, expenseFundingSource, paymentAccountKey, type ExpenseFundingSource, type PaymentAccountRecord } from "../../payment-accounts";
import { calculateTentativeCost, isProductType, normalizeMeasurement, type PricingBasis, type ProductType } from "../../vendor-pricing";

type Payload = Record<string, unknown>;
type RequestContext = { userRole: UserRole; userPersonId: string; userName: string; userEmail: string };

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
  orderId: string;
  createdAt: string;
};

type Vendor = { id: string; name: string; contactPerson: string; phone: string; email: string; gstin: string; address: string; paymentMode: string; status: string; createdAt: string };
type VendorProduct = { id: string; vendorId: string; name: string; productType: ProductType; pricingBasis: PricingBasis; rentalCharge: number; status: string; createdAt: string };
type ExpenseCategoryRecord = { id: string; name: string; nameKey: string; status: string; createdAt: string };

type Order = {
  id: string;
  orderNo: string;
  title: string;
  customerId: string;
  salespersonId: string;
  assignedPersonId: string;
  supervisorIds?: string[];
  venue: string;
  eventDate: string;
  deliveryAddress: string;
  deliveryDate: string;
  deliveryTime: string;
  pickupDate: string;
  pickupTime: string;
  pickupAddress: string;
  pickupFromGodown: boolean;
  contactPerson: string;
  contactPhone: string;
  productName: string;
  productPrice: number;
  attachmentKey: string;
  attachmentName: string;
  attachmentType: string;
  status: string;
  contractValue: number;
  createdAt: string;
};

type OrderProduct = { id: string; orderId: string; name: string; quantity: number; price: number; amount: number; createdAt: string };
type OrderVendor = { id: string; orderId: string; vendorId: string; productId: string; productName: string; productType: ProductType; pricingBasis: PricingBasis; unitRate: number; quantity: number; measurement: number; rentalDays: number; amount: number; notes: string; createdAt: string };

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
  vendorId: string;
  description: string;
  expenseDate: string;
  amount: number;
  paymentMode: string;
  receiptKey: string;
  receiptName: string;
  fundingSource?: ExpenseFundingSource;
  paymentAccountId?: string;
  paymentAccountName?: string;
  status?: string;
  approvedAt?: string;
  approvedBy?: string;
  disapprovedAt?: string;
  disapprovedBy?: string;
  reimbursedAmount?: number;
  createdAt: string;
};

type Payment = {
  id: string;
  orderId: string;
  manualOrderId: string;
  personId: string;
  vendorId: string;
  invoiceId: string;
  customerId: string;
  direction: string;
  amount: number;
  paymentDate: string;
  method: string;
  reference: string;
  notes: string;
  paymentAccountId?: string;
  paymentAccountName?: string;
  receiptKey?: string;
  receiptName?: string;
  createdAt: string;
};

type Collections = {
  customers: Collection<Customer>;
  persons: Collection<Person>;
  vendors: Collection<Vendor>;
  vendorProducts: Collection<VendorProduct>;
  orders: Collection<Order>;
  orderProducts: Collection<OrderProduct>;
  orderVendors: Collection<OrderVendor>;
  invoices: Collection<Invoice>;
  expenses: Collection<Expense>;
  expenseCategories: Collection<ExpenseCategoryRecord>;
  paymentAccounts: Collection<PaymentAccountRecord>;
  payments: Collection<Payment>;
};

const now = () => new Date().toISOString();
const clean = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
const positiveInteger = (value: unknown) => Math.max(1, Math.round(Number(value) || 1));

type PaymentAllocation = { orderId: string; amount: number };
type OrderProductInput = { name: string; quantity: number; price: number };
type VendorAssignmentInput = { vendorId: string; productName: string; amount: number; notes: string };

function orderProductInputs(payload: Payload): OrderProductInput[] {
  let raw: unknown = payload.products;
  if (typeof raw === "string" && raw.trim()) {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as Payload;
    return { name: clean(row.name), quantity: money(row.quantity), price: money(row.price) };
  }).filter((item) => item.name || item.quantity || item.price);
}

function vendorAssignments(payload: Payload): VendorAssignmentInput[] {
  let raw: unknown = payload.vendorAssignments;
  if (typeof raw === "string" && raw.trim()) {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const row = item as Payload;
    return { vendorId: clean(row.vendorId), productName: clean(row.productName), amount: money(row.amount), notes: clean(row.notes) };
  }).filter((item) => item.vendorId || item.productName || item.amount);
}

function paymentAllocations(payload: Payload): PaymentAllocation[] {
  let raw: unknown = payload.allocations;
  if (typeof raw === "string" && raw.trim()) {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => ({ orderId: clean((item as Payload).orderId), amount: money((item as Payload).amount) })).filter((item) => item.orderId && item.orderId !== "__manual__" && item.amount);
  }
  const orderId = clean(payload.orderId);
  const amount = money(payload.amount);
  return orderId && orderId !== "__manual__" && amount ? [{ orderId, amount }] : [];
}

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

function validTime(value: unknown) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean(value));
}

function asBoolean(value: unknown) {
  return value === true || ["true", "on", "1"].includes(clean(value).toLowerCase());
}

function orderScheduleError(payload: Payload, pickupFromGodown: boolean) {
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
    vendors: db.collection<Vendor>("vendors"),
    vendorProducts: db.collection<VendorProduct>("vendor_products"),
    orders: db.collection<Order>("orders"),
    orderProducts: db.collection<OrderProduct>("order_products"),
    orderVendors: db.collection<OrderVendor>("order_vendors"),
    invoices: db.collection<Invoice>("invoices"),
    expenses: db.collection<Expense>("expenses"),
    expenseCategories: db.collection<ExpenseCategoryRecord>("expense_categories"),
    paymentAccounts: db.collection<PaymentAccountRecord>("payment_accounts"),
    payments: db.collection<Payment>("payments"),
  };
}

function ensureMongoIndexes(collections: Collections) {
  if (!mongoIndexesPromise) {
    mongoIndexesPromise = Promise.all([
      collections.customers.createIndex({ createdAt: -1 }),
      collections.persons.createIndex({ createdAt: -1 }),
      collections.vendors.createIndex({ name: 1 }),
      collections.vendorProducts.createIndex({ vendorId: 1, name: 1 }, { unique: true }),
      collections.orders.createIndex({ orderNo: 1 }, { unique: true }),
      collections.orders.createIndex({ customerId: 1 }),
      collections.orderProducts.createIndex({ orderId: 1 }),
      collections.orderVendors.createIndex({ orderId: 1 }),
      collections.orderVendors.createIndex({ vendorId: 1 }),
      collections.invoices.createIndex({ invoiceNo: 1 }, { unique: true }),
      collections.invoices.createIndex({ customerId: 1 }),
      collections.invoices.createIndex({ orderId: 1 }),
      collections.invoices.createIndex({ dueDate: 1 }),
      collections.expenses.createIndex({ expenseNo: 1 }, { unique: true }),
      collections.expenses.createIndex({ orderId: 1 }),
      collections.expenses.createIndex({ expenseDate: -1 }),
      collections.expenseCategories.createIndex({ nameKey: 1 }, { unique: true }),
      collections.paymentAccounts.createIndex({ nameKey: 1 }, { unique: true }),
      ...DEFAULT_PAYMENT_ACCOUNTS.map((account) => collections.paymentAccounts.updateOne(
        { id: account.id },
        { $setOnInsert: { id: account.id, name: account.name, nameKey: paymentAccountKey(account.name), status: "Active", createdAt: now() } },
        { upsert: true },
      )),
      collections.payments.createIndex({ customerId: 1 }),
      collections.payments.createIndex({ orderId: 1 }),
      collections.payments.createIndex({ personId: 1 }),
      collections.payments.createIndex({ vendorId: 1 }),
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
  return { client, collections };
}

async function findById<T extends { id: string }>(
  collection: Collection<T>,
  id: string,
) {
  return collection.findOne({ id } as Filter<T>, { projection: { _id: 0 } });
}

async function findSessionPerson(collections: Collections, context: RequestContext) {
  const people = await collections.persons.find({ status: "Active" }, { projection: { _id: 0 } }).toArray();
  const personId = resolveUserPersonId(people, {
    personId: context.userPersonId,
    name: context.userName,
    email: context.userEmail,
    role: context.userRole,
  });
  return people.find((person) => person.id === personId);
}

export async function GET() {
  try {
    const { collections } = await getMongoDatabase();
    const options = { projection: { _id: 0 } };
    const [customers, persons, vendors, vendorProducts, orders, orderProducts, orderVendors, invoices, expenses, expenseCategories, paymentAccounts, payments] = await Promise.all([
      collections.customers.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.persons.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.vendors.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.vendorProducts.find({ status: { $ne: "Deleted" } }, options).sort({ createdAt: -1 }).toArray(),
      collections.orders.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.orderProducts.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.orderVendors.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.invoices.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.expenses.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.expenseCategories.find({ status: "Active" }, options).sort({ name: 1 }).toArray(),
      collections.paymentAccounts.find({ status: "Active" }, options).sort({ name: 1 }).toArray(),
      collections.payments.find({}, options).sort({ createdAt: -1 }).toArray(),
    ]);
    const orderByInvoice = new Map(invoices.map((invoice) => [invoice.id, invoice.orderId]));
    const normalizedPayments = payments.map((payment) => ({
      ...payment,
      orderId: payment.orderId || orderByInvoice.get(payment.invoiceId) || "",
      manualOrderId: payment.manualOrderId || "",
      personId: payment.personId || "",
      vendorId: payment.vendorId || "",
    }));
    const normalizedOrders = orders.map((order) => ({
      ...order,
      deliveryAddress: order.deliveryAddress || "",
      deliveryDate: order.deliveryDate || order.eventDate,
      deliveryTime: order.deliveryTime || "",
      pickupDate: order.pickupDate || order.eventDate,
      pickupTime: order.pickupTime || "",
      pickupAddress: order.pickupAddress || "",
      pickupFromGodown: Boolean(order.pickupFromGodown),
      contactPerson: order.contactPerson || "",
      contactPhone: order.contactPhone || "",
      productName: order.productName || "",
      productPrice: order.productPrice || 0,
      attachmentKey: order.attachmentKey || "",
      attachmentName: order.attachmentName || "",
      attachmentType: order.attachmentType || "",
      supervisorIds: orderSupervisorIds(order),
    }));
    return Response.json({ customers, persons, vendors, vendorProducts, orders: normalizedOrders, orderProducts, orderVendors, invoices, expenses, expenseCategories, paymentAccounts, payments: normalizedPayments });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load records" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RequestContext = { userRole: "admin", userPersonId: "", userName: "", userEmail: "" }) {
  try {
    const body = (await request.json()) as { type?: string; payload?: Payload };
    const type = clean(body.type);
    const payload = body.payload ?? {};
    const userRole = context.userRole;
    const { client, collections } = await getMongoDatabase();
    const createdAt = now();

    if (type === "customer") {
      const missing = required(payload, ["name", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const row: Customer = {
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
      await collections.customers.insertOne(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "person") {
      const missing = required(payload, ["name", "role", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const orderId = clean(payload.orderId);
      if (userRole === "supervisor") {
        const supervisorPerson = await findSessionPerson(collections, context);
        if (!supervisorPerson) throw new FormError("Add an active People record with your name and Supervisor role");
        const ownedOrder = await collections.orders.findOne({ id: orderId }, { projection: { _id: 0 } });
        if (!ownedOrder || !isOrderSupervisor(ownedOrder, supervisorPerson.id) || !isActiveOrder(ownedOrder)) throw new FormError("Supervisor actions require an active assigned order");
      }
      const row: Person = {
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
      await collections.persons.insertOne(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "vendor") {
      const missing = required(payload, ["name", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const row: Vendor = { id: crypto.randomUUID(), name: clean(payload.name), contactPerson: clean(payload.contactPerson), phone: clean(payload.phone), email: clean(payload.email), gstin: clean(payload.gstin), address: clean(payload.address), paymentMode: clean(payload.paymentMode) || "Bank transfer", status: "Active", createdAt };
      await collections.vendors.insertOne(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "vendorProduct") {
      const missing = required(payload, ["vendorId", "name", "productType", "pricingBasis", "rentalCharge"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const vendorId = clean(payload.vendorId);
      const pricingBasis = clean(payload.pricingBasis);
      const productType = clean(payload.productType);
      const rentalCharge = money(payload.rentalCharge);
      const vendor = await findById(collections.vendors, vendorId);
      if (!vendor) throw new FormError("Select a valid vendor");
      if (!isProductType(productType)) throw new FormError("Select quantity-wise, length-wise or area-based pricing");
      if (!["Per day", "Per event"].includes(pricingBasis)) throw new FormError("Select per-day or per-event pricing");
      if (!rentalCharge) throw new FormError("Rental charge must be greater than zero");
      const row: VendorProduct = { id: crypto.randomUUID(), vendorId, name: clean(payload.name), productType, pricingBasis: pricingBasis as PricingBasis, rentalCharge, status: "Active", createdAt };
      await collections.vendorProducts.insertOne(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "expenseCategory") {
      const name = clean(payload.name).replace(/\s+/g, " ");
      if (!name) throw new FormError("Category name is required");
      if (name.length > 60) throw new FormError("Category name must be 60 characters or fewer");
      if (isBuiltInExpenseCategory(name)) throw new FormError("That built-in category already exists");
      const nameKey = expenseCategoryKey(name);
      const existing = await collections.expenseCategories.findOne({ nameKey }, { projection: { _id: 0 } });
      if (existing?.status === "Active") throw new FormError("That category already exists");
      if (existing) {
        await collections.expenseCategories.updateOne({ id: existing.id }, { $set: { name, status: "Active" } });
        return Response.json({ record: { ...existing, name, status: "Active" } }, { status: 201 });
      }
      const row: ExpenseCategoryRecord = { id: crypto.randomUUID(), name, nameKey, status: "Active", createdAt };
      await collections.expenseCategories.insertOne(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "paymentAccount") {
      const name = clean(payload.name).replace(/\s+/g, " ");
      if (!name) throw new FormError("Account name is required");
      if (name.length > 80) throw new FormError("Account name must be 80 characters or fewer");
      const nameKey = paymentAccountKey(name);
      const existing = await collections.paymentAccounts.findOne({ nameKey }, { projection: { _id: 0 } });
      if (existing?.status === "Active") throw new FormError("That payment account already exists");
      if (existing) {
        await collections.paymentAccounts.updateOne({ id: existing.id }, { $set: { name, status: "Active" } });
        return Response.json({ record: { ...existing, name, status: "Active" } }, { status: 201 });
      }
      const row: PaymentAccountRecord = { id: crypto.randomUUID(), name, nameKey, status: "Active", createdAt };
      await collections.paymentAccounts.insertOne(row);
      return Response.json({ record: row }, { status: 201 });
    }

    if (type === "order") {
      const missing = required(payload, ["customerId", "eventDate"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["eventDate"])) {
        return Response.json({ error: "Enter a valid event or delivery date" }, { status: 400 });
      }
      const customerId = clean(payload.customerId);
      const sessionPerson = userRole === "sales" ? await findSessionPerson(collections, context) : undefined;
      const salespersonId = userRole === "sales" ? sessionPerson?.id ?? "" : clean(payload.salespersonId);
      const supervisorIds = normalizeSupervisorIds(payload.supervisorIds ?? payload.assignedPersonId);
      if (!supervisorIds.length) throw new FormError("Select at least one supervisor");
      const assignedPersonId = supervisorIds[0];
      if (!salespersonId && userRole === "sales") throw new FormError("Add an active People record with your name and Sales person role");
      if (!salespersonId) throw new FormError("salespersonId is required");
      const pickupFromGodown = asBoolean(payload.pickupFromGodown);
      const scheduleError = orderScheduleError(payload, pickupFromGodown);
      if (scheduleError) throw new FormError(scheduleError);
      const [customer, salesperson, assignedSupervisors] = await Promise.all([
        findById(collections.customers, customerId),
        findById(collections.persons, salespersonId),
        Promise.all(supervisorIds.map((supervisorId) => findById(collections.persons, supervisorId))),
      ]);
      if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
      if (!salesperson) throw new FormError("Select a valid salesperson from the team");
      if (assignedSupervisors.some((person) => !person)) throw new FormError("Select valid supervisors from the team");
      if (salesperson.status !== "Active" || assignedSupervisors.some((person) => person?.status !== "Active")) throw new FormError("Select active team members for the order");
      if (!isOrderTeamPerson(salesperson, "salesperson")) throw new FormError("Select a valid salesperson from People");
      if (assignedSupervisors.some((person) => !isOrderTeamPerson(person!, "supervisor"))) throw new FormError("Select valid supervisors from People");
      const contractValue = money(payload.contractValue);
      if (!contractValue) {
        return Response.json({ error: "Order value must be greater than zero" }, { status: 400 });
      }
      const advancePayment = money(payload.advancePayment);
      if (advancePayment > contractValue) throw new FormError("Advance payment cannot exceed the order value");
      if (advancePayment && (invalidDate(payload, ["advancePaymentDate"]) || !clean(payload.advancePaymentMethod))) {
        throw new FormError("Enter the advance payment date and method");
      }
      const products = orderProductInputs(payload);
      if (products.some((item) => !item.name || !item.quantity || !item.price)) {
        throw new FormError("Complete the product name, quantity and price for every product");
      }
      const firstProduct = products[0];
      const row: Order = {
        id: crypto.randomUUID(),
        orderNo: clean(payload.orderNo) || `ORD-${Date.now().toString().slice(-6)}`,
        title: clean(payload.title),
        customerId,
        salespersonId,
        assignedPersonId,
        supervisorIds,
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
      if (assignments.some((item) => !item.vendorId || !item.productName || !item.amount)) throw new FormError("Complete the vendor, product and amount for every assignment");
      const uniqueVendorIds = [...new Set(assignments.map((item) => item.vendorId))];
      const validVendorCount = uniqueVendorIds.length ? await collections.vendors.countDocuments({ id: { $in: uniqueVendorIds } }) : 0;
      if (validVendorCount !== uniqueVendorIds.length) throw new FormError("Select valid vendors for the order");
      const productRows: OrderProduct[] = products.map((product) => ({ id: crypto.randomUUID(), orderId: row.id, ...product, amount: product.quantity * product.price, createdAt }));
      const assignmentRows = assignments.map((assignment) => ({ id: crypto.randomUUID(), orderId: row.id, productId: "", productType: "Quantity-wise" as const, pricingBasis: "Per event" as const, unitRate: assignment.amount, quantity: 1, measurement: 1, rentalDays: 1, ...assignment, createdAt }));
      const advanceRow: Payment | null = advancePayment ? {
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
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          await collections.orders.insertOne(row, { session });
          if (productRows.length) await collections.orderProducts.insertMany(productRows, { session });
          if (assignmentRows.length) await collections.orderVendors.insertMany(assignmentRows, { session });
          if (advanceRow) await collections.payments.insertOne(advanceRow, { session });
        });
      } finally {
        await session.endSession();
      }
      return Response.json({ record: row, payment: advanceRow }, { status: 201 });
    }

    if (type === "orderVendor") {
      const missing = required(payload, ["orderId", "vendorId", "productId"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const orderId = clean(payload.orderId); const vendorId = clean(payload.vendorId); const productId = clean(payload.productId);
      const [order, vendor, product] = await Promise.all([findById(collections.orders, orderId), findById(collections.vendors, vendorId), findById(collections.vendorProducts, productId)]);
      if (!order) throw new FormError("Select a valid order"); if (!vendor) throw new FormError("Select a valid vendor");
      if (!isActiveOrder(order)) throw new FormError("Vendor products can only be assigned to active orders");
      if (!product || product.vendorId !== vendorId) throw new FormError("Select a product listed by this vendor");
      if (userRole === "supervisor") {
        const supervisorPerson = await findSessionPerson(collections, context);
        if (!supervisorPerson) throw new FormError("Add an active People record with your name and Supervisor role");
        if (!isOrderSupervisor(order, supervisorPerson.id) || !isActiveOrder(order)) throw new FormError("Supervisor actions require an active assigned order");
      }
      const productType = isProductType(product.productType) ? product.productType : "Quantity-wise";
      const measurement = normalizeMeasurement(payload.measurement ?? payload.quantity, productType);
      if (!measurement) throw new FormError(`Enter a valid ${productType === "Quantity-wise" ? "quantity" : productType === "Length-wise" ? "length" : "area"}`);
      const quantity = productType === "Quantity-wise" ? Math.round(measurement) : 1;
      const rentalDays = product.pricingBasis === "Per day" ? positiveInteger(payload.rentalDays) : 1;
      const calculatedAmount = calculateTentativeCost(product.rentalCharge, product.pricingBasis, measurement, rentalDays);
      const requestedAmount = money(payload.amount);
      const amount = userRole === "supervisor" ? calculatedAmount : requestedAmount || calculatedAmount;
      const productName = product.name;
      const assignment = { productId, productName, productType, pricingBasis: product.pricingBasis, unitRate: product.rentalCharge, quantity, measurement, rentalDays, amount, notes: clean(payload.notes) };
      const existing = await collections.orderVendors.findOne({ orderId, productId });
      if (existing && userRole !== "supervisor") {
        await collections.orderVendors.updateOne({ id: existing.id }, { $set: assignment });
        return Response.json({ record: { ...existing, ...assignment } });
      }
      if (existing) return Response.json({ record: { ...existing, amount: 0, unitRate: 0 } });
      const row: OrderVendor = { id: crypto.randomUUID(), orderId, vendorId, ...assignment, createdAt };
      await collections.orderVendors.insertOne(row);
      const visibleRow = userRole === "supervisor" ? { ...row, amount: 0, unitRate: 0 } : row;
      return Response.json({ record: visibleRow }, { status: 201 });
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
      const missing = required(payload, userRole === "supervisor" ? ["orderId", "category", "expenseDate", "amount"] : ["orderId", "personId", "category", "expenseDate", "amount"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["expenseDate"])) {
        return Response.json({ error: "Enter a valid expense date" }, { status: 400 });
      }
      const orderId = clean(payload.orderId);
      const category = clean(payload.category);
      const customCategories = await collections.expenseCategories.find({ status: "Active" }, { projection: { _id: 0, name: 1 } }).toArray();
      if (!isAllowedExpenseCategory(category, customCategories.map((item) => item.name))) {
        return Response.json({ error: "Select a valid expense category" }, { status: 400 });
      }
      let personId = clean(payload.personId);
      if (userRole === "supervisor") {
        const supervisorPerson = await findSessionPerson(collections, context);
        if (!supervisorPerson) throw new FormError("Add an active People record with your name and Supervisor role");
        if (personId && personId !== supervisorPerson.id) {
          throw new FormError("Supervisor expenses are assigned to your People role automatically");
        }
        if (clean(payload.vendorId) || clean(payload.vendor)) {
          throw new FormError("Vendor or payee cannot be recorded on an expense");
        }
        const ownedOrder = await collections.orders.findOne({ id: orderId }, { projection: { _id: 0 } });
        if (!ownedOrder || !isOrderSupervisor(ownedOrder, supervisorPerson.id) || !isActiveOrder(ownedOrder)) throw new FormError("Supervisor actions require an active assigned order");
        personId = supervisorPerson.id;
      }
      const [order, person] = await Promise.all([
        findById(collections.orders, orderId),
        findById(collections.persons, personId),
      ]);
      if (!order) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (!person) {
        return Response.json({ error: "Select a valid responsible person" }, { status: 400 });
      }
      if (userRole !== "supervisor" && !isExpenseResponsiblePerson(person, order)) {
        throw new FormError("Responsible person must be an active salesperson, one of this order's assigned supervisors, or an active manager");
      }
      const amount = money(payload.amount);
      if (!amount) {
        return Response.json({ error: "Expense amount must be greater than zero" }, { status: 400 });
      }
      const rawFundingSource = clean(payload.fundingSource);
      if (rawFundingSource && !["Reimbursement", "Account"].includes(rawFundingSource)) throw new FormError("Select a valid expense funding source");
      const fundingSource = expenseFundingSource(rawFundingSource);
      const paymentAccountId = fundingSource === "Account" ? clean(payload.paymentAccountId) : "";
      const paymentAccount = paymentAccountId
        ? await collections.paymentAccounts.findOne({ id: paymentAccountId, status: "Active" }, { projection: { _id: 0 } })
        : null;
      if (fundingSource === "Account" && !paymentAccount) throw new FormError("Select an active company payment account");
      const row: Expense = {
        id: crypto.randomUUID(),
        expenseNo: createExpenseNumber(new Date(createdAt)),
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
        fundingSource,
        paymentAccountId,
        paymentAccountName: paymentAccount?.name || "",
        status: fundingSource === "Account" ? "Approved" : "Pending approval",
        reimbursedAmount: 0,
        createdAt,
      };
      await collections.expenses.insertOne(row);
      return Response.json({ record: { ...row, expenseNo: "" } }, { status: 201 });
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
      const amount = money(payload.amount);
      if (!amount) {
        return Response.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
      }
      const paymentAccountId = clean(payload.paymentAccountId);
      const paymentAccount = paymentAccountId
        ? await collections.paymentAccounts.findOne({ id: paymentAccountId, status: "Active" }, { projection: { _id: 0 } })
        : null;
      if (!paymentAccount) throw new FormError("Select an active payment account");

      const personId = "";
      const customerId = direction === "Received" ? clean(payload.customerId) : "";
      const vendorId = direction === "Paid" ? clean(payload.vendorId) : "";
      const rawManualOrderId = clean(payload.manualOrderId);
      const manualOrderId = direction === "Received" ? rawManualOrderId : "";
      const allocations = paymentAllocations(payload);
      if (rawManualOrderId && direction !== "Received") throw new FormError("Manual Order ID is only available for customer receipts");
      if (manualOrderId && allocations.length) throw new FormError("Choose either a listed order or a manual Order ID");
      if (!manualOrderId && !allocations.length) throw new FormError("Select at least one order or enter a manual Order ID");
      if (new Set(allocations.map((item) => item.orderId)).size !== allocations.length) throw new FormError("Each order can only be selected once");
      if (direction === "Received" && !customerId) {
        throw new FormError("Select the customer");
      }
      if (direction === "Paid" && !vendorId) {
        throw new FormError("Select the vendor or payee");
      }
      if (customerId && !await findById(collections.customers, customerId)) throw new FormError("Select a valid customer");
      if (vendorId && !await findById(collections.vendors, vendorId)) throw new FormError("Select a valid vendor or payee");
      if (!manualOrderId && allocations.reduce((sum, item) => sum + item.amount, 0) !== amount) throw new FormError("Allocation total must equal the payment amount");
      const linkedOrders = await Promise.all(allocations.map((allocation) => findById(collections.orders, allocation.orderId)));
      if (linkedOrders.some((order) => !order)) throw new FormError("Select valid orders");
      if (direction === "Received" && linkedOrders.some((order) => order!.customerId !== customerId)) throw new FormError("Customer receipts can only use orders belonging to the selected customer");
      if (direction === "Paid") {
        const assignedOrderIds = await collections.orderVendors.distinct("orderId", { orderId: { $in: allocations.map((item) => item.orderId) }, vendorId });
        if (assignedOrderIds.length !== allocations.length) throw new FormError("Vendor is not assigned to every selected order");
      }
      const rows: Payment[] = (manualOrderId ? [{ orderId: "", amount }] : allocations).map((allocation, index) => ({
        id: crypto.randomUUID(), orderId: allocation.orderId, manualOrderId, personId, vendorId, invoiceId: "", customerId: direction === "Received" ? customerId : linkedOrders[index]!.customerId, direction, amount: allocation.amount,
        paymentDate: clean(payload.paymentDate), method: clean(payload.method), reference: clean(payload.reference), notes: clean(payload.notes), paymentAccountId, paymentAccountName: paymentAccount.name, receiptKey: clean(payload.receiptKey), receiptName: clean(payload.receiptName), createdAt,
      }));
      await collections.payments.insertMany(rows);
      return Response.json({ records: rows }, { status: 201 });
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

export async function PATCH(request: Request, context: RequestContext = { userRole: "admin", userPersonId: "", userName: "", userEmail: "" }) {
  try {
    const body = (await request.json()) as { type?: string; id?: string; payload?: Payload };
    const type = clean(body.type);
    const id = clean(body.id);
    const payload = body.payload ?? {};
    if (!id || !["customer", "vendor", "order", "payment", "vendorProduct", "paymentAccount"].includes(type)) {
      return Response.json({ error: "Select a valid record to edit" }, { status: 400 });
    }
    const userRole = context.userRole;
    if (type === "order" && !["admin", "supervisor", "sales"].includes(userRole)) {
      return Response.json({ error: "Only an administrator, assigned salesperson or assigned supervisor can edit orders" }, { status: 403 });
    }
    const requestedDirection = clean(payload.direction);
    const canEditPayment = requestedDirection === "Received"
      ? ["admin", "accountant", "sales"].includes(userRole)
      : requestedDirection === "Paid" && ["admin", "accountant"].includes(userRole);
    if (type === "payment" && !canEditPayment) {
      return Response.json({ error: "Your role cannot edit this payment" }, { status: 403 });
    }
    if (type === "vendorProduct" && !["admin", "accountant"].includes(userRole)) {
      return Response.json({ error: "Your role cannot edit vendor products" }, { status: 403 });
    }
    if (type === "vendor" && !canEditVendorProfile(userRole)) {
      return Response.json({ error: "Your role cannot edit vendor profiles" }, { status: 403 });
    }
    if (type === "customer" && !canEditCustomerProfile(userRole)) {
      return Response.json({ error: "Your role cannot edit customer profiles" }, { status: 403 });
    }
    if (type === "paymentAccount" && userRole !== "admin") {
      return Response.json({ error: "Only administrators can edit payment accounts" }, { status: 403 });
    }

    const { client, collections } = await getMongoDatabase();

    if (type === "customer") {
      const missing = required(payload, ["name", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const existingCustomer = await findById(collections.customers, id);
      if (!existingCustomer) return Response.json({ error: "Customer not found" }, { status: 404 });
      const updates = {
        name: clean(payload.name),
        businessName: clean(payload.businessName),
        phone: clean(payload.phone),
        email: clean(payload.email).toLowerCase(),
        gstin: clean(payload.gstin),
        address: clean(payload.address),
        openingBalance: Math.round(Number(payload.openingBalance) || 0),
      };
      await collections.customers.updateOne({ id }, { $set: updates });
      return Response.json({ record: { ...existingCustomer, ...updates } });
    }

    if (type === "vendor") {
      const missing = required(payload, ["name", "phone"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const existingVendor = await findById(collections.vendors, id);
      if (!existingVendor) return Response.json({ error: "Vendor not found" }, { status: 404 });
      const updates = {
        name: clean(payload.name),
        contactPerson: clean(payload.contactPerson),
        phone: clean(payload.phone),
        email: clean(payload.email).toLowerCase(),
        gstin: clean(payload.gstin),
        address: clean(payload.address),
        paymentMode: clean(payload.paymentMode) || "Bank transfer",
      };
      await collections.vendors.updateOne({ id }, { $set: updates });
      return Response.json({ record: { ...existingVendor, ...updates } });
    }

    if (type === "vendorProduct") {
      const missing = required(payload, ["vendorId", "name", "productType", "pricingBasis", "rentalCharge"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      const vendorId = clean(payload.vendorId);
      const productType = clean(payload.productType);
      const pricingBasis = clean(payload.pricingBasis);
      const rentalCharge = money(payload.rentalCharge);
      const [existingProduct, vendor] = await Promise.all([
        collections.vendorProducts.findOne({ id, status: { $ne: "Deleted" } }, { projection: { _id: 0 } }),
        findById(collections.vendors, vendorId),
      ]);
      if (!existingProduct) return Response.json({ error: "Vendor product not found" }, { status: 404 });
      if (!vendor) throw new FormError("Select a valid vendor");
      if (!isProductType(productType)) throw new FormError("Select quantity-wise, length-wise or area-based pricing");
      if (!["Per day", "Per event"].includes(pricingBasis)) throw new FormError("Select per-day or per-event pricing");
      if (!rentalCharge) throw new FormError("Rental charge must be greater than zero");
      const updates = { vendorId, name: clean(payload.name), productType, pricingBasis: pricingBasis as PricingBasis, rentalCharge };
      await collections.vendorProducts.updateOne({ id }, { $set: updates });
      return Response.json({ record: { ...existingProduct, ...updates } });
    }

    if (type === "paymentAccount") {
      const name = clean(payload.name).replace(/\s+/g, " ");
      if (!name) throw new FormError("Account name is required");
      if (name.length > 80) throw new FormError("Account name must be 80 characters or fewer");
      const existingAccount = await collections.paymentAccounts.findOne({ id, status: "Active" }, { projection: { _id: 0 } });
      if (!existingAccount) return Response.json({ error: "Payment account not found" }, { status: 404 });
      const nameKey = paymentAccountKey(name);
      const duplicate = await collections.paymentAccounts.findOne({ nameKey, id: { $ne: id } }, { projection: { _id: 0, id: 1 } });
      if (duplicate) throw new FormError("That payment account already exists");
      const updates = { name, nameKey };
      await collections.paymentAccounts.updateOne({ id }, { $set: updates });
      return Response.json({ record: { ...existingAccount, ...updates } });
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
      const paymentAccountId = clean(payload.paymentAccountId);
      const amount = money(payload.amount);
      if (rawManualOrderId && direction !== "Received") throw new FormError("Manual Order ID is only available for customer receipts");
      if (manualOrderId && clean(payload.orderId) && clean(payload.orderId) !== "__manual__") throw new FormError("Choose either a listed order or a manual Order ID");
      if (!manualOrderId && (!orderId || orderId === "__manual__")) throw new FormError("Select an order or enter a manual Order ID");
      if (!amount) return Response.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
      const [existingPayment, order, customer, vendor, paymentAccount] = await Promise.all([
        findById(collections.payments, id),
        orderId ? findById(collections.orders, orderId) : Promise.resolve(null),
        customerId ? findById(collections.customers, customerId) : Promise.resolve(null),
        vendorId ? findById(collections.vendors, vendorId) : Promise.resolve(null),
        paymentAccountId ? collections.paymentAccounts.findOne({ id: paymentAccountId, status: "Active" }, { projection: { _id: 0 } }) : Promise.resolve(null),
      ]);
      if (!existingPayment) return Response.json({ error: "Payment not found" }, { status: 404 });
      if (!paymentAccount) return Response.json({ error: "Select an active payment account" }, { status: 400 });
      if (userRole === "sales" && existingPayment.direction !== "Received") return Response.json({ error: "Your role cannot edit this payment" }, { status: 403 });
      if (!manualOrderId && !order) return Response.json({ error: "Select a valid order" }, { status: 400 });
      if (direction === "Received") {
        if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
        if (order && order.customerId !== customerId) return Response.json({ error: "Customer receipts can only use orders belonging to the selected customer" }, { status: 400 });
      } else {
        if (!vendor) return Response.json({ error: "Select a valid vendor or payee" }, { status: 400 });
        const assignment = await collections.orderVendors.findOne({ orderId, vendorId });
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
        paymentAccountId,
        paymentAccountName: paymentAccount.name,
        receiptKey: clean(payload.receiptKey) || existingPayment.receiptKey || "",
        receiptName: clean(payload.receiptName) || existingPayment.receiptName || "",
      };
      await collections.payments.updateOne({ id }, { $set: updates });
      return Response.json({ record: { ...existingPayment, ...updates } });
    }

    const missing = required(payload, userRole === "supervisor" ? ["eventDate"] : userRole === "sales" ? ["orderNo", "customerId", "eventDate"] : ["orderNo", "customerId", "salespersonId", "eventDate"]);
    if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
    if (invalidDate(payload, ["eventDate"])) {
      return Response.json({ error: "Enter a valid event or delivery date" }, { status: 400 });
    }
    const pickupFromGodown = asBoolean(payload.pickupFromGodown);
    const scheduleError = orderScheduleError(payload, pickupFromGodown);
    if (scheduleError) throw new FormError(scheduleError);

    const customerId = clean(payload.customerId);
    const sessionPerson = userRole === "sales" ? await findSessionPerson(collections, context) : undefined;
    const salespersonId = userRole === "sales" ? sessionPerson?.id ?? "" : clean(payload.salespersonId);
    const supervisorIds = normalizeSupervisorIds(payload.supervisorIds ?? payload.assignedPersonId);
    const assignedPersonId = supervisorIds[0] || "";
    const [existingOrder, customer, salesperson, assignedSupervisors] = await Promise.all([
      findById(collections.orders, id),
      findById(collections.customers, customerId),
      findById(collections.persons, salespersonId),
      Promise.all(supervisorIds.map((supervisorId) => findById(collections.persons, supervisorId))),
    ]);
    if (!existingOrder) return Response.json({ error: "Order not found" }, { status: 404 });
    if (existingOrder.status === ARCHIVED_ORDER_STATUS) return Response.json({ error: "Archived orders cannot be edited" }, { status: 403 });
    if (existingOrder.status === "Completed" && userRole !== "admin") {
      return Response.json({ error: "Only an administrator can edit a completed order" }, { status: 403 });
    }
    if (userRole === "supervisor") {
      const supervisorPerson = await findSessionPerson(collections, context);
      if (!supervisorPerson) throw new FormError("Add an active People record with your name and Supervisor role");
      if (!isOrderSupervisor(existingOrder, supervisorPerson.id) || !isActiveOrder(existingOrder)) throw new FormError("Supervisor actions require an active assigned order");
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
      await collections.orders.updateOne({ id }, { $set: updates });
      return Response.json({ record: { ...existingOrder, ...updates, salespersonId: existingOrder.salespersonId, assignedPersonId: existingOrder.assignedPersonId, supervisorIds: orderSupervisorIds(existingOrder), contractValue: 0 } });
    }
    if (userRole === "sales" && (!salespersonId || existingOrder.salespersonId !== salespersonId)) {
      return Response.json({ error: "Salespeople can only edit orders assigned to their People role" }, { status: 403 });
    }
    if (!customer) throw new FormError("Select a valid customer");
    if (!salesperson) throw new FormError("Select a valid salesperson from the team");
    if (!supervisorIds.length) throw new FormError("Select at least one supervisor");
    if (assignedSupervisors.some((person) => !person)) throw new FormError("Select valid supervisors from the team");
    if (salesperson.status !== "Active" || assignedSupervisors.some((person) => person?.status !== "Active")) throw new FormError("Select active team members for the order");
    if (!isOrderTeamPerson(salesperson, "salesperson")) throw new FormError("Select a valid salesperson from People");
    if (assignedSupervisors.some((person) => !isOrderTeamPerson(person!, "supervisor"))) throw new FormError("Select valid supervisors from People");
    const contractValue = money(payload.contractValue);
    if (!contractValue) throw new FormError("Order value must be greater than zero");
    const products = orderProductInputs(payload);
    if (products.some((item) => !item.name || !item.quantity || !item.price)) {
      throw new FormError("Complete the product name, quantity and price for every product");
    }
    const assignments = userRole === "admin" ? vendorAssignments(payload) : [];
    if (assignments.some((item) => !item.vendorId || !item.productName || !item.amount)) {
      throw new FormError("Complete the vendor, product and amount for every assignment");
    }
    if (userRole === "admin") {
      const uniqueVendorIds = [...new Set(assignments.map((item) => item.vendorId))];
      const validVendorCount = uniqueVendorIds.length ? await collections.vendors.countDocuments({ id: { $in: uniqueVendorIds } }) : 0;
      if (validVendorCount !== uniqueVendorIds.length) throw new FormError("Select valid vendors for the order");
    }
    const firstProduct = products[0];

    const updates = {
      orderNo: clean(payload.orderNo),
      title: clean(payload.title),
      customerId,
      salespersonId,
      assignedPersonId,
      supervisorIds,
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
    const productRows: OrderProduct[] = products.map((product) => ({ id: crypto.randomUUID(), orderId: id, ...product, amount: product.quantity * product.price, createdAt: now() }));
    const assignmentRows: OrderVendor[] = assignments.map((assignment) => ({ id: crypto.randomUUID(), orderId: id, productId: "", productType: "Quantity-wise", pricingBasis: "Per event", unitRate: assignment.amount, quantity: 1, measurement: 1, rentalDays: 1, ...assignment, createdAt: now() }));
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await collections.orders.updateOne({ id }, { $set: updates }, { session });
        await collections.orderProducts.deleteMany({ orderId: id }, { session });
        if (productRows.length) await collections.orderProducts.insertMany(productRows, { session });
        if (userRole === "admin") {
          await collections.orderVendors.deleteMany({ orderId: id }, { session });
          if (assignmentRows.length) await collections.orderVendors.insertMany(assignmentRows, { session });
        }
      });
    } finally {
      await session.endSession();
    }
    return Response.json({ record: { ...existingOrder, ...updates } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update record";
    const friendly =
      error instanceof MongoServerError && error.code === 11000
        ? "That reference already exists"
        : message;
    return Response.json({ error: friendly }, { status: error instanceof FormError ? 400 : 500 });
  }
}

export async function DELETE(request: Request, context: RequestContext = { userRole: "admin", userPersonId: "", userName: "", userEmail: "" }) {
  try {
    const body = (await request.json()) as { type?: string; id?: string };
    const type = clean(body.type);
    const id = clean(body.id);
    if (!id || !["order", "orderVendor", "vendorProduct", "expenseCategory", "paymentAccount"].includes(type)) return Response.json({ error: "Select a valid record to delete" }, { status: 400 });
    if (type === "order" && context.userRole !== "admin") return Response.json({ error: "Only administrators can delete orders" }, { status: 403 });
    if (type === "orderVendor" && !["admin", "accountant"].includes(context.userRole)) return Response.json({ error: "Your role cannot remove vendor assignments" }, { status: 403 });
    if (type === "vendorProduct" && !["admin", "accountant"].includes(context.userRole)) return Response.json({ error: "Your role cannot delete vendor products" }, { status: 403 });
    if (type === "expenseCategory" && context.userRole !== "admin") return Response.json({ error: "Only administrators can delete expense categories" }, { status: 403 });
    if (type === "paymentAccount" && context.userRole !== "admin") return Response.json({ error: "Only administrators can delete payment accounts" }, { status: 403 });
    const { collections } = await getMongoDatabase();
    if (type === "order") {
      const order = await collections.orders.findOne({ id }, { projection: { _id: 0 } });
      if (!order) return Response.json({ error: "Order not found" }, { status: 404 });
      if (order.status === ARCHIVED_ORDER_STATUS) return Response.json({ error: "Order is already in history" }, { status: 409 });
      await collections.orders.updateOne({ id }, { $set: { status: ARCHIVED_ORDER_STATUS } });
      return Response.json({ record: { ...order, status: ARCHIVED_ORDER_STATUS } });
    }
    if (type === "orderVendor") {
      const assignment = await collections.orderVendors.findOne({ id }, { projection: { _id: 0 } });
      if (!assignment) return Response.json({ error: "Vendor assignment not found" }, { status: 404 });
      await collections.orderVendors.deleteOne({ id });
      return Response.json({ record: assignment });
    }
    if (type === "expenseCategory") {
      const category = await collections.expenseCategories.findOne({ id, status: "Active" }, { projection: { _id: 0 } });
      if (!category) return Response.json({ error: "Expense category not found" }, { status: 404 });
      await collections.expenseCategories.updateOne({ id }, { $set: { status: "Deleted" } });
      return Response.json({ record: { ...category, status: "Deleted" } });
    }
    if (type === "paymentAccount") {
      const account = await collections.paymentAccounts.findOne({ id, status: "Active" }, { projection: { _id: 0 } });
      if (!account) return Response.json({ error: "Payment account not found" }, { status: 404 });
      await collections.paymentAccounts.updateOne({ id }, { $set: { status: "Deleted" } });
      return Response.json({ record: { ...account, status: "Deleted" } });
    }
    const product = await collections.vendorProducts.findOne({ id, status: { $ne: "Deleted" } }, { projection: { _id: 0 } });
    if (!product) return Response.json({ error: "Vendor product not found" }, { status: 404 });
    const updates = { name: `${product.name} [deleted ${id.slice(0, 8)}]`, status: "Deleted" };
    await collections.vendorProducts.updateOne({ id }, { $set: updates });
    return Response.json({ record: { ...product, status: "Deleted" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to delete vendor product" }, { status: 500 });
  }
}

class FormError extends Error {}
