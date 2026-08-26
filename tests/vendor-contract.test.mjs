import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("vendors have a role-controlled master page", async () => {
  const [dashboard, permissions, schema, route, mongo] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"), read("app/auth/permissions.ts"), read("db/schema.ts"),
    read("app/api/records/route.ts"), read("app/api/records/mongodb.ts"),
  ]);
  assert.match(dashboard, /href: "\/vendors"/);
  assert.match(dashboard, /function VendorsPage/);
  assert.match(dashboard, /kind === "vendor"/);
  assert.match(permissions, /admin:[^\n]*"vendors"/);
  assert.match(permissions, /accountant:[^\n]*"vendors"/);
  assert.match(schema, /export const vendors/);
  assert.match(route, /type === "vendor"/);
  assert.match(mongo, /vendors: Collection<Vendor>/);
});

test("orders support multiple vendor product assignments", async () => {
  const [dashboard, schema, route, mongo] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"), read("db/schema.ts"),
    read("app/api/records/route.ts"), read("app/api/records/mongodb.ts"),
  ]);
  assert.match(dashboard, /kind === "orderVendor"/);
  assert.match(dashboard, /name="productName"/);
  assert.match(dashboard, /Assign vendor/);
  assert.match(schema, /export const orderVendors/);
  for (const source of [route, mongo]) {
    assert.match(source, /type === "orderVendor"/);
    assert.match(source, /vendorId/);
    assert.match(source, /productName/);
  }
});

test("expenses and payments link directly to vendor records", async () => {
  const [dashboard, schema, route, mongo] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"), read("db/schema.ts"),
    read("app/api/records/route.ts"), read("app/api/records/mongodb.ts"),
  ]);
  assert.match(dashboard, /name="vendorId"/);
  for (const source of [schema, route, mongo]) assert.match(source, /vendorId/);
});
