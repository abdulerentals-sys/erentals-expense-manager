import { env } from "cloudflare:workers";

let schemaReady: Promise<void> | null = null;

export function ensureSchema() {
  if (schemaReady) return schemaReady;

  schemaReady = (async () => {
    const d1 = env.DB;
    if (!d1) throw new Error("Database storage is unavailable");
    await d1.batch([
      d1.prepare("CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY NOT NULL, name text NOT NULL, email text NOT NULL, person_id text DEFAULT '' NOT NULL, role text NOT NULL, status text DEFAULT 'Active' NOT NULL, password_hash text NOT NULL, must_change_password integer DEFAULT 1 NOT NULL, created_at text NOT NULL, updated_at text NOT NULL)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS customers (id text PRIMARY KEY NOT NULL, name text NOT NULL, business_name text NOT NULL, phone text NOT NULL, email text NOT NULL, gstin text NOT NULL, address text NOT NULL, opening_balance integer DEFAULT 0 NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS persons (id text PRIMARY KEY NOT NULL, name text NOT NULL, role text NOT NULL, phone text NOT NULL, email text NOT NULL, payment_mode text NOT NULL, status text DEFAULT 'Active' NOT NULL, order_id text DEFAULT '' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS vendors (id text PRIMARY KEY NOT NULL, name text NOT NULL, contact_person text NOT NULL, phone text NOT NULL, email text NOT NULL, gstin text NOT NULL, address text NOT NULL, payment_mode text NOT NULL, status text DEFAULT 'Active' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS vendor_products (id text PRIMARY KEY NOT NULL, vendor_id text NOT NULL, name text NOT NULL, product_type text DEFAULT 'Quantity-wise' NOT NULL, pricing_basis text NOT NULL, rental_charge integer NOT NULL, status text DEFAULT 'Active' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS orders (id text PRIMARY KEY NOT NULL, order_no text NOT NULL, title text NOT NULL, customer_id text NOT NULL, salesperson_id text DEFAULT '' NOT NULL, assigned_person_id text NOT NULL, venue text NOT NULL, event_date text NOT NULL, delivery_address text DEFAULT '' NOT NULL, delivery_date text DEFAULT '' NOT NULL, delivery_time text DEFAULT '' NOT NULL, pickup_date text DEFAULT '' NOT NULL, pickup_time text DEFAULT '' NOT NULL, pickup_address text DEFAULT '' NOT NULL, pickup_from_godown integer DEFAULT 0 NOT NULL, contact_person text DEFAULT '' NOT NULL, contact_phone text DEFAULT '' NOT NULL, product_name text DEFAULT '' NOT NULL, product_price integer DEFAULT 0 NOT NULL, attachment_key text DEFAULT '' NOT NULL, attachment_name text DEFAULT '' NOT NULL, attachment_type text DEFAULT '' NOT NULL, status text DEFAULT 'Planned' NOT NULL, contract_value integer DEFAULT 0 NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS orders_order_no_unique ON orders (order_no)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS order_vendors (id text PRIMARY KEY NOT NULL, order_id text NOT NULL, vendor_id text NOT NULL, product_id text DEFAULT '' NOT NULL, product_name text NOT NULL, product_type text DEFAULT 'Quantity-wise' NOT NULL, pricing_basis text DEFAULT 'Per event' NOT NULL, unit_rate integer DEFAULT 0 NOT NULL, quantity integer DEFAULT 1 NOT NULL, measurement real DEFAULT 1 NOT NULL, rental_days integer DEFAULT 1 NOT NULL, amount integer NOT NULL, notes text DEFAULT '' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS invoices (id text PRIMARY KEY NOT NULL, invoice_no text NOT NULL, customer_id text NOT NULL, order_id text NOT NULL, billed_person_id text NOT NULL, issue_date text NOT NULL, due_date text NOT NULL, subtotal integer NOT NULL, tax integer DEFAULT 0 NOT NULL, total integer NOT NULL, paid_amount integer DEFAULT 0 NOT NULL, status text DEFAULT 'Sent' NOT NULL, notes text DEFAULT '' NOT NULL, attachment_key text DEFAULT '' NOT NULL, attachment_name text DEFAULT '' NOT NULL, attachment_type text DEFAULT '' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_no_unique ON invoices (invoice_no)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS expenses (id text PRIMARY KEY NOT NULL, expense_no text NOT NULL, order_id text NOT NULL, person_id text NOT NULL, vendor_id text DEFAULT '' NOT NULL, category text NOT NULL, vendor text NOT NULL, description text NOT NULL, expense_date text NOT NULL, amount integer NOT NULL, payment_mode text NOT NULL, receipt_key text DEFAULT '' NOT NULL, receipt_name text DEFAULT '' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS expenses_expense_no_unique ON expenses (expense_no)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS expense_categories (id text PRIMARY KEY NOT NULL, name text NOT NULL, name_key text NOT NULL, status text DEFAULT 'Active' NOT NULL, created_at text NOT NULL)"),
      d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_name_key_unique ON expense_categories (name_key)"),
      d1.prepare("CREATE TABLE IF NOT EXISTS payments (id text PRIMARY KEY NOT NULL, order_id text DEFAULT '' NOT NULL, manual_order_id text DEFAULT '' NOT NULL, person_id text DEFAULT '' NOT NULL, vendor_id text DEFAULT '' NOT NULL, invoice_id text DEFAULT '' NOT NULL, customer_id text DEFAULT '' NOT NULL, direction text NOT NULL, amount integer NOT NULL, payment_date text NOT NULL, method text NOT NULL, reference text DEFAULT '' NOT NULL, notes text DEFAULT '' NOT NULL, created_at text NOT NULL)"),
    ]);

    const paymentColumns = await d1.prepare("PRAGMA table_info(payments)").all<{ name: string }>();
    const names = new Set((paymentColumns.results ?? []).map((column) => column.name));
    if (!names.has("order_id")) {
      await d1.prepare("ALTER TABLE payments ADD COLUMN order_id text DEFAULT '' NOT NULL").run();
    }
    if (!names.has("manual_order_id")) {
      await d1.prepare("ALTER TABLE payments ADD COLUMN manual_order_id text DEFAULT '' NOT NULL").run();
    }
    if (!names.has("person_id")) {
      await d1.prepare("ALTER TABLE payments ADD COLUMN person_id text DEFAULT '' NOT NULL").run();
    }
    if (!names.has("vendor_id")) {
      await d1.prepare("ALTER TABLE payments ADD COLUMN vendor_id text DEFAULT '' NOT NULL").run();
    }
    const expenseColumns = await d1.prepare("PRAGMA table_info(expenses)").all<{ name: string }>();
    const expenseNames = new Set((expenseColumns.results ?? []).map((column) => column.name));
    if (!expenseNames.has("vendor_id")) {
      await d1.prepare("ALTER TABLE expenses ADD COLUMN vendor_id text DEFAULT '' NOT NULL").run();
    }
    const personColumns = await d1.prepare("PRAGMA table_info(persons)").all<{ name: string }>();
    const personNames = new Set((personColumns.results ?? []).map((column) => column.name));
    if (!personNames.has("order_id")) {
      await d1.prepare("ALTER TABLE persons ADD COLUMN order_id text DEFAULT '' NOT NULL").run();
    }
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });

  return schemaReady;
}
