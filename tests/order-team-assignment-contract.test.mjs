import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("order titles are optional across the form and both storage APIs", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /Field label="Order title \(optional\)"/);
  assert.match(dashboard, /name="title" defaultValue=/);
  assert.doesNotMatch(dashboard, /name="title" required/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.doesNotMatch(source, /required\(payload, \["title", "customerId"/);
    assert.match(source, /required\(payload, \["customerId", "assignedPersonId", "eventDate"\]\)/);
  }
});

test("new and updated orders persist a salesperson and supervisor from the team", async () => {
  const [dashboard, schema, ensure, sitesRoute, mongoRoute, migration] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("db/schema.ts"),
    read("db/ensure.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("drizzle/0005_order_salesperson.sql"),
  ]);

  assert.match(dashboard, /name="salespersonId"/);
  assert.match(dashboard, /name="assignedPersonId"/);
  assert.match(dashboard, /Salesperson \*/);
  assert.match(dashboard, /Supervisor \*/);
  assert.match(dashboard, /editingOrder\?\.salespersonId/);
  assert.match(schema, /salespersonId: text\("salesperson_id"\)/);
  assert.match(ensure, /salesperson_id text DEFAULT '' NOT NULL/);
  assert.match(migration, /ALTER TABLE `orders` ADD `salesperson_id` text DEFAULT '' NOT NULL/);

  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /salespersonId/);
    assert.match(source, /Select a valid salesperson/);
    assert.match(source, /Select a valid supervisor/);
    assert.match(source, /Select active team members for the order/);
    assert.doesNotMatch(source, /must be linked by email/);
  }
});

test("supervisor ownership remains tied to the assigned supervisor after an admin update", async () => {
  const [permissions, dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(permissions, /order\.assignedPersonId/);
  assert.match(dashboard, /<small>Supervisor<\/small>/);
  assert.match(dashboard, /<small>Salesperson<\/small>/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /existingOrder\.assignedPersonId/);
    assert.match(source, /assignedPersonId: existingOrder\.assignedPersonId/);
  }
});
