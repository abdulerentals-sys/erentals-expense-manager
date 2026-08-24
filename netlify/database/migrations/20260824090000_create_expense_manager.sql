CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  gstin TEXT NOT NULL,
  address TEXT NOT NULL,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  payment_mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT NOT NULL
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  assigned_person_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  event_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Planned',
  contract_value INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  billed_person_id TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Sent',
  notes TEXT NOT NULL DEFAULT '',
  attachment_key TEXT NOT NULL DEFAULT '',
  attachment_name TEXT NOT NULL DEFAULT '',
  attachment_type TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  expense_no TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  category TEXT NOT NULL,
  vendor TEXT NOT NULL,
  description TEXT NOT NULL,
  expense_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payment_mode TEXT NOT NULL,
  receipt_key TEXT NOT NULL DEFAULT '',
  receipt_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL DEFAULT '',
  customer_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payment_date TEXT NOT NULL,
  method TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX orders_customer_id_idx ON orders (customer_id);
CREATE INDEX invoices_customer_id_idx ON invoices (customer_id);
CREATE INDEX invoices_order_id_idx ON invoices (order_id);
CREATE INDEX expenses_order_id_idx ON expenses (order_id);
CREATE INDEX payments_customer_id_idx ON payments (customer_id);

