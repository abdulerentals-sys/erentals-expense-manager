import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("sales orders auto-assign the signed-in salesperson and only ask for a supervisor", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /user\.role === "sales"[\s\S]*type="hidden" name="salespersonId" value=\{user\.personId\}/);
  assert.match(dashboard, /user\.role === "sales"[\s\S]*:[\s\S]*Salesperson \*/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /userRole === "sales" \? context\.userPersonId/);
    assert.match(source, /Sales dashboard is not linked to a People record/);
  }
});

test("orders persist delivery, pickup, contact, optional product and attachment details", async () => {
  const [dashboard, schema, ensure, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("db/schema.ts"),
    read("db/ensure.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  for (const field of ["deliveryAddress", "deliveryDate", "deliveryTime", "pickupDate", "pickupTime", "pickupAddress", "contactPerson", "contactPhone", "productName", "productPrice", "attachmentKey", "attachmentName", "attachmentType"]) {
    assert.match(dashboard, new RegExp(`name="${field}"|${field}:`));
    assert.match(schema, new RegExp(`${field}:`));
    assert.match(sitesRoute, new RegExp(`${field}: clean\\(payload\\.${field}\\)|${field}: money\\(payload\\.${field}\\)`));
    assert.match(mongoRoute, new RegExp(`${field}: clean\\(payload\\.${field}\\)|${field}: money\\(payload\\.${field}\\)`));
  }
  assert.match(schema, /pickupFromGodown:/);
  assert.match(ensure, /pickup_from_godown integer DEFAULT 0 NOT NULL/);
  assert.match(dashboard, /Pickup from godown/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /validTime/);
    assert.match(source, /Pickup date and time cannot be before delivery date and time/);
  }
});

test("sales order uploads accept Excel or PDF documents in both storage targets", async () => {
  const [dashboard, uploadRoute, netlifyUpload] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/upload/route.ts"),
    read("app/api/upload/netlify.ts"),
  ]);

  assert.match(dashboard, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  assert.match(dashboard, /Attach product sheet or quotation/);
  assert.match(uploadRoute, /kind === "order"/);
  for (const source of [uploadRoute, netlifyUpload]) {
    assert.match(source, /application\/vnd\.ms-excel/);
    assert.match(source, /text\/csv/);
  }
});

test("an order advance creates a linked receipt and order updates show remaining payment", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /name="advancePayment"/);
  assert.match(dashboard, /Advance payment received/);
  assert.match(dashboard, /Remaining payment/);
  assert.match(dashboard, /editingOrderReceived/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /notes: clean\(payload\.advanceNotes\) \|\| "Advance payment received during order creation"/);
    assert.match(source, /orderId: row\.id/);
    assert.match(source, /customerId/);
  }
});
