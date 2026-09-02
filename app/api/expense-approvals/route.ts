import { eq } from "drizzle-orm";
import { getSessionUser } from "../../auth/session";
import { isOrderTeamPerson, resolveUserPersonId } from "../../auth/team";
import type { UserRole } from "../../auth/types";
import { ensureSchema } from "../../../db/ensure";
import { getDb } from "../../../db";
import { expenses, orders, persons, payments } from "../../../db/schema";
import { isOrderSupervisor, type OrderSupervisorFields } from "../../order-supervisors";
import { expenseStatus, reimbursementPending } from "../../supervisor-expenses";

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
type ExpenseRow = { id: string; expenseNo: string; orderId: string; personId: string; category: string; vendor: string; description: string; expenseDate: string; amount: number; paymentMode: string; receiptKey: string; receiptName: string; status?: string; reimbursedAmount?: number; [key: string]: unknown };
type OrderRow = OrderSupervisorFields & { id: string; orderNo: string; title: string; venue?: string; customerId?: string; contractValue: number; status?: string; [key: string]: unknown };
type PersonRow = { id: string; name: string; email: string; role: string; status: string; [key: string]: unknown };
type PaymentRow = { id: string; orderId: string; personId: string; direction: string; amount: number; paymentDate: string; reference: string; notes: string; [key: string]: unknown };

const now = () => new Date().toISOString();
const clean = (value: unknown) => String(value ?? "").trim();
const money = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
const isNetlify = () => Boolean(process.env.MONGODB_URI?.trim());

function allowedAction(role: UserRole, action: string) {
  if (["approve", "disapprove"].includes(action)) return role === "admin";
  if (action === "reimburse") return ["admin", "accountant"].includes(role);
  return false;
}

function isSubmittedSupervisorExpense(expense: ExpenseRow, order: OrderRow | null | undefined, person: PersonRow | null | undefined) {
  return isOrderTeamPerson(person, "supervisor") && isOrderSupervisor(order, String(expense.personId));
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (user.mustChangePassword) return Response.json({ error: "Change your temporary password before using the dashboard" }, { status: 403 });
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
  const ownOrderIds = new Set(ownOrders.map((order) => String(order.id)));
  const rows = expenseRows.filter((expense) => {
    const order = orderMap.get(String(expense.orderId));
    const person = personMap.get(String(expense.personId));
    return isSubmittedSupervisorExpense(expense, order, person)
      && ownOrderIds.has(String(expense.orderId))
      && (user.role !== "supervisor" || String(expense.personId) === String(currentPersonId));
  }).map((expense) => {
    const order = orderMap.get(String(expense.orderId));
    const person = personMap.get(String(expense.personId));
    const reimbursedAmount = money(expense.reimbursedAmount);
    return { ...expense, status: expenseStatus(expense.status), reimbursedAmount, orderNo: order?.orderNo || "", orderTitle: order?.title || order?.venue || "", supervisorId: String(expense.personId || ""), supervisorName: person?.name || "" };
  });
  return Response.json({ expenses: rows, orders: ownOrders.map((order) => ({ id: order.id, orderNo: order.orderNo, title: order.title, contractValue: user.role === "supervisor" ? 0 : order.contractValue })), payments: paymentRows.filter((payment) => ["Reimbursement", "Supervisor reimbursement"].includes(payment.direction) && (user.role !== "supervisor" || String(payment.personId) === String(currentPersonId))), supervisorId: currentPersonId || "", supervisorName: personMap.get(currentPersonId || "")?.name || user.name });
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
  let body: { action?: string; expenseId?: string; amount?: number };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  const action = clean(body.action);
  const expenseId = clean(body.expenseId);
  if (!allowedAction(user.role, action)) return Response.json({ error: "Your role cannot perform this action" }, { status: 403 });
  if (!expenseId) return Response.json({ error: "Expense ID is required" }, { status: 400 });
  if (isNetlify()) return mutateMongo(user, action, expenseId, money(body.amount));
  await ensureSchema();
  const db = getDb();
  const [expenseRows, orderRows, personRows] = await Promise.all([
    db.select().from(expenses).where(eq(expenses.id, expenseId)),
    db.select().from(orders),
    db.select().from(persons),
  ]);
  const expense = expenseRows[0];
  if (!expense) return Response.json({ error: "Expense not found" }, { status: 404 });
  const order = orderRows.find((row) => String(row.id) === String(expense.orderId));
  const person = personRows.find((row) => String(row.id) === String(expense.personId));
  if (!isSubmittedSupervisorExpense(expense as ExpenseRow, order as unknown as OrderRow | undefined, person as unknown as PersonRow | undefined)) return Response.json({ error: "Only expenses submitted by an assigned supervisor can use this workflow" }, { status: 409 });
  const status = expenseStatus(expense.status);
  if (action === "approve" || action === "disapprove") {
    if (action === "approve" && status === "Disapproved") return Response.json({ error: "A disapproved expense cannot be approved again" }, { status: 409 });
    await db.update(expenses).set(action === "approve" ? { status: "Approved", approvedAt: now(), approvedBy: user.name, disapprovedAt: "", disapprovedBy: "" } : { status: "Disapproved", disapprovedAt: now(), disapprovedBy: user.name }).where(eq(expenses.id, expenseId));
    return Response.json({ ok: true });
  }
  if (status !== "Approved") return Response.json({ error: "Only approved expenses can be reimbursed" }, { status: 409 });
  const pending = reimbursementPending(expense.amount, expense.reimbursedAmount);
  const amount = money(body.amount) || pending;
  if (!amount || amount > pending) return Response.json({ error: `Reimbursement cannot exceed ${pending}` }, { status: 400 });
  await db.batch([db.update(expenses).set({ reimbursedAmount: money(expense.reimbursedAmount) + amount }).where(eq(expenses.id, expenseId)), db.insert(payments).values({ id: crypto.randomUUID(), orderId: expense.orderId, manualOrderId: "", personId: expense.personId, vendorId: "", invoiceId: "", customerId: "", direction: "Reimbursement", amount, paymentDate: now().slice(0, 10), method: expense.paymentMode || "Bank transfer", reference: "", notes: `Supervisor expense reimbursement ${expense.expenseNo}`, createdAt: now() })]);
  return Response.json({ ok: true });
}

async function mutateMongo(user: SessionUser, action: string, expenseId: string, requestedAmount: number) {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(process.env.MONGODB_URI as string);
  await client.connect();
  try {
    const db = client.db();
    const expensesCollection = db.collection<ExpenseRow>("expenses");
    const ordersCollection = db.collection<OrderRow>("orders");
    const personsCollection = db.collection<PersonRow>("persons");
    const paymentsCollection = db.collection<PaymentRow>("payments");
    const expense = await expensesCollection.findOne({ id: expenseId });
    if (!expense) return Response.json({ error: "Expense not found" }, { status: 404 });
    const [order, person] = await Promise.all([ordersCollection.findOne({ id: expense.orderId }), personsCollection.findOne({ id: expense.personId })]);
    if (!isSubmittedSupervisorExpense(expense, order, person)) return Response.json({ error: "Only expenses submitted by an assigned supervisor can use this workflow" }, { status: 409 });
    const status = expenseStatus(expense.status);
    if (action === "approve" || action === "disapprove") {
      if (action === "approve" && status === "Disapproved") return Response.json({ error: "A disapproved expense cannot be approved again" }, { status: 409 });
      await expensesCollection.updateOne({ id: expenseId }, { $set: action === "approve" ? { status: "Approved", approvedAt: now(), approvedBy: user.name, disapprovedAt: "", disapprovedBy: "" } : { status: "Disapproved", disapprovedAt: now(), disapprovedBy: user.name } });
      return Response.json({ ok: true });
    }
    if (status !== "Approved") return Response.json({ error: "Only approved expenses can be reimbursed" }, { status: 409 });
    const pending = reimbursementPending(Number(expense.amount), Number(expense.reimbursedAmount));
    const amount = requestedAmount || pending;
    if (!amount || amount > pending) return Response.json({ error: `Reimbursement cannot exceed ${pending}` }, { status: 400 });
    await expensesCollection.updateOne({ id: expenseId }, { $set: { reimbursedAmount: Number(expense.reimbursedAmount || 0) + amount } });
    await paymentsCollection.insertOne({ id: crypto.randomUUID(), orderId: expense.orderId, manualOrderId: "", personId: expense.personId, vendorId: "", invoiceId: "", customerId: "", direction: "Reimbursement", amount, paymentDate: now().slice(0, 10), method: expense.paymentMode || "Bank transfer", reference: "", notes: `Supervisor expense reimbursement ${expense.expenseNo}`, createdAt: now() });
    return Response.json({ ok: true });
  } finally { await client.close(); }
}
