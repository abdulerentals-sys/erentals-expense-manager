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

test("payment account defaults and legacy expense funding remain compatible", async () => {
  const { DEFAULT_PAYMENT_ACCOUNTS, expenseFundingSource, expenseNeedsReimbursement, paymentAccountKey } = await load("app/payment-accounts.ts");
  assert.deepEqual(DEFAULT_PAYMENT_ACCOUNTS.map((account) => account.name), ["Hope and Dream", "eRentals"]);
  assert.equal(expenseFundingSource(undefined), "Reimbursement");
  assert.equal(expenseNeedsReimbursement({}), true);
  assert.equal(expenseNeedsReimbursement({ fundingSource: "Account" }), false);
  assert.equal(paymentAccountKey("  Hope   and Dream "), "hope and dream");
  const { pendingReimbursementTotal } = await load("app/supervisor-expenses.ts");
  assert.equal(pendingReimbursementTotal([
    { amount: 700, reimbursedAmount: 100, status: "Approved", fundingSource: "Reimbursement" },
    { amount: 900, reimbursedAmount: 0, status: "Approved", fundingSource: "Account" },
  ]), 600);
});

test("D1 and Mongo persistence keep funding, account and receipt snapshots", async () => {
  const [schema, ensure, route, mongo, migration] = await Promise.all([
    read("db/schema.ts"),
    read("db/ensure.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("drizzle/0013_third_blue_marvel.sql"),
  ]);
  for (const source of [schema, ensure, route, mongo, migration]) {
    assert.match(source, /paymentAccount|payment_account/);
  }
  for (const source of [schema, ensure, route, mongo]) {
    assert.match(source, /fundingSource|funding_source/);
    assert.match(source, /receiptKey|receipt_key/);
    assert.match(source, /paymentAccountName|payment_account_name/);
  }
  assert.match(route, /Select an active payment account/);
  assert.match(mongo, /payment_accounts/);
  assert.match(migration, /Hope and Dream/);
  assert.match(migration, /eRentals/);
});

test("forms and admin settings expose only the requested account workflow additions", async () => {
  const [dashboard, approvals, permissions, upload] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/expense-approvals/route.ts"),
    read("app/auth/permissions.ts"),
    read("app/api/upload/route.ts"),
  ]);
  for (const label of ["Send for reimbursement", "Paid from company account", "Attach payment receipt", "Payment accounts", "Update account"]) {
    assert.match(dashboard, new RegExp(label, "i"));
  }
  assert.match(dashboard, /name="paymentAccountId"/);
  assert.match(dashboard, /reimburseSupervisorExpense/);
  assert.match(approvals, /Select an active reimbursement account/);
  assert.match(approvals, /paymentAccountName/);
  assert.match(approvals, /receiptKey/);
  assert.match(permissions, /paymentAccount/);
  assert.match(upload, /kind === "payment"/);
});
