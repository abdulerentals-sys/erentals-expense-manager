import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("vendor catalog pricing calculates per event and per day totals", async () => {
  const source = await read("app/vendor-pricing.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const pricing = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

  assert.equal(pricing.calculateTentativeCost(2500, "Per event", 3, 4), 7500);
  assert.equal(pricing.calculateTentativeCost(2500, "Per day", 3, 4), 30000);
  assert.equal(pricing.calculateTentativeCost(100, "Per event", 12.5, 1), 1250);
  assert.equal(pricing.normalizeMeasurement(2.6, "Quantity-wise"), 3);
  assert.equal(pricing.normalizeMeasurement(12.45, "Length-wise"), 12.45);
  assert.equal(pricing.normalizeMeasurement(80.25, "Area-based"), 80.25);
  assert.equal(pricing.calculateTentativeCost(-10, "Per day", 3, 4), 0);
});

test("vendor products are stored in both deployment databases", async () => {
  const [schema, ensure, mongo] = await Promise.all([
    read("db/schema.ts"),
    read("db/ensure.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(schema, /export const vendorProducts/);
  assert.match(schema, /pricingBasis: text\("pricing_basis"\)/);
  assert.match(schema, /rentalCharge: integer\("rental_charge"\)/);
  assert.match(schema, /productId: text\("product_id"\)/);
  assert.match(ensure, /CREATE TABLE IF NOT EXISTS vendor_products/);
  assert.match(mongo, /vendorProducts: Collection<VendorProduct>/);
  assert.match(mongo, /db\.collection<VendorProduct>\("vendor_products"\)/);
});

test("vendor catalog and assignment permissions preserve private pricing", async () => {
  const permissions = await read("app/auth/permissions.ts");

  assert.match(permissions, /RecordType[^;]+"vendorProduct"/);
  assert.match(permissions, /admin:[^\n]+"vendorProduct"/);
  assert.match(permissions, /accountant:[^\n]+"vendorProduct"/);
  assert.doesNotMatch(permissions, /supervisor:[^\n]+"vendorProduct"/);
  assert.match(permissions, /vendorProducts:[^\n]+rentalCharge: 0/);
  assert.match(permissions, /orderVendors:[^\n]+unitRate: 0/);
});

test("vendor dashboard exposes catalog workflows and calculated cost preview", async () => {
  const dashboard = await read("app/components/ExpenseDashboard.tsx");

  assert.match(dashboard, /function VendorDashboard/);
  assert.match(dashboard, /Open dashboard/);
  assert.match(dashboard, /kind === "vendorProduct"/);
  assert.match(dashboard, /name="pricingBasis"/);
  assert.match(dashboard, /name="rentalCharge"/);
  assert.match(dashboard, /name="productId"/);
  assert.match(dashboard, /Tentative cost/);
  assert.match(dashboard, /Cost calculated privately from the vendor catalog/);
});

test("both record APIs validate catalog ownership and calculate tentative cost", async () => {
  const sources = await Promise.all([
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  for (const source of sources) {
    assert.match(source, /type === "vendorProduct"/);
    assert.match(source, /product\.vendorId !== vendorId/);
    assert.match(source, /calculateTentativeCost/);
    assert.match(source, /userRole === "supervisor"[^\n]+calculatedAmount/);
    assert.match(source, /amount: 0, unitRate: 0/);
  }
});
