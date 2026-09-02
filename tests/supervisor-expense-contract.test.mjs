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

test("expense command centre provides clickable overview breakdowns and approval controls", async () => {
  const [dashboard, page, history, styles, route, schema, ensure] = await Promise.all([
    read("app/components/SupervisorExpenseDashboard.tsx"),
    read("app/expenses/page.tsx"),
    read("app/components/SupervisorReimbursementHistory.tsx"),
    read("app/components/SupervisorExpenseStyles.tsx"),
    read("app/api/expense-approvals/route.ts"),
    read("db/schema.ts"),
    read("db/ensure.ts"),
  ]);
  for (const label of ["Total expenses", "Person-wise expense", "Order-wise expense", "Pending reimbursement", "Supervisor reimbursement"]) assert.match(dashboard, new RegExp(label, "i"));
  assert.match(dashboard, /setDetail\("total"\)/);
  assert.match(dashboard, /setDetail\("person"\)/);
  assert.match(dashboard, /setDetail\("order"\)/);
  assert.match(dashboard, /Approve/);
  assert.match(dashboard, /Disapprove/);
  assert.match(dashboard, /Reimburse/);
  assert.match(page, /SupervisorExpenseDashboard/);
  assert.match(history, /Reimbursements already paid/);
  assert.match(styles, /expense-kpi-grid/);
  assert.match(route, /action === "approve"/);
  assert.match(route, /action === "disapprove"/);
  assert.match(route, /action === "reimburse"/);
  assert.match(route, /direction: "Reimbursement"/);
  assert.match(schema, /status: text\("status"\)/);
  assert.match(schema, /reimbursedAmount/);
  assert.match(ensure, /reimbursed_amount/);
});

test("supervisor expenses are filtered to the assigned supervisor and reimbursement does not become customer payment", async () => {
  const [route, dashboard, history] = await Promise.all([
    read("app/api/expense-approvals/route.ts"),
    read("app/components/SupervisorExpenseDashboard.tsx"),
    read("app/components/SupervisorReimbursementHistory.tsx"),
  ]);
  assert.match(route, /user\.role === "supervisor"/);
  assert.match(route, /String\(expense\.personId\) === String\(currentPersonId\)/);
  assert.match(route, /direction: "Reimbursement"/);
  assert.doesNotMatch(route, /direction: "Received"/);
  assert.match(dashboard, /reimbursementPending/);
  assert.match(dashboard, /Pending reimbursement/);
  assert.match(history, /payment\.amount/);
});
