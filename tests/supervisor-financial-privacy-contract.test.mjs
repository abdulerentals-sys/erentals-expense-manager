import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function loadPermissions() {
  const team = await read("app/auth/team.ts");
  const supervisors = await read("app/order-supervisors.ts");
  const permissions = (await read("app/auth/permissions.ts"))
    .replace('import { resolveUserPersonId } from "./team";\n', "")
    .replace('import { isOrderSupervisor, orderSupervisorIds } from "../order-supervisors";\n', "");
  const source = `${team}\n${supervisors}\n${permissions}`;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

test("supervisor API data removes payments and vendor prices", async () => {
  const { filterRecordData } = await loadPermissions();
  const data = {
    customers: [{ id: "customer-1", name: "Customer", openingBalance: 8000 }],
    persons: [{ id: "supervisor-1", name: "Supervisor", role: "Supervisor", status: "Active", email: "supervisor@example.com", paymentMode: "Bank transfer" }],
    vendors: [{ id: "vendor-1", name: "Vendor", phone: "9999999999" }],
    vendorProducts: [{ id: "product-1", vendorId: "vendor-1", name: "Stage", rentalCharge: 12000 }],
    orders: [{ id: "order-1", assignedPersonId: "supervisor-1", status: "In progress", customerId: "customer-1", contractValue: 50000 }],
    orderProducts: [{ id: "order-product-1", orderId: "order-1", name: "Stage", price: 12000, amount: 12000 }],
    orderVendors: [{ id: "assignment-1", orderId: "order-1", vendorId: "vendor-1", amount: 12000, unitRate: 12000 }],
    invoices: [],
    expenses: [],
    payments: [{ id: "payment-1", orderId: "order-1", direction: "Paid", amount: 5000 }],
  };

  const result = filterRecordData(data, "supervisor", "supervisor-1", "Supervisor", "supervisor@example.com");
  assert.deepEqual(result.payments, []);
  assert.equal(result.customers[0].openingBalance, 0);
  assert.equal(result.persons[0].paymentMode, "");
  assert.equal(result.vendorProducts[0].rentalCharge, 0);
  assert.equal(result.orderProducts[0].price, 0);
  assert.equal(result.orderProducts[0].amount, 0);
  assert.equal(result.orderVendors[0].unitRate, 0);
  assert.equal(result.orderVendors[0].amount, 0);
});

test("supervisor UI omits payment records and vendor price placeholders", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");

  assert.match(dashboard, /visibleOrderPayments = user\.role === "supervisor" \? \[\] : orderPayments/);
  assert.match(dashboard, /user\.role === "supervisor" \? "No vendor assignments or expenses have been recorded for this order\."/);
  assert.doesNotMatch(dashboard, /Price hidden|Item price hidden/);
});

test("the injected Netlify badge is hidden by the application stylesheet", async () => {
  const css = await read("app/globals.css");

  assert.match(css, /#nl-badge-frame\s*\{[^}]*display:\s*none\s*!important/);
});
