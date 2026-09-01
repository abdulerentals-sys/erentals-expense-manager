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

test("orders support several supervisors while preserving legacy assignments", async () => {
  const helpers = await loadTypeScriptModule("app/order-supervisors.ts");

  assert.deepEqual(helpers.normalizeSupervisorIds(["supervisor-1", "supervisor-2", "supervisor-1", ""]), ["supervisor-1", "supervisor-2"]);
  assert.deepEqual(helpers.orderSupervisorIds({ assignedPersonId: "legacy-supervisor" }), ["legacy-supervisor"]);
  assert.deepEqual(helpers.orderSupervisorIds({ assignedPersonId: "supervisor-1", supervisorIds: ["supervisor-1", "supervisor-2"] }), ["supervisor-1", "supervisor-2"]);
  assert.equal(helpers.isOrderSupervisor({ assignedPersonId: "supervisor-1", supervisorIds: ["supervisor-1", "supervisor-2"] }, "supervisor-2"), true);
});

test("multiple supervisor assignments are persisted and enforced by both storage backends", async () => {
  const [dashboard, permissions, schema, ensure, sitesRoute, mongoRoute, migration] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/auth/permissions.ts"),
    read("db/schema.ts"),
    read("db/ensure.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
    read("drizzle/0012_sour_exodus.sql"),
  ]);

  assert.match(dashboard, /TeamPersonMultiSelect/);
  assert.match(dashboard, /name="supervisorIds"/);
  assert.match(dashboard, /Supervisor\(s\) \*/);
  assert.match(dashboard, /orderSupervisorIds\(order\)/);
  assert.match(permissions, /isOrderSupervisor\(order, currentPersonId\)/);
  assert.match(schema, /supervisorIds: text\("supervisor_ids"/);
  assert.match(ensure, /supervisor_ids text DEFAULT '\[\]' NOT NULL/);
  assert.match(migration, /ALTER TABLE `orders` ADD `supervisor_ids` text DEFAULT '\[\]' NOT NULL/);

  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /normalizeSupervisorIds\(payload\.supervisorIds \?\? payload\.assignedPersonId\)/);
    assert.match(source, /isOrderSupervisor/);
    assert.match(source, /supervisorIds/);
    assert.match(source, /Select at least one supervisor/);
  }
});

test("authorized users can edit an existing customer profile", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /editingCustomer/);
  assert.match(dashboard, /Edit customer/);
  assert.match(dashboard, /Customer updated successfully/);
  assert.match(dashboard, /defaultValue=\{editingCustomer\?\.name/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /type === "customer"/);
    assert.match(source, /Customer not found/);
    assert.match(source, /customers.*update|updateOne/s);
  }
});

test("expense references stay server-generated and are removed from write responses", async () => {
  const [sitesRoute, mongoRoute] = await Promise.all([
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /expenseNo: createExpenseNumber\(new Date\(createdAt\)\)/);
    assert.match(source, /record: \{ \.\.\.row, expenseNo: "" \}/);
  }
});
