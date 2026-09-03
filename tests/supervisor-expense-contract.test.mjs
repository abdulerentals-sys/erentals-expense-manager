import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
async function load(path) {
  const source = await read(path);
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("supervisor expense reimbursement keeps approved cost separate from reimbursement pending", async () => {
  const { approvedExpenseTotal, reimbursementTotal, pendingReimbursementTotal, reimbursementPending, orderExpenseTotal, expenseStatus } = await load("app/supervisor-expenses.ts");
  const rows = [
    { orderId: "order-1", amount: 1000, status: expenseStatus("Approved"), reimbursedAmount: 400 },
    { orderId: "order-1", amount: 700, status: expenseStatus("Approved"), reimbursedAmount: 700 },
    { orderId: "order-1", amount: 300, status: expenseStatus("Pending approval"), reimbursedAmount: 0 },
    { orderId: "order-1", amount: 500, status: expenseStatus("Disapproved"), reimbursedAmount: 0 },
  ];
  assert.equal(approvedExpenseTotal(rows), 1700);
  assert.equal(reimbursementTotal(rows), 1100);
  assert.equal(pendingReimbursementTotal(rows), 600);
  assert.equal(reimbursementPending(1000, 400), 600);
  assert.equal(reimbursementPending(700, 900), 0);
  assert.equal(orderExpenseTotal(rows, "order-1"), 1700);
});

test("the existing expense dashboard gains clickable reimbursement details without a replacement layout", async () => {
  const [dashboard, sectionPage, route, schema, ensure] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/[section]/page.tsx"),
    read("app/api/expense-approvals/route.ts"),
    read("db/schema.ts"),
    read("db/ensure.ts"),
  ]);
  await assert.rejects(read("app/expenses/page.tsx"), /ENOENT/);
  assert.match(sectionPage, /ExpenseDashboard/);
  for (const label of ["Order-wise expenses", "Person-wise expenses", "Pending reimbursement", "Reimbursed", "Supervisor reimbursement"]) assert.match(dashboard, new RegExp(label, "i"));
  assert.match(dashboard, /onSelect=.*openExpenseDetail\("order"/s);
  assert.match(dashboard, /onSelect=.*openExpenseDetail\("person"/s);
  assert.match(dashboard, /Approve/);
  assert.match(dashboard, /Reject/);
  assert.match(dashboard, /Reimburse/);
  assert.match(dashboard, /Reimbursement payment history/);
  assert.match(route, /action === "approve"/);
  assert.match(route, /action === "disapprove"/);
  assert.match(route, /action === "reimburse"/);
  assert.match(route, /direction: "Reimbursement"/);
  assert.match(schema, /status: text\("status"\)/);
  assert.match(schema, /reimbursedAmount/);
  assert.match(ensure, /reimbursed_amount/);
});

test("supervisor reimbursements remain claimant-scoped and do not become customer payments", async () => {
  const [route, dashboard] = await Promise.all([
    read("app/api/expense-approvals/route.ts"),
    read("app/components/ExpenseDashboard.tsx"),
  ]);
  assert.match(route, /isLegacyReimbursementClaim/);
  assert.match(route, /canViewReimbursementSubmission/);
  assert.match(route, /isOrderSupervisor/);
  assert.match(route, /user\.role === "supervisor"/);
  assert.match(route, /String\(expense\.personId\) === String\(currentPersonId\)/);
  assert.match(route, /direction: "Reimbursement"/);
  assert.doesNotMatch(route, /direction: "Received"/);
  assert.match(dashboard, /reimbursementPending/);
  assert.match(dashboard, /Pending reimbursement/);
  assert.match(dashboard, /workflow\.payments/);
});
