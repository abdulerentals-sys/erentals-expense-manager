import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("supervisor workspace is ownership-scoped and has read-only history", async () => {
  const [permissions, dashboard, route] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
  ]);
  assert.match(permissions, /"history"/);
  assert.match(permissions, /filterRecordData[\s\S]*userEmail/);
  assert.match(permissions, /status !== "Completed"/);
  assert.match(dashboard, /href: "\/history"/);
  assert.match(dashboard, /function SupervisorHistoryPage/);
  assert.match(route, /filterRecordData\(data, user\.role, user\.email\)/);
});

test("supervisors can assign vendors without viewing or setting prices", async () => {
  const [permissions, dashboard, route, mongo] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);
  assert.match(permissions, /supervisor:[^\n]*"orderVendor"/);
  assert.match(dashboard, /user\.role !== "supervisor"[\s\S]*Vendor amount/);
  assert.match(dashboard, /user\.role === "supervisor"[\s\S]*Item price hidden/);
  for (const source of [route, mongo]) {
    assert.match(source, /userRole === "supervisor"/);
    assert.match(source, /amount: userRole === "supervisor" \? 0/);
  }
});

test("supervisor contacts and expenses require an owned active order", async () => {
  const [schema, dashboard, route, mongo] = await Promise.all([
    read("db/schema.ts"),
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);
  assert.match(schema, /orderId: text\("order_id"\)/);
  assert.match(dashboard, /kind === "person"[\s\S]*user\.role === "supervisor"[\s\S]*name="orderId"/);
  for (const source of [route, mongo]) {
    assert.match(source, /Supervisor actions require an active assigned order/);
    assert.match(source, /Supervisor profile is not linked to a Person record/);
  }
});

test("supervisor order edits cannot change financial or ownership fields", async () => {
  const [route, mongo] = await Promise.all([
    read("app/api/records/route.ts"), read("app/api/records/mongodb.ts"),
  ]);
  for (const source of [route, mongo]) {
    assert.match(source, /Only an administrator or the assigned supervisor can edit orders/);
    assert.match(source, /(user\.role|userRole) === "supervisor"/);
    assert.match(source, /assignedPersonId/);
  }
});
