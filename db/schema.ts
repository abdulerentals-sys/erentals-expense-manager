import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull(),
  status: text("status").notNull().default("Active"),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  businessName: text("business_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  gstin: text("gstin").notNull(),
  address: text("address").notNull(),
  openingBalance: integer("opening_balance").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const persons = sqliteTable("persons", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  paymentMode: text("payment_mode").notNull(),
  status: text("status").notNull().default("Active"),
  orderId: text("order_id").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  contactPerson: text("contact_person").notNull().default(""),
  phone: text("phone").notNull(),
  email: text("email").notNull().default(""),
  gstin: text("gstin").notNull().default(""),
  address: text("address").notNull().default(""),
  paymentMode: text("payment_mode").notNull().default("Bank transfer"),
  status: text("status").notNull().default("Active"),
  createdAt: text("created_at").notNull(),
});

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  orderNo: text("order_no").notNull().unique(),
  title: text("title").notNull(),
  customerId: text("customer_id").notNull(),
  salespersonId: text("salesperson_id").notNull().default(""),
  assignedPersonId: text("assigned_person_id").notNull(),
  venue: text("venue").notNull(),
  eventDate: text("event_date").notNull(),
  status: text("status").notNull().default("Planned"),
  contractValue: integer("contract_value").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const orderVendors = sqliteTable("order_vendors", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  vendorId: text("vendor_id").notNull(),
  productName: text("product_name").notNull(),
  amount: integer("amount").notNull(),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const invoices = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  invoiceNo: text("invoice_no").notNull().unique(),
  customerId: text("customer_id").notNull(),
  orderId: text("order_id").notNull(),
  billedPersonId: text("billed_person_id").notNull(),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date").notNull(),
  subtotal: integer("subtotal").notNull(),
  tax: integer("tax").notNull().default(0),
  total: integer("total").notNull(),
  paidAmount: integer("paid_amount").notNull().default(0),
  status: text("status").notNull().default("Sent"),
  notes: text("notes").notNull().default(""),
  attachmentKey: text("attachment_key").notNull().default(""),
  attachmentName: text("attachment_name").notNull().default(""),
  attachmentType: text("attachment_type").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const expenses = sqliteTable("expenses", {
  id: text("id").primaryKey(),
  expenseNo: text("expense_no").notNull().unique(),
  orderId: text("order_id").notNull(),
  personId: text("person_id").notNull(),
  category: text("category").notNull(),
  vendor: text("vendor").notNull(),
  vendorId: text("vendor_id").notNull().default(""),
  description: text("description").notNull(),
  expenseDate: text("expense_date").notNull(),
  amount: integer("amount").notNull(),
  paymentMode: text("payment_mode").notNull(),
  receiptKey: text("receipt_key").notNull().default(""),
  receiptName: text("receipt_name").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().default(""),
  personId: text("person_id").notNull().default(""),
  vendorId: text("vendor_id").notNull().default(""),
  invoiceId: text("invoice_id").notNull().default(""),
  customerId: text("customer_id").notNull().default(""),
  direction: text("direction").notNull(),
  amount: integer("amount").notNull(),
  paymentDate: text("payment_date").notNull(),
  method: text("method").notNull(),
  reference: text("reference").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull(),
});
