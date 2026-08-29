import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadPermissions() {
  const team = await read("app/auth/team.ts");
  const permissions = (await read("app/auth/permissions.ts")).replace('import { resolveUserPersonId } from "./team";\n', "");
  const source = `${team}\n${permissions}`;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("supervisor workspace is ownership-scoped and has read-only history", async () => {
  const [permissions, dashboard, route] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
  ]);
  assert.match(permissions, /"history"/);
  assert.match(permissions, /filterRecordData[\s\S]*userPersonId[\s\S]*userName[\s\S]*userEmail/);
  assert.match(permissions, /status !== "Completed"/);
  assert.match(dashboard, /href: "\/history"/);
  assert.match(dashboard, /function SupervisorHistoryPage/);
  assert.match(route, /filterRecordData\(data, user\.role, user\.personId, user\.name, user\.email\)/);
});

test("supervisor records never expose legacy invoices or their attachment keys", async () => {
  const { filterRecordData } = await loadPermissions();
  const invoice = {
    id: "invoice-1",
    orderId: "order-1",
    total: 250000,
    attachmentKey: "documents/legacy/private-invoice.pdf",
  };
  const data = {
    customers: [],
    persons: [{ id: "supervisor-1", name: "Supervisor", role: "Supervisor", status: "Active", email: "supervisor@example.com" }],
    vendors: [],
    vendorProducts: [],
    orders: [{ id: "order-1", assignedPersonId: "supervisor-1", status: "In progress", customerId: "customer-1" }],
    orderProducts: [],
    orderVendors: [],
    invoices: [invoice],
    expenses: [],
    payments: [],
  };

  const supervisorData = filterRecordData(data, "supervisor", "supervisor-1", "Supervisor", "supervisor@example.com");
  assert.deepEqual(supervisorData.invoices, []);
  assert.equal(JSON.stringify(supervisorData).includes(invoice.attachmentKey), false);

  assert.strictEqual(filterRecordData(data, "admin"), data);
  assert.strictEqual(filterRecordData(data, "accountant"), data);
});

test("supervisors can assign catalog products without viewing or overriding prices", async () => {
  const [permissions, dashboard, route, mongo] = await Promise.all([
    read("app/auth/permissions.ts"),
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);
  assert.match(permissions, /supervisor:[^\n]*"orderVendor"/);
  assert.match(dashboard, /user\.role !== "supervisor"[\s\S]*Final cost override/);
  assert.match(dashboard, /user\.role === "supervisor"[\s\S]*Cost calculated privately/);
  for (const source of [route, mongo]) {
    assert.match(source, /userRole === "supervisor"/);
    assert.match(source, /userRole === "supervisor" \? calculatedAmount/);
    assert.match(source, /amount: 0, unitRate: 0/);
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
    assert.match(source, /Add an active People record with your name and Supervisor role/);
  }
});

test("supervisor order edits cannot change financial or ownership fields", async () => {
  const [route, mongo] = await Promise.all([
    read("app/api/records/route.ts"), read("app/api/records/mongodb.ts"),
  ]);
  for (const source of [route, mongo]) {
    assert.match(source, /Only an administrator, assigned salesperson or assigned supervisor can edit orders/);
    assert.match(source, /(user\.role|userRole) === "supervisor"/);
    assert.match(source, /assignedPersonId/);
  }
});
