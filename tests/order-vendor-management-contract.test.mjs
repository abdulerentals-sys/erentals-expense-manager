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

test("archived orders leave active dashboards and remain in order history", async () => {
  const { ARCHIVED_ORDER_STATUS, isActiveOrder, isHistoricalOrder } = await loadTypeScriptModule("app/order-lifecycle.ts");
  const orders = [
    { id: "planned", status: "Planned" },
    { id: "progress", status: "In progress" },
    { id: "completed", status: "Completed" },
    { id: "cancelled", status: "Cancelled" },
    { id: "archived", status: "Archived" },
  ];

  assert.equal(ARCHIVED_ORDER_STATUS, "Archived");
  assert.deepEqual(orders.filter(isActiveOrder).map((order) => order.id), ["planned", "progress"]);
  assert.deepEqual(orders.filter(isHistoricalOrder).map((order) => order.id), ["completed", "cancelled", "archived"]);
});

test("order deletion is an admin-only archive in both storage backends", async () => {
  const [dashboard, sitesRoute, mongoRoute, permissions] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("app/auth/permissions.ts"),
  ]);

  assert.match(dashboard, /Delete order/);
  assert.match(dashboard, /moved to Order History/i);
  assert.match(dashboard, /type:\s*"order"/);
  assert.match(dashboard, /activeOrders\s*=\s*visibleOrders\.filter\(isActiveOrder\)/);
  assert.match(dashboard, /historicalOrders\s*=\s*visibleOrders\.filter\(isHistoricalOrder\)/);
  assert.match(sitesRoute, /type === "order"[\s\S]*user\.role !== "admin"/);
  assert.match(sitesRoute, /db\.update\(orders\)\.set\(\{ status: ARCHIVED_ORDER_STATUS \}\)/);
  assert.match(mongoRoute, /type === "order"[\s\S]*context\.userRole !== "admin"/);
  assert.match(mongoRoute, /collections\.orders\.updateOne\(\{ id \}, \{ \$set: \{ status: ARCHIVED_ORDER_STATUS \} \}\)/);
  assert.match(permissions, /activeOrders = ownOrders\.filter\(isActiveOrder\)/);
});

test("admin and accountant can edit complete vendor profiles", async () => {
  const [dashboard, sitesRoute, mongoRoute, permissions] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("app/auth/permissions.ts"),
  ]);

  assert.match(permissions, /canEditVendorProfile/);
  assert.match(permissions, /\["admin", "accountant"\]/);
  assert.match(dashboard, /editingVendor/);
  assert.match(dashboard, /Edit vendor profile/);
  assert.match(dashboard, /defaultValue=\{editingVendor\?\.contactPerson/);
  assert.match(sitesRoute, /type === "vendor"[\s\S]*canEditVendorProfile\(user\.role\)/);
  assert.match(mongoRoute, /type === "vendor"[\s\S]*canEditVendorProfile\(userRole\)/);
});

test("vendor order assignments can be removed without deleting catalog products", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /Remove assignment/);
  assert.match(dashboard, /type:\s*"orderVendor"/);
  assert.match(sitesRoute, /type === "orderVendor"[\s\S]*db\.delete\(orderVendors\)\.where\(eq\(orderVendors\.id, id\)\)/);
  assert.match(mongoRoute, /type === "orderVendor"[\s\S]*collections\.orderVendors\.deleteOne\(\{ id \}\)/);
});
