import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadExpenseRules() {
  const source = await read("app/expense-rules.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("custom expense categories are normalized and accepted only when stored", async () => {
  const rules = await loadExpenseRules();

  assert.equal(rules.expenseCategoryKey("  Equipment   Repair "), "equipment repair");
  assert.equal(rules.isBuiltInExpenseCategory(" transport "), true);
  assert.equal(rules.isAllowedExpenseCategory("Equipment repair"), false);
  assert.equal(rules.isAllowedExpenseCategory("Equipment repair", ["equipment repair"]), true);
});

test("settings are admin-only and category storage exists for D1 and MongoDB", async () => {
  const [permissions, schema, ensure, route, mongo, migration] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("db/schema.ts"),
    read("db/ensure.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("drizzle/0011_condemned_rick_jones.sql"),
  ]);

  assert.match(permissions, /admin:[^\n]+"settings"/);
  assert.doesNotMatch(permissions, /accountant:[^\n]+"settings"/);
  assert.match(permissions, /admin:[^\n]+"expenseCategory"/);
  assert.match(schema, /export const expenseCategories/);
  assert.match(ensure, /CREATE TABLE IF NOT EXISTS expense_categories/);
  assert.match(migration, /CREATE TABLE `expense_categories`/);
  for (const source of [route, mongo]) {
    assert.match(source, /type === "expenseCategory"/);
    assert.match(source, /isBuiltInExpenseCategory/);
    assert.match(source, /status: "Deleted"/);
    assert.match(source, /isAllowedExpenseCategory\(category, customCategories\.map/);
  }
});

test("admin overview exposes clickable schedule, salesperson and supervisor drill-downs", async () => {
  const [dashboard, styles] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(dashboard, /Tomorrow’s pickups/);
  assert.match(dashboard, /openSalesperson/);
  assert.match(dashboard, /openSupervisor/);
  assert.match(dashboard, /function AdminReportDrawer/);
  assert.match(dashboard, /Today[\s\S]*This week[\s\S]*This month[\s\S]*Custom/);
  assert.match(dashboard, /initialSection === "settings"/);
  assert.match(dashboard, /function SettingsPage/);
  assert.match(styles, /\.admin-insight-drawer/);
  assert.match(styles, /\.settings-category-manager/);
});
