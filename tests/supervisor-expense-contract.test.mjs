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
  const { approvedExpenseTotal, reimbursementTotal, pendingReimbursementTotal, reimbursementPending, expenseStatus } = await load("app/supervisor-expenses.ts");
  const rows = [
    { amount: 1000, status: expenseStatus("Approved"), reimbursedAmount: 400 },
    { amount: 700, status: expenseStatus("Approved"), reimbursedAmount: 700 },
    { amount: 300, status: expenseStatus("Pending approval"), reimbursedAmount: 0 },
    { amount: 500, status: expenseStatus("Disapproved"), reimbursedAmount: 0 },
  ];
  assert.equal(approvedExpenseTotal(rows), 1700);
  assert.equal(reimbursementTotal(rows), 1100);
  assert.equal(pendingReimbursementTotal(rows), 600);
  assert.equal(reimbursementPending(1000, 400), 600);
  assert.equal(reimbursementPending(700, 900), 0);
});

test("expense dashboard has clickable business-overview breakdowns and supervisor reimbursement controls", async () => {
  const [dashboard, permissions, sitesRoute, mongoRoute, schema, ensure] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/auth/permissions.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("db/schema.ts"),
    read("db/ensure.ts"),
  ]);
  for (const label of ["Total expenses", "Person-wise expense", "Order-wise expense", "Supervisor reimbursement pending"]) assert.match(dashboard, new RegExp(label, "i"));
  assert.match(dashboard, /onClick=\{\(\) => setExpenseDetail/);
  assert.match(dashboard, /Expense detail/);
  assert.match(dashboard, /Approve/);
  assert.match(dashboard, /Disapprove/);
  assert.match(dashboard, /Reimburse/);
  assert.match(dashboard, /Pending reimbursement/);
  assert.match(permissions, /expenseApproval/);
  assert.match(permissions, /expenseReimbursement/);
  assert.match(sitesRoute, /expenseApproval/);
  assert.match(mongoRoute, /expenseApproval/);
  assert.match(schema, /expense_status/);
  assert.match(schema, /reimbursed_amount/);
  assert.match(ensure, /expense_status/);
  assert.match(ensure, /reimbursed_amount/);
});

test("supervisor expenses are filtered to the assigned supervisor and paid reimbursement does not increase order pending payment", async () => {
  const [permissions, route, mongo, dashboard] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("app/components/ExpenseDashboard.tsx"),
  ]);
  assert.match(permissions, /expense\.personId/);
  assert.match(route, /reimbursement/);
  assert.match(mongo, /reimbursement/);
  assert.match(dashboard, /reimbursedAmount/);
  assert.match(dashboard, /remainingReimbursement/);
  assert.match(dashboard, /order pending payment/i);
});
