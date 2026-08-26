import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("payments are linked to orders and identify the vendor when money is paid", async () => {
  const [dashboard, schema, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("db/schema.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /kind === "payment"[\s\S]*name="orderId"/);
  assert.match(dashboard, /kind === "payment"[\s\S]*name="vendorId"/);
  assert.doesNotMatch(dashboard, /name="invoiceId"/);
  for (const source of [schema, sitesRoute, mongoRoute]) {
    assert.match(source, /orderId/);
    assert.match(source, /personId/);
  }
});

test("payment directions and order edits are enforced by role", async () => {
  const [permissions, sitesRoute, mongoRoute] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(permissions, /canRecordPayment/);
  assert.match(permissions, /sales[\s\S]*Received/);
  assert.match(sitesRoute, /export async function PATCH/);
  assert.match(sitesRoute, /\["admin", "supervisor"\]\.includes\(user\.role\)/);
  assert.match(mongoRoute, /export async function PATCH/);
});

test("each order exposes a combined transaction history", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");

  assert.match(dashboard, /OrderTransactionHistory/);
  assert.match(dashboard, /Customer receipt/);
  assert.match(dashboard, /Vendor payment/);
  assert.match(dashboard, /Order expense/);
  assert.match(dashboard, /Invoice issued/);
});

test("accountants can allocate one payment across multiple orders", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /paymentAllocations/);
  assert.match(dashboard, /name="allocations"/);
  assert.match(dashboard, /Allocate payment across orders/);
  assert.match(sitesRoute, /Only accountants and administrators can select multiple orders/);
  assert.match(sitesRoute, /Allocation total must equal the payment amount/);
  assert.match(mongoRoute, /insertMany/);
});
