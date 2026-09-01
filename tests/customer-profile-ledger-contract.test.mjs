import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadTypeScriptModule(path) {
  const source = await read(path);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("customer ledger calculates dated Tally-style debits, credits, and running balances", async () => {
  const { buildCustomerLedger } = await loadTypeScriptModule("app/customer-ledger.ts");
  const customer = { id: "customer-1", openingBalance: 1000, createdAt: "2026-01-01T08:30:00.000Z" };
  const orders = [
    { id: "order-1", orderNo: "ORD-0001", title: "Annual meet", venue: "BKC", customerId: "customer-1", eventDate: "2026-01-10", contractValue: 10000, status: "Completed", createdAt: "2026-01-02T10:00:00.000Z" },
    { id: "order-2", orderNo: "ORD-0002", title: "Cancelled meet", venue: "NESCO", customerId: "customer-1", eventDate: "2026-01-15", contractValue: 5000, status: "Cancelled", createdAt: "2026-01-03T10:00:00.000Z" },
  ];
  const payments = [
    { id: "payment-1", orderId: "order-1", manualOrderId: "", customerId: "customer-1", direction: "Received", amount: 2500, paymentDate: "2026-01-12", method: "UPI", reference: "UTR-1", notes: "Part payment" },
    { id: "payment-2", orderId: "", manualOrderId: "EXT-22", customerId: "customer-1", direction: "Received", amount: 1000, paymentDate: "2026-01-20", method: "Bank transfer", reference: "", notes: "Manual receipt" },
    { id: "payment-3", orderId: "order-1", manualOrderId: "", customerId: "customer-1", direction: "Paid", amount: 400, paymentDate: "2026-01-13", method: "Cash", reference: "", notes: "Vendor payment" },
    { id: "payment-4", orderId: "order-1", manualOrderId: "", customerId: "customer-2", direction: "Received", amount: 900, paymentDate: "2026-01-14", method: "Cash", reference: "", notes: "Other customer" },
  ];

  const ledger = buildCustomerLedger(customer, orders, payments);

  assert.deepEqual(ledger.entries.map((entry) => entry.date), ["2026-01-01", "2026-01-10", "2026-01-12", "2026-01-20"]);
  assert.deepEqual(ledger.entries.map((entry) => entry.voucherType), ["Opening Balance", "Order", "Receipt", "Receipt"]);
  assert.deepEqual(ledger.entries.map((entry) => [entry.debit, entry.credit, entry.balance]), [
    [1000, 0, 1000],
    [10000, 0, 11000],
    [0, 2500, 8500],
    [0, 1000, 7500],
  ]);
  assert.equal(ledger.entries[1].voucherNo, "ORD-0001");
  assert.equal(ledger.entries[2].voucherNo, "UTR-1");
  assert.equal(ledger.entries[3].voucherNo, "EXT-22");
  assert.deepEqual(ledger.summary, { openingBalance: 1000, orderValue: 10000, received: 3500, closingBalance: 7500 });
});

test("admin, accountant, and salesperson share one customer-edit permission rule", async () => {
  const [permissions, dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(permissions, /canEditCustomerProfile/);
  assert.match(permissions, /\["admin", "accountant", "sales"\]/);
  assert.match(dashboard, /canEditCustomerProfile\(user\.role\)/);
  assert.match(sitesRoute, /canEditCustomerProfile\(user\.role\)/);
  assert.match(mongoRoute, /canEditCustomerProfile\(userRole\)/);
});

test("clicking a customer or company opens a downloadable Tally-style ledger", async () => {
  const [dashboard, styles] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(dashboard, /className="customer-profile-link[^"]*"[\s\S]*onClick=\{\(\) => viewCustomer\(customer\)\}/);
  for (const label of ["Account ledger", "Date", "Particulars", "Vch type", "Vch no.", "Debit", "Credit", "Balance"]) {
    assert.match(dashboard, new RegExp(label.replace(".", "\\."), "i"));
  }
  assert.match(dashboard, /Download ledger/);
  assert.match(dashboard, /customer-ledger-[^`]*\.xls/);
  assert.match(dashboard, /application\/vnd\.ms-excel/);
  assert.match(styles, /\.customer-ledger-drawer/);
  assert.match(styles, /\.customer-ledger-table/);
});
