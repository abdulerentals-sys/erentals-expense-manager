import {
  Db,
  MongoClient,
  MongoServerError,
  type Collection,
  type Filter,
} from "mongodb";
import { isOrderTeamPerson, type TeamAssignment } from "../../auth/team";
import { isAllowedExpenseCategory, isExpenseResponsiblePerson } from "../../expense-rules";
import { calculateTentativeCost, isProductType, normalizeMeasurement, type PricingBasis, type ProductType } from "../../vendor-pricing";

type Payload = Record<string, unknown>;
type RequestContext = { userRole: string; userPersonId: string; userEmail: string; teamAssignments: TeamAssignment[] };

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

type Order = {
  id: string;
  orderNo: string;
  title: string;
  customerId: string;
  salespersonId: string;
  assignedPersonId: string;
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
    const siteMissing = required(payload, ["deliveryAddress", "pickupAddress", "contactPerson", "contactPhone"]);
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

async function findSupervisorPerson(collections: Collections, context: RequestContext) {
  if (context.userPersonId) return findById(collections.persons, context.userPersonId);
  return collections.persons.findOne({ email: context.userEmail }, { collation: { locale: "en", strength: 2 } });
}

export async function GET() {
  try {
    const { collections } = await getMongoDatabase();
    const options = { projection: { _id: 0 } };
    const [customers, persons, vendors, vendorProducts, orders, orderProducts, orderVendors, invoices, expenses, payments] = await Promise.all([
      collections.customers.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.persons.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.vendors.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.vendorProducts.find({ status: { $ne: "Deleted" } }, options).sort({ createdAt: -1 }).toArray(),
      collections.orders.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.orderProducts.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.orderVendors.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.invoices.find({}, options).sort({ createdAt: -1 }).toArray(),
      collections.expenses.find({}, options).sort({ createdAt: -1 }).toArray(),
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
    }));
    return Response.json({ customers, persons, vendors, vendorProducts, orders: normalizedOrders, orderProducts, orderVendors, invoices, expenses, payments: normalizedPayments });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load records" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: RequestContext = { userRole: "admin", userPersonId: "", userEmail: "", teamAssignments: [] }) {
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
        const supervisorPerson = await findSupervisorPerson(collections, context);
        if (!supervisorPerson) throw new FormError("Supervisor profile is not linked to a Person record");
        const ownedOrder = await collections.orders.findOne({ id: orderId, assignedPersonId: supervisorPerson.id, status: { $nin: ["Completed", "Cancelled"] } });
        if (!ownedOrder) throw new FormError("Supervisor actions require an active assigned order");
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

    if (type === "order") {
      const missing = required(payload, ["customerId", "assignedPersonId", "eventDate"]);
      if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
      if (invalidDate(payload, ["eventDate"])) {
        return Response.json({ error: "Enter a valid event or delivery date" }, { status: 400 });
      }
      const customerId = clean(payload.customerId);
      const salespersonId = userRole === "sales" ? context.userPersonId : clean(payload.salespersonId);
      const assignedPersonId = clean(payload.assignedPersonId);
      if (!salespersonId && userRole === "sales") throw new FormError("Sales dashboard is not linked to a People record");
      if (!salespersonId) throw new FormError("salespersonId is required");
      const pickupFromGodown = asBoolean(payload.pickupFromGodown);
      const scheduleError = orderScheduleError(payload, pickupFromGodown);
      if (scheduleError) throw new FormError(scheduleError);
      const [customer, salesperson, assignedPerson] = await Promise.all([
        findById(collections.customers, customerId),
        findById(collections.persons, salespersonId),
        findById(collections.persons, assignedPersonId),
      ]);
      if (!customer) return Response.json({ error: "Select a valid customer" }, { status: 400 });
      if (!salesperson) throw new FormError("Select a valid salesperson from the team");
      if (!assignedPerson) throw new FormError("Select a valid supervisor from the team");
      if (salesperson.status !== "Active" || assignedPerson.status !== "Active") throw new FormError("Select active team members for the order");
      if (!isOrderTeamPerson(salesperson, "salesperson", context.teamAssignments)) throw new FormError("Select a valid salesperson from the team");
      if (!isOrderTeamPerson(assignedPerson, "supervisor", context.teamAssignments)) throw new FormError("Select a valid supervisor from the team");
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
      if (!product || product.vendorId !== vendorId) throw new FormError("Select a product listed by this vendor");
      if (userRole === "supervisor") {
        const supervisorPerson = await findSupervisorPerson(collections, context);
        if (!supervisorPerson) throw new FormError("Supervisor profile is not linked to a Person record");
        const ownedOrder = await collections.orders.findOne({ id: orderId, assignedPersonId: supervisorPerson.id, status: { $nin: ["Completed", "Cancelled"] } });
        if (!ownedOrder) throw new FormError("Supervisor actions require an active assigned order");
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
      if (!isAllowedExpenseCategory(category)) {
        return Response.json({ error: "Select a valid expense category" }, { status: 400 });
      }
      let personId = clean(payload.personId);
      if (userRole === "supervisor") {
        const supervisorPerson = await findSupervisorPerson(collections, context);
        if (!supervisorPerson) throw new FormError("Supervisor profile is not linked to a Person record");
        if (personId && personId !== supervisorPerson.id) {
          throw new FormError("Supervisor expenses are assigned to your linked Person record");
        }
        if (clean(payload.vendorId) || clean(payload.vendor)) {
          throw new FormError("Vendor or payee cannot be recorded on an expense");
        }
        const ownedOrder = await collections.orders.findOne({ id: orderId, assignedPersonId: supervisorPerson.id, status: { $nin: ["Completed", "Cancelled"] } });
        if (!ownedOrder) throw new FormError("Supervisor actions require an active assigned order");
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
        throw new FormError("Responsible person must be an active salesperson, this order's assigned supervisor, or an active manager");
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
      await collections.expenses.insertOne(row);
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
      const amount = money(payload.amount);
      if (!amount) {
        return Response.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
      }

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
        paymentDate: clean(payload.paymentDate), method: clean(payload.method), reference: clean(payload.reference), notes: clean(payload.notes), createdAt,
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

export async function PATCH(request: Request, context: RequestContext = { userRole: "admin", userPersonId: "", userEmail: "", teamAssignments: [] }) {
  try {
    const body = (await request.json()) as { type?: string; id?: string; payload?: Payload };
    const type = clean(body.type);
    const id = clean(body.id);
    const payload = body.payload ?? {};
    if (!id || !["order", "payment", "vendorProduct"].includes(type)) {
      return Response.json({ error: "Select a valid record to edit" }, { status: 400 });
    }
    const userRole = context.userRole;
    if (type === "order" && !["admin", "supervisor"].includes(userRole)) {
      return Response.json({ error: "Only an administrator or the assigned supervisor can edit orders" }, { status: 403 });
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

    const { client, collections } = await getMongoDatabase();

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
      if (rawManualOrderId && direction !== "Received") throw new FormError("Manual Order ID is only available for customer receipts");
      if (manualOrderId && clean(payload.orderId) && clean(payload.orderId) !== "__manual__") throw new FormError("Choose either a listed order or a manual Order ID");
      if (!manualOrderId && (!orderId || orderId === "__manual__")) throw new FormError("Select an order or enter a manual Order ID");
      if (!amount) return Response.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
      const [existingPayment, order, customer, vendor] = await Promise.all([
        findById(collections.payments, id),
        orderId ? findById(collections.orders, orderId) : Promise.resolve(null),
        customerId ? findById(collections.customers, customerId) : Promise.resolve(null),
        vendorId ? findById(collections.vendors, vendorId) : Promise.resolve(null),
      ]);
      if (!existingPayment) return Response.json({ error: "Payment not found" }, { status: 404 });
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
      };
      await collections.payments.updateOne({ id }, { $set: updates });
      return Response.json({ record: { ...existingPayment, ...updates } });
    }

    const missing = required(payload, userRole === "supervisor" ? ["eventDate"] : ["orderNo", "customerId", "salespersonId", "assignedPersonId", "eventDate"]);
    if (missing) return Response.json({ error: `${missing} is required` }, { status: 400 });
    if (invalidDate(payload, ["eventDate"])) {
      return Response.json({ error: "Enter a valid event or delivery date" }, { status: 400 });
    }
    const pickupFromGodown = asBoolean(payload.pickupFromGodown);
    const scheduleError = orderScheduleError(payload, pickupFromGodown);
    if (scheduleError) throw new FormError(scheduleError);

    const customerId = clean(payload.customerId);
    const salespersonId = clean(payload.salespersonId);
    const assignedPersonId = clean(payload.assignedPersonId);
    const [existingOrder, customer, salesperson, assignedPerson] = await Promise.all([
      findById(collections.orders, id),
      findById(collections.customers, customerId),
      findById(collections.persons, salespersonId),
      findById(collections.persons, assignedPersonId),
    ]);
    if (!existingOrder) return Response.json({ error: "Order not found" }, { status: 404 });
    if (userRole === "supervisor") {
      const supervisorPerson = await findSupervisorPerson(collections, context);
      if (!supervisorPerson) throw new FormError("Supervisor profile is not linked to a Person record");
      if (existingOrder.assignedPersonId !== supervisorPerson.id || ["Completed", "Cancelled"].includes(existingOrder.status)) throw new FormError("Supervisor actions require an active assigned order");
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
      return Response.json({ record: { ...existingOrder, ...updates, salespersonId: existingOrder.salespersonId, assignedPersonId: existingOrder.assignedPersonId, contractValue: 0 } });
    }
    if (!customer) throw new FormError("Select a valid customer");
    if (!salesperson) throw new FormError("Select a valid salesperson from the team");
    if (!assignedPerson) throw new FormError("Select a valid supervisor from the team");
    if (salesperson.status !== "Active" || assignedPerson.status !== "Active") throw new FormError("Select active team members for the order");
    if (!isOrderTeamPerson(salesperson, "salesperson", context.teamAssignments)) throw new FormError("Select a valid salesperson from the team");
    if (!isOrderTeamPerson(assignedPerson, "supervisor", context.teamAssignments)) throw new FormError("Select a valid supervisor from the team");
    const contractValue = money(payload.contractValue);
    if (!contractValue) throw new FormError("Order value must be greater than zero");
    const products = orderProductInputs(payload);
    if (products.some((item) => !item.name || !item.quantity || !item.price)) {
      throw new FormError("Complete the product name, quantity and price for every product");
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
    const productRows: OrderProduct[] = products.map((product) => ({ id: crypto.randomUUID(), orderId: id, ...product, amount: product.quantity * product.price, createdAt: now() }));
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await collections.orders.updateOne({ id }, { $set: updates }, { session });
        await collections.orderProducts.deleteMany({ orderId: id }, { session });
        if (productRows.length) await collections.orderProducts.insertMany(productRows, { session });
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

export async function DELETE(request: Request, context: RequestContext = { userRole: "admin", userPersonId: "", userEmail: "", teamAssignments: [] }) {
  try {
    if (!["admin", "accountant"].includes(context.userRole)) return Response.json({ error: "Your role cannot delete vendor products" }, { status: 403 });
    const body = (await request.json()) as { type?: string; id?: string };
    const id = clean(body.id);
    if (clean(body.type) !== "vendorProduct" || !id) return Response.json({ error: "Select a valid vendor product" }, { status: 400 });
    const { collections } = await getMongoDatabase();
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
