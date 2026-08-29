import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("order team eligibility comes only from active People roles", async () => {
  const source = await read("app/auth/team.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const team = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  assert.equal(team.isOrderTeamPerson({ id: "person-1", role: "Team member", status: "Active" }, "salesperson"), false);
  assert.equal(team.isOrderTeamPerson({ id: "person-2", role: "Sales & billing", status: "Active" }, "salesperson"), true);
  assert.equal(team.isOrderTeamPerson({ id: "person-3", role: "Execution manager", status: "Active" }, "supervisor"), true);
  assert.equal(team.isOrderTeamPerson({ id: "person-4", role: "Supervisor", status: "Disabled" }, "supervisor"), false);
  assert.equal(team.resolveUserPersonId([
    { id: "person-2", name: "Asha", email: "", role: "Sales person", status: "Active" },
  ], { name: "Asha", email: "different@example.com", role: "sales" }), "person-2");
});

test("order forms and APIs do not depend on Team Access links", async () => {
  const [dashboard, usersUi, usersApi, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/components/UserManagement.tsx"),
    read("app/api/users/route.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /isOrderTeamPerson/);
  assert.doesNotMatch(dashboard, /teamAssignments/);
  assert.doesNotMatch(usersUi, /Linked team member|Save link|name="personId"/);
  assert.doesNotMatch(usersApi, /linkedPersonError|updateUserPerson/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /isOrderTeamPerson/);
    assert.doesNotMatch(source, /teamAssignments/);
  }
});

test("received payments show every customer order and allow a manual order ID", async () => {
  const [dashboard, schema, ensure, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("db/schema.ts"),
    read("db/ensure.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /All .* customer order/);
  assert.match(dashboard, /Enter Order ID manually/);
  assert.match(dashboard, /name="manualOrderId"/);
  assert.match(schema, /manualOrderId: text\("manual_order_id"\)/);
  assert.match(ensure, /manual_order_id/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /manualOrderId/);
    assert.match(source, /Manual Order ID is only available for customer receipts/);
    assert.match(source, /Choose either a listed order or a manual Order ID/);
  }
});
