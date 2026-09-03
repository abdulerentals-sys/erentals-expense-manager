import { eq } from "drizzle-orm";
import { getSessionUser } from "../../auth/session";
import { resolveUserPersonId } from "../../auth/team";
import type { UserRole } from "../../auth/types";
import { ensureSchema } from "../../../db/ensure";
import { getDb } from "../../../db";
import { expenses, orders, paymentAccounts, persons, payments } from "../../../db/schema";
import { isOrderSupervisor, type OrderSupervisorFields } from "../../order-supervisors";
import { expenseFundingSource } from "../../payment-accounts";
import { canViewReimbursementSubmission, isLegacyReimbursementClaim, isReimbursementSubmission, reimbursementPending, reimbursementStatus } from "../../supervisor-expenses";

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
type ExpenseRow = { id: string; expenseNo: string; orderId: string; personId: string; category: string; vendor: string; description: string; expenseDate: string; amount: number; paymentMode: string; receiptKey: string; receiptName: string; fundingSource?: string; paymentAccountId?: string; paymentAccountName?: string; status?: string; reimbursedAmount?: number; submittedByUserId?: string; submittedByPersonId?: string; submittedByName?: string; submittedByRole?: string; claimantName?: string; claimantRole?: string; orderNoSnapshot?: string; orderTitleSnapshot?: string; createdAt?: string; [key: string]: unknown };
type OrderRow = OrderSupervisorFields & { id: string; orderNo: string; title: string; venue?: string; customerId?: string; contractValue: number; status?: string; [key: string]: unknown };
type PersonRow = { id: string; name: string; email: string; role: string; status: string; [key: string]: unknown };
type PaymentRow = { id: string; orderId: string; personId: string; expenseId?: string; direction: string; amount: number; paymentDate: string; method?: string; reference: string; notes: string; paymentAccountId?: string; paymentAccountName?: string; receiptKey?: string; receiptName?: string; [key: string]: unknown };

const now = () => new Date().toISOString();
const clean = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
const isNetlify = () => Boolean(process.env.MONGODB_URI?.trim());

function allowedAction(role: UserRole, action: string) {
  if (["approve", "reject"].includes(action)) return role === "admin";
  if (action === "paid") return ["admin", "accountant"].includes(role);
  return false;
}

function isLegacySupervisorExpense(expense: ExpenseRow, person: PersonRow | null | undefined) {
  return isLegacyReimbursementClaim(expense, person);
}

function isSubmittedReimbursement(expense: ExpenseRow, person: PersonRow | null | undefined) {
  return isReimbursementSubmission(expense, isLegacySupervisorExpense(expense, person));
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (user.mustChangePassword) return Response.json({ error: "Change your temporary password before using the dashboard" }, { status: 403 });
  if (!["admin", "accountant", "supervisor"].includes(user.role)) return Response.json({ error: "Your role cannot view reimbursements" }, { status: 403 });
  if (isNetlify()) return getMongoData(user);
  await ensureSchema();
  const db = getDb();
  const [expenseRows, orderRows, personRows, paymentRows] = await Promise.all([db.select().from(expenses), db.select().from(orders), db.select().from(persons), db.select().from(payments)]);
  return buildResponse(user, expenseRows as unknown as ExpenseRow[], orderRows as unknown as OrderRow[], personRows as unknown as PersonRow[], paymentRows as unknown as PaymentRow[]);
}

function buildResponse(user: SessionUser, expenseRows: ExpenseRow[], orderRows: OrderRow[], personRows: PersonRow[], paymentRows: PaymentRow[]) {
  const people = personRows.map((person) => ({ id: String(person.id), name: String(person.name), email: String(person.email), role: String(person.role), status: String(person.status) }));
  const currentPersonId = resolveUserPersonId(people, { personId: user.personId, name: user.name, email: user.email, role: user.role });
  const orderMap = new Map(orderRows.map((order) => [String(order.id), order]));
  const personMap = new Map(personRows.map((person) => [String(person.id), person]));
  const ownOrders = user.role === "supervisor" ? orderRows.filter((order) => isOrderSupervisor(order, currentPersonId)) : orderRows;
  const rows = expenseRows.filter((expense) => {
    const person = personMap.get(String(expense.personId));
    const legacySupervisorExpense = isLegacySupervisorExpense(expense, person);
    const legacyOwnExpense = legacySupervisorExpense
      && String(expense.personId) === String(currentPersonId);
    return canViewReimbursementSubmission(
      expense,
      { role: user.role, userId: user.id, personId: user.personId || currentPersonId },
      legacySupervisorExpense,
      legacyOwnExpense,
    );
  }).map((expense) => {
    const order = orderMap.get(String(expense.orderId));
    const person = personMap.get(String(expense.personId));
    const reimbursedAmount = money(expense.reimbursedAmount);
    return {
      ...expense,
      fundingSource: expenseFundingSource(expense.fundingSource),
      status: reimbursementStatus(expense.status, expense.amount, reimbursedAmount),
      reimbursedAmount,
      orderNo: clean(expense.orderNoSnapshot) || order?.orderNo || "",
      orderTitle: clean(expense.orderTitleSnapshot) || order?.title || order?.venue || "",
      supervisorId: String(expense.personId || ""),
      supervisorName: clean(expense.claimantName) || person?.name || "",
      claimantRole: clean(expense.claimantRole) || person?.role || "",
      submittedByUserId: clean(expense.submittedByUserId),
      submittedByPersonId: clean(expense.submittedByPersonId),
      submittedByName: clean(expense.submittedByName),
      submittedByRole: clean(expense.submittedByRole),
    };
  }).sort((a, b) => String(b.createdAt || b.expenseDate).localeCompare(String(a.createdAt || a.expenseDate)));
  const ownExpenseIds = new Set(rows.map((expense) => String(expense.id)).filter(Boolean));
  const ownClaimantIds = new Set(rows.map((expense) => String(expense.personId)).filter(Boolean));
  const reimbursementPayments = paymentRows.filter((payment) => ["Reimbursement", "Supervisor reimbursement"].includes(payment.direction)
    && (user.role !== "supervisor" || (clean(payment.expenseId) ? ownExpenseIds.has(clean(payment.expenseId)) : ownClaimantIds.has(String(payment.personId)))));
  return Response.json({ expenses: rows, orders: ownOrders.map((order) => ({ id: order.id, orderNo: order.orderNo, title: order.title, contractValue: user.role === "supervisor" ? 0 : order.contractValue })), payments: reimbursementPayments, supervisorId: currentPersonId || user.personId || "", supervisorName: personMap.get(currentPersonId || user.personId || "")?.name || user.name });
}

async function getMongoData(user: SessionUser) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI as string);
  await client.connect();
  try {
    const db = client.db();
    const [expenseRows, orderRows, personRows, paymentRows] = await Promise.all([db.collection<ExpenseRow>("expenses").find({}).toArray(), db.collection<OrderRow>("orders").find({}).toArray(), db.collection<PersonRow>("persons").find({}).toArray(), db.collection<PaymentRow>("payments").find({}).toArray()]);
    return buildResponse(user, expenseRows, orderRows, personRows, paymentRows);
  } finally { await client.close(); }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (user.mustChangePassword) return Response.json({ error: "Change your temporary password before using the dashboard" }, { status: 403 });
  let body: { action?: string; expenseId?: string; amount?: number; paymentAccountId?: string; method?: string; reference?: string; receiptKey?: string; receiptName?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  let action = clean(body.action);
  if (action === "disapprove") action = "reject";
  if (action === "reimburse") action = "paid";
  const expenseId = clean(body.expenseId);
  if (!allowedAction(user.role, action)) return Response.json({ error: "Your role cannot perform this action" }, { status: 403 });
  if (!expenseId) return Response.json({ error: "Expense ID is required" }, { status: 400 });
  if (isNetlify()) return mutateMongo(user, action, expenseId, money(body.amount), body);
  await ensureSchema();
  const db = getDb();
  const [expenseRows, personRows] = await Promise.all([
    db.select().from(expenses).where(eq(expenses.id, expenseId)),
    db.select().from(persons),
  ]);
  const expense = expenseRows[0];
  if (!expense) return Response.json({ error: "Expense not found" }, { status: 404 });
  const person = personRows.find((row) => String(row.id) === String(expense.personId));
  if (!isSubmittedReimbursement(expense as ExpenseRow, person as unknown as PersonRow | undefined)) return Response.json({ error: "Only reimbursement forms submitted by a supervisor or administrator can use this workflow" }, { status: 409 });
  const status = reimbursementStatus(expense.status, expense.amount, expense.reimbursedAmount);
  if (action === "approve" || action === "reject") {
    if (status !== "Pending approval") return Response.json({ error: `A ${status.toLowerCase()} reimbursement cannot be changed` }, { status: 409 });
    await db.update(expenses).set(action === "approve" ? { status: "Approved", approvedAt: now(), approvedBy: user.name, disapprovedAt: "", disapprovedBy: "" } : { status: "Rejected", disapprovedAt: now(), disapprovedBy: user.name }).where(eq(expenses.id, expenseId));
    return Response.json({ ok: true });
  }
  if (action === "paid" && status !== "Approved") return Response.json({ error: "Only approved reimbursements can be marked paid" }, { status: 409 });
  const pending = reimbursementPending(expense.amount, expense.reimbursedAmount);
  const requestedAmount = money(body.amount);
  if (requestedAmount && requestedAmount !== pending) return Response.json({ error: `Paid amount must equal the pending reimbursement of ${pending}` }, { status: 400 });
  const amount = pending;
  if (!amount) return Response.json({ error: "This reimbursement has already been paid" }, { status: 409 });
  const paymentAccountId = clean(body.paymentAccountId);
  const [paymentAccount] = paymentAccountId ? await db.select().from(paymentAccounts).where(eq(paymentAccounts.id, paymentAccountId)).limit(1) : [];
  if (!paymentAccount || paymentAccount.status !== "Active") return Response.json({ error: "Select an active reimbursement account" }, { status: 400 });
  const reimbursedAmount = money(expense.reimbursedAmount) + amount;
  await db.batch([db.update(expenses).set({ reimbursedAmount, status: "Paid" }).where(eq(expenses.id, expenseId)), db.insert(payments).values({ id: `reimbursement-${expenseId}`, orderId: expense.orderId, manualOrderId: "", personId: expense.personId, vendorId: "", invoiceId: "", expenseId, customerId: "", direction: "Reimbursement", amount, paymentDate: now().slice(0, 10), method: clean(body.method) || "Bank transfer", reference: clean(body.reference), notes: `Expense reimbursement ${expense.expenseNo}`, paymentAccountId, paymentAccountName: paymentAccount.name, receiptKey: clean(body.receiptKey), receiptName: clean(body.receiptName), createdAt: now() })]);
  return Response.json({ ok: true });
}

async function mutateMongo(user: SessionUser, action: string, expenseId: string, requestedAmount: number, body: { paymentAccountId?: string; method?: string; reference?: string; receiptKey?: string; receiptName?: string }) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI as string);
  await client.connect();
  try {
    const db = client.db();
    const expensesCollection = db.collection<ExpenseRow>("expenses");
    const personsCollection = db.collection<PersonRow>("persons");
    const paymentsCollection = db.collection<PaymentRow>("payments");
    const expense = await expensesCollection.findOne({ id: expenseId });
    if (!expense) return Response.json({ error: "Expense not found" }, { status: 404 });
    const person = await personsCollection.findOne({ id: expense.personId });
    if (!isSubmittedReimbursement(expense, person)) return Response.json({ error: "Only reimbursement forms submitted by a supervisor or administrator can use this workflow" }, { status: 409 });
    const status = reimbursementStatus(expense.status, Number(expense.amount), Number(expense.reimbursedAmount));
    if (action === "approve" || action === "reject") {
      if (status !== "Pending approval") return Response.json({ error: `A ${status.toLowerCase()} reimbursement cannot be changed` }, { status: 409 });
      await expensesCollection.updateOne({ id: expenseId }, { $set: action === "approve" ? { status: "Approved", approvedAt: now(), approvedBy: user.name, disapprovedAt: "", disapprovedBy: "" } : { status: "Rejected", disapprovedAt: now(), disapprovedBy: user.name } });
      return Response.json({ ok: true });
    }
    if (action === "paid" && status !== "Approved") return Response.json({ error: "Only approved reimbursements can be marked paid" }, { status: 409 });
    const pending = reimbursementPending(Number(expense.amount), Number(expense.reimbursedAmount));
    if (requestedAmount && requestedAmount !== pending) return Response.json({ error: `Paid amount must equal the pending reimbursement of ${pending}` }, { status: 400 });
    const amount = pending;
    if (!amount) return Response.json({ error: "This reimbursement has already been paid" }, { status: 409 });
    const paymentAccountId = clean(body.paymentAccountId);
    const paymentAccount = paymentAccountId ? await db.collection("payment_accounts").findOne({ id: paymentAccountId, status: "Active" }) : null;
    if (!paymentAccount) return Response.json({ error: "Select an active reimbursement account" }, { status: 400 });
    const reimbursedAmount = Number(expense.reimbursedAmount || 0) + amount;
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await expensesCollection.updateOne({ id: expenseId, status: expense.status }, { $set: { reimbursedAmount, status: "Paid" } }, { session });
        await paymentsCollection.insertOne({ id: `reimbursement-${expenseId}`, orderId: expense.orderId, manualOrderId: "", personId: expense.personId, vendorId: "", invoiceId: "", expenseId, customerId: "", direction: "Reimbursement", amount, paymentDate: now().slice(0, 10), method: clean(body.method) || "Bank transfer", reference: clean(body.reference), notes: `Expense reimbursement ${expense.expenseNo}`, paymentAccountId, paymentAccountName: clean(paymentAccount.name), receiptKey: clean(body.receiptKey), receiptName: clean(body.receiptName), createdAt: now() }, { session });
      });
    } finally {
      await session.endSession();
    }
    return Response.json({ ok: true });
  } finally { await client.close(); }
}
