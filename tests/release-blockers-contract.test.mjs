import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("every role-visible dashboard section is handled by the dynamic route", async () => {
  const [sectionPage, permissions] = await Promise.all([
    read("app/[section]/page.tsx"),
    read("app/auth/permissions.ts"),
  ]);

  assert.doesNotMatch(sectionPage, /const sections = new Set/);
  assert.match(sectionPage, /if \(!canViewSection\(user\.role, section\)\) redirect\("\/"\)/);
  assert.match(permissions, /admin:[^\n]*"vendors"/);
  assert.match(permissions, /supervisor:[^\n]*"history"/);
});

test("the dashboard uses order values and order IDs without an invoice workspace", async () => {
  const [dashboard, permissions] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/auth/permissions.ts"),
  ]);

  assert.doesNotMatch(dashboard, /href: "\/invoices"/);
  assert.doesNotMatch(dashboard, /function InvoicesPage/);
  assert.doesNotMatch(dashboard, /kind === "invoice"/);
  assert.doesNotMatch(permissions, /\| "invoices"/);
  assert.doesNotMatch(permissions, /\| "invoice"/);
  assert.match(dashboard, /const orderValue = data\.orders\.reduce/);
  assert.match(dashboard, /Every customer receipt and vendor payout is recorded against an order ID/);
});

test("authorized users can edit saved payments with server-side party and order validation", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /editingPayment/);
  assert.match(dashboard, /Edit payment/);
  assert.match(dashboard, /Update payment/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /type === "payment"/);
    assert.match(source, /Your role cannot edit this payment/);
    assert.match(source, /Customer receipts can only use orders belonging to the selected customer/);
    assert.match(source, /Vendor is not assigned to the selected order/);
  }
});
