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

test("expense references are generated internally, unique-friendly and hidden from every role", async () => {
  const supervisorHelpers = await read("app/order-supervisors.ts");
  const expenseRules = (await read("app/expense-rules.ts")).replace('import { isOrderSupervisor } from "./order-supervisors";\n\n', "");
  const compiledRules = ts.transpileModule(`${supervisorHelpers}\n${expenseRules}`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const [rules, permissions, dashboard, sitesRoute, mongoRoute] = await Promise.all([
    import(`data:text/javascript;base64,${Buffer.from(compiledRules).toString("base64")}`),
    read("app/auth/permissions.ts"),
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.equal(rules.createExpenseNumber(new Date("2026-08-31T08:15:30.000Z"), "abc123-rest"), "EXP-20260831081530-ABC123");
  assert.match(permissions, /expenseNo: ""/);
  assert.doesNotMatch(dashboard, /name="expenseNo"|Expense number|Expense no|expense\.expenseNo/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /expenseNo: createExpenseNumber\(new Date\(createdAt\)\)/);
    assert.doesNotMatch(source, /clean\(payload\.expenseNo\)/);
  }
});

test("expense order choices include the order ID and title or venue context", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");

  assert.match(dashboard, /kind === "expense"[\s\S]*showContext/);
  assert.match(dashboard, /order\.title \|\| order\.venue \|\| order\.deliveryAddress \|\| "Venue not added"/);
});

test("salesperson orders are ownership-filtered and expose clickable dated schedule cards", async () => {
  const [dashboard, analytics] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    loadTypeScriptModule("app/admin-analytics.ts"),
  ]);

  assert.deepEqual(analytics.adminDateRange("week", "2026-08-31"), { from: "2026-08-31", to: "2026-09-06", label: "This week" });
  assert.deepEqual(analytics.adminDateRange("month", "2026-08-31"), { from: "2026-08-01", to: "2026-08-31", label: "This month" });
  assert.match(dashboard, /function SalespersonOrderDashboard/);
  assert.match(dashboard, /user\.role === "sales" \? data\.orders\.filter\(\(order\) => order\.salespersonId === currentSalespersonId\)/);
  assert.match(dashboard, /Today[\s\S]*Tomorrow[\s\S]*This week[\s\S]*This month[\s\S]*Custom/);
  for (const label of ["Closed orders", "Deliveries", "Pickups", "Pending payments"]) assert.match(dashboard, new RegExp(`label="${label}"`));
  assert.match(dashboard, /AdminReportDrawer detail=\{detail\}/);
});

test("completed orders use the compact summary and only administrators can edit them", async () => {
  const [dashboard, styles, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/globals.css"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /const completedOrders = visibleOrders\.filter\(\(order\) => order\.status === "Completed"\)/);
  assert.match(dashboard, /completed-order-summary/);
  assert.match(dashboard, /user\.role === "admin" && <button[^>]+onClick=\{\(\) => editOrder\(order\)\}>Edit<\/button>/);
  assert.match(styles, /\.completed-order-table \.table-row \{ min-height: 58px/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /existingOrder\.status === "Completed"/);
    assert.match(source, /Only an administrator can edit a completed order/);
  }
});
