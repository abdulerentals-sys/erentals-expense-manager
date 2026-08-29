import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadAnalytics() {
  const source = await read("app/admin-analytics.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("admin date filters cover today, week, month, next month and custom dates", async () => {
  const { adminDateRange, indiaDateKey } = await loadAnalytics();

  assert.deepEqual(adminDateRange("today", "2026-08-29"), { from: "2026-08-29", to: "2026-08-29", label: "Today" });
  assert.deepEqual(adminDateRange("week", "2026-08-29"), { from: "2026-08-24", to: "2026-08-30", label: "This week" });
  assert.deepEqual(adminDateRange("month", "2026-08-29"), { from: "2026-08-01", to: "2026-08-31", label: "This month" });
  assert.deepEqual(adminDateRange("nextMonth", "2026-08-29"), { from: "2026-09-01", to: "2026-09-30", label: "Next month" });
  assert.deepEqual(adminDateRange("custom", "2026-08-29", "2026-09-08", "2026-09-02"), { from: "2026-09-02", to: "2026-09-08", label: "Selected dates" });
  assert.equal(indiaDateKey("2026-08-28T20:00:00.000Z"), "2026-08-29");
});

test("admin order analytics calculate sales, new orders, deliveries and pickups independently", async () => {
  const { adminDateRange, summarizeAdminOrders } = await loadAnalytics();
  const orders = [
    { id: "today", salespersonId: "sales-1", deliveryDate: "2026-08-29", pickupDate: "2026-08-30", contractValue: 100000, status: "Planned", createdAt: "2026-08-29T04:00:00.000Z" },
    { id: "next", salespersonId: "sales-2", deliveryDate: "2026-09-02", pickupDate: "2026-09-05", contractValue: 250000, status: "In progress", createdAt: "2026-08-31T08:00:00.000Z" },
    { id: "cancelled", salespersonId: "sales-1", deliveryDate: "2026-08-29", pickupDate: "2026-08-29", contractValue: 900000, status: "Cancelled", createdAt: "2026-08-29T06:00:00.000Z" },
  ];

  const today = summarizeAdminOrders(orders, adminDateRange("today", "2026-08-29"));
  assert.deepEqual(today.newOrders.map((order) => order.id), ["today"]);
  assert.deepEqual(today.deliveries.map((order) => order.id), ["today"]);
  assert.equal(today.pickups.length, 0);
  assert.equal(today.salesAmount, 100000);

  const nextMonth = summarizeAdminOrders(orders, adminDateRange("nextMonth", "2026-08-29"));
  assert.deepEqual(nextMonth.deliveries.map((order) => order.id), ["next"]);
  assert.deepEqual(nextMonth.pickups.map((order) => order.id), ["next"]);
});

test("the admin overview exposes salesperson sales and dated delivery and pickup schedules", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");

  assert.match(dashboard, /user\.role === "admin" && <AdminOperationsDashboard/);
  assert.match(dashboard, /function AdminOperationsDashboard/);
  assert.match(dashboard, /Today[\s\S]*This week[\s\S]*This month[\s\S]*Next month[\s\S]*Custom/);
  assert.match(dashboard, /Salesperson performance/);
  assert.match(dashboard, /Delivery schedule/);
  assert.match(dashboard, /Pickup schedule/);
});
