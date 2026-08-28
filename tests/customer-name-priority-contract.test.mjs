import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("customer name is the primary label and company name is optional", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /customer\?\.name\.trim\(\) \|\| customer\?\.businessName\.trim\(\)/);
  assert.match(dashboard, /Field label="Customer name \*"/);
  assert.match(dashboard, /Field label="Company name \(optional\)"/);
  assert.doesNotMatch(dashboard, /name="businessName" required/);
  assert.equal(dashboard.includes(">{customer.businessName}</"), false);
  assert.match(dashboard, /customerDisplayName\(customerById\(order\.customerId\)\)/);
  assert.match(dashboard, /customerDisplayName\(customerById\(payment\.customerId\)\)/);

  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /required\(payload, \["name", "phone"\]\)/);
    assert.doesNotMatch(source, /required\(payload, \["name", "businessName", "phone"\]\)/);
    assert.match(source, /businessName: clean\(payload\.businessName\)/);
  }
});
