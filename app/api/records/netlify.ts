import { getDatabase } from "@netlify/database";

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

const now = () => new Date().toISOString();
const clean = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));

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

export async function GET() {
  try {
    const { sql } = getDatabase();
    const [customers, persons, orders, invoices, expenses, payments] = await Promise.all([
      sql<Customer>`SELECT
        id, name, business_name AS "businessName", phone, email, gstin, address,
        opening_balance AS "openingBalance", created_at AS "createdAt"
        FROM customers ORDER BY created_at DESC`,
      sql<Person>`SELECT
        id, name, role, phone, email, payment_mode AS "paymentMode", status,
        created_at AS "createdAt"
        FROM persons ORDER BY created_at DESC`,
      sql<Order>`SELECT
        id, order_no AS "orderNo", title, customer_id AS "customerId",
        assigned_person_id AS "assignedPersonId", venue, event_date AS "eventDate",
        status, contract_value AS "contractValue", created_at AS "createdAt"
        FROM orders ORDER BY created_at DESC`,
      sql<Invoice>`SELECT
        id, invoice_no AS "invoiceNo", customer_id AS "customerId", order_id AS "orderId",
        billed_person_id AS "billedPersonId", issue_date AS "issueDate", due_date AS "dueDate",
        subtotal, tax, total, paid_amount AS "paidAmount", status, notes,
        attachment_key AS "attachmentKey", attachment_name AS "attachmentName",
        attachment_type AS "attachmentType", created_at AS "createdAt"
        FROM invoices ORDER BY created_at DESC`,
      sql<Expense>`SELECT
        id, expense_no AS "expenseNo", order_id AS "orderId", person_id AS "personId",
        category, vendor, description, expense_date AS "expenseDate", amount,
        payment_mode AS "paymentMode", receipt_key AS "receiptKey",
        receipt_name AS "receiptName", created_at AS "createdAt"
        FROM expenses ORDER BY created_at DESC`,
      sql<Payment>`SELECT
        id, invoice_id AS "invoiceId", customer_id AS "customerId", direction, amount,
        payment_date AS "paymentDate", method, reference, notes, created_at AS "createdAt"
        FROM payments ORDER BY created_at DESC`,
    ]);

    return Response.json({ customers, persons, orders, invoices, expenses, payments });
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
    const { sql } = getDatabase();
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
      await sql`INSERT INTO customers
        (id, name, business_name, phone, email, gstin, address, opening_balance, created_at)
        VALUES (${row.id}, ${row.name}, ${row.businessName}, ${row.phone}, ${row.email},
          ${row.gstin}, ${row.address}, ${row.openingBalance}, ${row.createdAt})`;
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
      await sql`INSERT INTO persons
        (id, name, role, phone, email, payment_mode, status, created_at)
        VALUES (${row.id}, ${row.name}, ${row.role}, ${row.phone}, ${row.email},
          ${row.paymentMode}, ${row.status}, ${row.createdAt})`;
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
        sql<{ id: string }>`SELECT id FROM customers WHERE id = ${customerId} LIMIT 1`,
        sql<{ id: string }>`SELECT id FROM persons WHERE id = ${assignedPersonId} LIMIT 1`,
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
      await sql`INSERT INTO orders
        (id, order_no, title, customer_id, assigned_person_id, venue, event_date, status,
          contract_value, created_at)
        VALUES (${row.id}, ${row.orderNo}, ${row.title}, ${row.customerId},
          ${row.assignedPersonId}, ${row.venue}, ${row.eventDate}, ${row.status},
          ${row.contractValue}, ${row.createdAt})`;
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
      const [[customer], [order], [billedPerson]] = await Promise.all([
        sql<{ id: string }>`SELECT id FROM customers WHERE id = ${customerId} LIMIT 1`,
        sql<{ id: string; customerId: string }>`SELECT id, customer_id AS "customerId"
          FROM orders WHERE id = ${orderId} LIMIT 1`,
        sql<{ id: string }>`SELECT id FROM persons WHERE id = ${billedPersonId} LIMIT 1`,
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
      await sql`INSERT INTO invoices
        (id, invoice_no, customer_id, order_id, billed_person_id, issue_date, due_date,
          subtotal, tax, total, paid_amount, status, notes, attachment_key, attachment_name,
          attachment_type, created_at)
        VALUES (${row.id}, ${row.invoiceNo}, ${row.customerId}, ${row.orderId},
          ${row.billedPersonId}, ${row.issueDate}, ${row.dueDate}, ${row.subtotal}, ${row.tax},
          ${row.total}, ${row.paidAmount}, ${row.status}, ${row.notes}, ${row.attachmentKey},
          ${row.attachmentName}, ${row.attachmentType}, ${row.createdAt})`;
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
        sql<{ id: string }>`SELECT id FROM orders WHERE id = ${orderId} LIMIT 1`,
        sql<{ id: string }>`SELECT id FROM persons WHERE id = ${personId} LIMIT 1`,
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
      await sql`INSERT INTO expenses
        (id, expense_no, order_id, person_id, category, vendor, description, expense_date,
          amount, payment_mode, receipt_key, receipt_name, created_at)
        VALUES (${row.id}, ${row.expenseNo}, ${row.orderId}, ${row.personId}, ${row.category},
          ${row.vendor}, ${row.description}, ${row.expenseDate}, ${row.amount},
          ${row.paymentMode}, ${row.receiptKey}, ${row.receiptName}, ${row.createdAt})`;
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
      const invoiceId = clean(payload.invoiceId);
      let customerId = clean(payload.customerId);
      let linkedInvoice: Pick<Invoice, "id" | "customerId" | "total" | "paidAmount"> | undefined;
      if (invoiceId) {
        [linkedInvoice] = await sql<Pick<Invoice, "id" | "customerId" | "total" | "paidAmount">>`
          SELECT id, customer_id AS "customerId", total, paid_amount AS "paidAmount"
          FROM invoices WHERE id = ${invoiceId} LIMIT 1`;
        if (!linkedInvoice) {
          return Response.json({ error: "Select a valid invoice" }, { status: 400 });
        }
        if (direction !== "Received") {
          return Response.json(
            { error: "Only received payments can be linked to a sales invoice" },
            { status: 400 },
          );
        }
        customerId = linkedInvoice.customerId;
      }
      if (customerId) {
        const [customer] = await sql<{ id: string }>`SELECT id FROM customers
          WHERE id = ${customerId} LIMIT 1`;
        if (!customer) {
          return Response.json({ error: "Select a valid customer" }, { status: 400 });
        }
      }
      if (direction === "Received" && !customerId) {
        return Response.json(
          { error: "Select a customer or invoice for money received" },
          { status: 400 },
        );
      }
      const amount = money(payload.amount);
      if (!amount) {
        return Response.json({ error: "Payment amount must be greater than zero" }, { status: 400 });
      }
      if (linkedInvoice && amount > linkedInvoice.total - linkedInvoice.paidAmount) {
        return Response.json(
          { error: "Payment is greater than the invoice balance" },
          { status: 400 },
        );
      }
      const row: Payment = {
        id: crypto.randomUUID(),
        invoiceId,
        customerId,
        direction,
        amount,
        paymentDate: clean(payload.paymentDate),
        method: clean(payload.method),
        reference: clean(payload.reference),
        notes: clean(payload.notes),
        createdAt,
      };
      await sql`INSERT INTO payments
        (id, invoice_id, customer_id, direction, amount, payment_date, method, reference,
          notes, created_at)
        VALUES (${row.id}, ${row.invoiceId}, ${row.customerId}, ${row.direction}, ${row.amount},
          ${row.paymentDate}, ${row.method}, ${row.reference}, ${row.notes}, ${row.createdAt})`;

      if (linkedInvoice) {
        const paidAmount = linkedInvoice.paidAmount + row.amount;
        const status = paidAmount >= linkedInvoice.total ? "Paid" : "Part paid";
        await sql`UPDATE invoices SET paid_amount = ${paidAmount}, status = ${status}
          WHERE id = ${linkedInvoice.id}`;
      }
      return Response.json({ record: row }, { status: 201 });
    }

    return Response.json({ error: "Unsupported record type" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save record";
    const code = (error as { code?: string }).code;
    const friendly =
      code === "23505" || message.toLowerCase().includes("duplicate key")
        ? "That reference number already exists"
        : message;
    return Response.json({ error: friendly }, { status: 500 });
  }
}
