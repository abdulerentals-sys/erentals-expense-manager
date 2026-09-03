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

test("reimbursement submissions include supervisor and admin forms while preserving legacy supervisor claims", async () => {
  const { isReimbursementSubmission, isOwnReimbursementSubmission } = await load("app/supervisor-expenses.ts");

  assert.equal(isReimbursementSubmission({ fundingSource: "Reimbursement", submittedByRole: "supervisor" }), true);
  assert.equal(isReimbursementSubmission({ fundingSource: "Reimbursement", submittedByRole: "admin" }), true);
  assert.equal(isReimbursementSubmission({ fundingSource: "Reimbursement", submittedByRole: "accountant" }), false);
  assert.equal(isReimbursementSubmission({ fundingSource: "Reimbursement", submittedByRole: "accountant" }, true), true);
  assert.equal(isReimbursementSubmission({ fundingSource: "Account", submittedByRole: "admin" }), false);
  assert.equal(isReimbursementSubmission({ fundingSource: "Reimbursement" }, true), true);
  assert.equal(isReimbursementSubmission({ fundingSource: "Reimbursement" }, false), false);

  const submitted = { submittedByRole: "supervisor", submittedByUserId: "user-1", submittedByPersonId: "person-1", personId: "person-1" };
  assert.equal(isOwnReimbursementSubmission(submitted, { userId: "user-1", personId: "" }), true);
  assert.equal(isOwnReimbursementSubmission(submitted, { userId: "", personId: "person-1" }), true);
  assert.equal(isOwnReimbursementSubmission(submitted, { userId: "user-2", personId: "person-2" }), false);
  assert.equal(isOwnReimbursementSubmission({ ...submitted, submittedByRole: "admin" }, { userId: "user-1", personId: "person-1" }), false);
  assert.equal(isOwnReimbursementSubmission({}, { userId: "", personId: "" }, true), true);
});

test("paid reimbursements stay in approved order cost and leave no pending balance", async () => {
  const { approvedExpenseTotal, expenseStatus, orderExpenseTotal, pendingReimbursementTotal, reimbursementStatus } = await load("app/supervisor-expenses.ts");
  const rows = [
    { orderId: "order-1", amount: 500, reimbursedAmount: 0, fundingSource: "Reimbursement", status: expenseStatus("Approved") },
    { orderId: "order-1", amount: 700, reimbursedAmount: 700, fundingSource: "Reimbursement", status: expenseStatus("Paid") },
    { orderId: "order-1", amount: 300, reimbursedAmount: 0, fundingSource: "Reimbursement", status: expenseStatus("Rejected") },
  ];
  assert.equal(expenseStatus("Paid"), "Paid");
  assert.equal(expenseStatus("Rejected"), "Rejected");
  assert.equal(reimbursementStatus("Approved", 700, 700), "Paid");
  assert.equal(approvedExpenseTotal(rows), 1200);
  assert.equal(orderExpenseTotal(rows, "order-1"), 1200);
  assert.equal(pendingReimbursementTotal(rows), 500);
});

test("D1 and Mongo persist submission snapshots for reimbursement eligibility and detail", async () => {
  const [schema, ensure, records, mongo, approvals] = await Promise.all([
    read("db/schema.ts"),
    read("db/ensure.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("app/api/expense-approvals/route.ts"),
  ]);

  for (const source of [schema, ensure, records, mongo, approvals]) {
    assert.match(source, /submittedByUserId|submitted_by_user_id/);
    assert.match(source, /submittedByRole|submitted_by_role/);
    assert.match(source, /submittedByName|submitted_by_name/);
  }
  for (const source of [schema, ensure, records, mongo]) {
    assert.match(source, /claimantName|claimant_name/);
    assert.match(source, /orderNoSnapshot|order_no_snapshot/);
  }
  for (const source of [schema, ensure, mongo, approvals]) assert.match(source, /expenseId|expense_id/);
  assert.match(records, /submittedByUserId:\s*user\.id/);
  assert.match(records, /submittedByRole:\s*user\.role/);
  assert.match(mongo, /submittedByUserId:\s*context\.userId/);
  assert.match(mongo, /submittedByRole:\s*userRole/);
  assert.match(approvals, /isReimbursementSubmission/);
  assert.match(approvals, /isOwnReimbursementSubmission/);
});

test("admin reimbursement entries expose approved, paid and rejected actions in the existing dashboard", async () => {
  const [dashboard, approvals] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/expense-approvals/route.ts"),
  ]);

  for (const label of ["Total reimbursement expenses", "Reimbursement entries", "Submitted by", "Approved", "Paid", "Rejected", "Payment history"]) {
    assert.match(dashboard, new RegExp(label, "i"));
  }
  assert.match(dashboard, /action:\s*"paid"/);
  assert.match(dashboard, /updateSupervisorExpense\(expense,\s*"reject"\)/);
  assert.match(approvals, /\["approve",\s*"reject"\]/);
  assert.match(approvals, /action === "paid"/);
  assert.match(approvals, /status:\s*"Paid"/);
  assert.match(approvals, /direction:\s*"Reimbursement"/);
  assert.match(approvals, /expenseId/);
  assert.doesNotMatch(approvals, /direction:\s*"Received"/);
});

test("the reimbursement queue refreshes when an expense is created without replacing the expense layout", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");
  assert.match(dashboard, /data\.expenses\.length/);
  assert.match(dashboard, /<section className="panel supervisor-reimbursement-panel"/);
  assert.match(dashboard, /<BreakdownPanel title="Order-wise expenses"/);
  assert.match(dashboard, /<BreakdownPanel title="Person-wise expenses"/);
});
