import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("orders support any number of persisted product rows", async () => {
  const [dashboard, schema, sitesRoute, mongoRoute, permissions, migration] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("db/schema.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("app/auth/permissions.ts"),
    read("drizzle/0010_typical_agent_zero.sql"),
  ]);

  assert.match(dashboard, /orderProductDrafts/);
  assert.match(dashboard, /name="products"/);
  assert.match(dashboard, /Add another product/);
  assert.match(dashboard, /Product name/);
  assert.match(dashboard, /Quantity/);
  assert.match(dashboard, /Price/);
  assert.match(schema, /export const orderProducts/);
  assert.match(migration, /CREATE TABLE `order_products`/);
  assert.match(mongoRoute, /db\.collection<OrderProduct>\("order_products"\)/);
  assert.match(mongoRoute, /collections\.orderProducts\.insertMany/);
  assert.match(permissions, /orderProducts/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /orderProductInputs/);
    assert.match(source, /orderProducts/);
    assert.match(source, /Complete the product name, quantity and price for every product/);
  }
});

test("the order dialog has an explicit close button and ignores backdrop clicks", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");

  assert.match(dashboard, /kind === "order" \? undefined : \(event\) => event\.target === event\.currentTarget && onClose\(\)/);
  assert.match(dashboard, /className="modal-close"[^>]+Close order form[^>]*>×<\/button>/);
});

test("admin order create and update selectors do not require People email addresses", async () => {
  const [dashboard, team, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/auth/team.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  const eligibility = team.match(/export function isOrderTeamPerson[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(eligibility, /email|assignment|Team Access/);
  assert.match(dashboard, /All active People with Sales or Supervisor roles are available directly/);
  assert.match(dashboard, /Salesperson \*[^]*TeamPersonSelect/);
  assert.match(dashboard, /Supervisor \*[^]*TeamPersonSelect/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /salespersonId/);
    assert.match(source, /assignedPersonId/);
    assert.match(source, /isOrderTeamPerson\(assignedPerson, "supervisor"\)/);
  }
});
