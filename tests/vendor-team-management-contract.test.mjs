import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("vendor catalog products can be edited and removed without losing order history", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /Edit product/);
  assert.match(dashboard, /Delete product/);
  assert.match(dashboard, /editingVendorProduct/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /type === "vendorProduct"/);
    assert.match(source, /export async function DELETE/);
    assert.match(source, /status: "Deleted"/);
  }
});

test("vendor products support quantity, length and area calculations", async () => {
  const [dashboard, pricing, schema, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/vendor-pricing.ts"),
    read("db/schema.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  for (const type of ["Quantity-wise", "Length-wise", "Area-based"]) {
    assert.match(pricing, new RegExp(type));
  }
  assert.match(dashboard, /productTypes\.map/);
  assert.match(schema, /productType: text\("product_type"\)/);
  assert.match(schema, /measurement: real\("measurement"\)/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /productType/);
    assert.match(source, /measurement/);
    assert.match(source, /calculateTentativeCost/);
  }
});

test("dashboard accounts link explicitly to People instead of requiring matching emails", async () => {
  const [types, usersApi, usersUi, permissions, sitesRoute, mongoRoute] = await Promise.all([
    read("app/auth/types.ts"),
    read("app/api/users/route.ts"),
    read("app/components/UserManagement.tsx"),
    read("app/auth/permissions.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(types, /personId: string/);
  assert.match(usersApi, /personId/);
  assert.match(usersUi, /Linked team member/);
  assert.match(permissions, /userPersonId/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.doesNotMatch(source, /must be linked by email/);
    assert.match(source, /userPersonId/);
  }
});

test("login lets the user show and hide the password", async () => {
  const login = await read("app/components/LoginForm.tsx");

  assert.match(login, /showPassword/);
  assert.match(login, /Show password/);
  assert.match(login, /Hide password/);
  assert.match(login, /aria-pressed/);
});
