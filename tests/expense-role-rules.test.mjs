import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadExpenseRules() {
  const helpers = await read("app/order-supervisors.ts");
  const rules = (await read("app/expense-rules.ts")).replace('import { isOrderSupervisor } from "./order-supervisors";\n\n', "");
  const source = `${helpers}\n${rules}`;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("expense categories are fixed and cannot be invented", async () => {
  const rules = await loadExpenseRules();

  assert.deepEqual(rules.EXPENSE_CATEGORIES, [
    "Material rental",
    "Fabrication",
    "Labour",
    "Transport",
    "Venue",
    "Food & hospitality",
    "Printing & branding",
    "Miscellaneous",
  ]);
  assert.equal(rules.isAllowedExpenseCategory("Transport"), true);
  assert.equal(rules.isAllowedExpenseCategory("Personal reimbursement"), false);
  assert.equal(rules.isAllowedExpenseCategory("Personal reimbursement", ["Personal reimbursement"]), true);
});

test("expense responsibility is limited to active salespeople, assigned supervisors, and active managers", async () => {
  const { isExpenseResponsiblePerson } = await loadExpenseRules();
  const order = { assignedPersonId: "supervisor-1", supervisorIds: ["supervisor-1", "supervisor-2"] };

  assert.equal(isExpenseResponsiblePerson({ id: "sales-1", role: "Sales person", status: "Active" }, order), true);
  assert.equal(isExpenseResponsiblePerson({ id: "supervisor-1", role: "Supervisor", status: "Active" }, order), true);
  assert.equal(isExpenseResponsiblePerson({ id: "manager-1", role: "Execution manager", status: "Active" }, order), true);
  assert.equal(isExpenseResponsiblePerson({ id: "supervisor-2", role: "Supervisor", status: "Active" }, order), true);
  assert.equal(isExpenseResponsiblePerson({ id: "supervisor-3", role: "Supervisor", status: "Active" }, order), false);
  assert.equal(isExpenseResponsiblePerson({ id: "sales-2", role: "Sales & billing", status: "Disabled" }, order), false);
  assert.equal(isExpenseResponsiblePerson({ id: "worker-1", role: "Team member", status: "Active" }, order), false);
});

test("D1 and Mongo expense writes enforce role ownership and clear payee fields", async () => {
  const [route, mongo] = await Promise.all([
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  for (const source of [route, mongo]) {
    assert.match(source, /isAllowedExpenseCategory/);
    assert.match(source, /isExpenseResponsiblePerson/);
    assert.match(source, /Supervisor expenses are assigned to your People role automatically/);
    assert.match(source, /Vendor or payee cannot be recorded on an expense/);
    assert.match(source, /vendor:\s*""/);
    assert.match(source, /vendorId:\s*""/);
  }
});
