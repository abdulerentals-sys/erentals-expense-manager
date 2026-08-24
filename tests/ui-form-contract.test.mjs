import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the dashboard uses readable type and mobile-first controls", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /body\s*\{[^}]*font-size:\s*16px/s);
  assert.match(css, /\.field input, \.field select, \.field textarea\s*\{[^}]*font-size:\s*16px/s);
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*\.data-table\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /@media \(max-width: 650px\)[\s\S]*\.record-modal\s*\{[^}]*border-radius:\s*0/s);
});

test("every record form is wired and dated transactions persist their dates", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    readFile(new URL("../app/components/ExpenseDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/records/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/records/mongodb.ts", import.meta.url), "utf8"),
  ]);

  for (const kind of ["customer", "person", "order", "invoice", "expense", "payment"]) {
    assert.match(dashboard, new RegExp(`kind === "${kind}"`));
    assert.match(sitesRoute, new RegExp(`type === "${kind}"`));
    assert.match(mongoRoute, new RegExp(`type === "${kind}"`));
  }

  for (const field of ["eventDate", "issueDate", "dueDate", "expenseDate", "paymentDate"]) {
    assert.match(dashboard, new RegExp(`name="${field}"[^>]*type="date"`));
    assert.match(sitesRoute, new RegExp(`${field}: clean\\(payload\\.${field}\\)`));
    assert.match(mongoRoute, new RegExp(`${field}: clean\\(payload\\.${field}\\)`));
  }

  for (const route of [sitesRoute, mongoRoute]) {
    assert.match(route, /invalidDate\(payload, \["eventDate"\]\)/);
    assert.match(route, /invalidDate\(payload, \["issueDate", "dueDate"\]\)/);
    assert.match(route, /invalidDate\(payload, \["expenseDate"\]\)/);
    assert.match(route, /invalidDate\(payload, \["paymentDate"\]\)/);
    assert.match(route, /Due date cannot be before the invoice date/);
    assert.match(route, /Payment amount must be greater than zero/);
  }

  assert.match(mongoRoute, /startSession\(\)/);
  assert.match(mongoRoute, /withTransaction/);
});
