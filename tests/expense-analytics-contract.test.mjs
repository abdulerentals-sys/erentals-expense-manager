import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("expense entry follows role-specific responsibility rules without vendor payees", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");
  const expenseForm = dashboard.match(/\{kind === "expense"[\s\S]*?\{kind === "payment"/)?.[0] ?? "";

  assert.match(dashboard, /EXPENSE_CATEGORIES/);
  assert.match(dashboard, /isExpenseResponsiblePerson/);
  assert.match(expenseForm, /user\.role !== "supervisor"[\s\S]*Person responsible \*/);
  assert.match(expenseForm, /expenseOrderId/);
  assert.doesNotMatch(expenseForm, /Vendor \/ payee/);
  assert.doesNotMatch(expenseForm, /name="vendorId"/);
  assert.match(expenseForm, /EXPENSE_CATEGORIES\.map/);
});

test("expense dashboard supports period and order analysis with financial detail", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");
  const supervisorAnalytics = dashboard.match(/const supervisorRows[\s\S]*?const topSupervisor/)?.[0] ?? "";

  for (const label of [
    "Today",
    "This week",
    "This month",
    "Custom",
    "Order-wise expenses",
    "Person-wise expenses",
    "Category-wise expenses",
    "Top supervisor spender",
    "Total order value",
    "Customer receipts",
    "Vendor payouts",
    "Supervisor expenses",
    "Remaining customer balance",
    "Vendor commitment",
    "Vendor balance",
  ]) assert.match(dashboard, new RegExp(label));

  assert.match(dashboard, /expense\.expenseDate >= dateRange\.from/);
  assert.match(dashboard, /expense\.orderId === selectedOrderId/);
  assert.match(supervisorAnalytics, /assignedPersonId/);
  assert.match(supervisorAnalytics, /role\.includes\("supervisor"\)/);
  assert.doesNotMatch(supervisorAnalytics, /execution manager/);
});

test("selected-order financials reconcile linked payments and safe manual order references", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");
  const matcher = dashboard.match(/function paymentMatchesOrder[\s\S]*?\n\}/)?.[0] ?? "";
  const reconciliation = dashboard.match(/const selectedOrderPayments[\s\S]*?const vendorCommitment/)?.[0] ?? "";

  assert.match(matcher, /payment\.orderId === order\.id/);
  assert.match(matcher, /trim\(\)\.toLowerCase\(\)/);
  assert.match(matcher, /payment\.direction === "Received"/);
  assert.match(matcher, /payment\.customerId === order\.customerId/);
  assert.match(matcher, /payment\.manualOrderId/);
  assert.match(matcher, /order\.orderNo/);
  assert.match(reconciliation, /paymentMatchesOrder\(payment, selectedOrder\)/);
  assert.match(reconciliation, /selectedOrderPayments\.filter\(\(payment\) => payment\.direction === "Received"\)/);
  assert.match(reconciliation, /selectedOrderPayments\.filter\(\(payment\) => payment\.direction === "Paid"\)/);
});

test("currently filtered expense detail and summaries export as an Excel-compatible workbook", async () => {
  const [dashboard, styles] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(dashboard, /application\/vnd\.ms-excel/);
  assert.match(dashboard, /expense-report-[^`]*\.xls/);
  assert.match(dashboard, /Expense detail/);
  assert.match(dashboard, /Order summary/);
  assert.match(dashboard, /Category summary/);
  assert.match(dashboard, /Person summary/);
  assert.match(styles, /\.expense-filter-panel/);
  assert.match(styles, /\.expense-analysis-grid/);
  assert.match(styles, /\.order-financial-panel/);
});
