import { env } from "cloudflare:workers";

let schemaReady: Promise<void> | null = null;

export function ensureSchema() {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const d1 = env.DB;
    if (!d1) throw new Error("Database storage is unavailable");
    await d1.batch([
      d1.prepare("CREATE TABLE IF NOT EXISTS customers (id text PRIMARY KEY NOT NULL, name text NOT NULL, business_name text NOT NULL, phone text NOT NULL, email text NOT NULL, gstin text NOT NULL, address text NOT NULL, opening_balance integer DEFAULT 0 NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS persons (id text PRIMARY KEY NOT NULL, name text NOT NULL, role text NOT NULL, phone text NOT NULL, email text NOT NULL, payment_mode text NOT NULL, status text DEFAULT 'Active' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS orders (id text PRIMARY KEY NOT NULL, order_no text NOT NULL, title text NOT NULL, customer_id text NOT NULL, assigned_person_id text NOT NULL, venue text NOT NULL, event_date text NOT NULL, status text DEFAULT 'Planned' NOT NULL, contract_value integer DEFAULT 0 NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS orders_order_no_unique ON orders (order_no)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS invoices (id text PRIMARY KEY NOT NULL, invoice_no text NOT NULL, customer_id text NOT NULL, order_id text NOT NULL, billed_person_id text NOT NULL, issue_date text NOT NULL, due_date text NOT NULL, subtotal integer NOT NULL, tax integer DEFAULT 0 NOT NULL, total integer NOT NULL, paid_amount integer DEFAULT 0 NOT NULL, status text DEFAULT 'Sent' NOT NULL, notes text DEFAULT '' NOT NULL, attachment_key text DEFAULT '' NOT NULL, attachment_name text DEFAULT '' NOT NULL, attachment_type text DEFAULT '' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_no_unique ON invoices (invoice_no)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS expenses (id text PRIMARY KEY NOT NULL, expense_no text NOT NULL, order_id text NOT NULL, person_id text NOT NULL, category text NOT NULL, vendor text NOT NULL, description text NOT NULL, expense_date text NOT NULL, amount integer NOT NULL, payment_mode text NOT NULL, receipt_key text DEFAULT '' NOT NULL, receipt_name text DEFAULT '' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS expenses_expense_no_unique ON expenses (expense_no)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS payments (id text PRIMARY KEY NOT NULL, invoice_id text DEFAULT '' NOT NULL, customer_id text DEFAULT '' NOT NULL, direction text NOT NULL, amount integer NOT NULL, payment_date text NOT NULL, method text NOT NULL, reference text DEFAULT '' NOT NULL, notes text DEFAULT '' NOT NULL, created_at text NOT NULL)"),
    ]);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}
