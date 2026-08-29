import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("sales orders resolve their People role automatically and only ask for a supervisor", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /user\.role === "sales"[\s\S]*type="hidden" name="salespersonId" value=\{editingOrder\?\.salespersonId \|\| data\.currentPersonId \|\| user\.personId\}/);
  assert.match(dashboard, /user\.role === "sales"[\s\S]*:[\s\S]*Salesperson \*/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /resolveUserPersonId/);
    assert.match(source, /Add an active People record with your name and Sales person role/);
    assert.match(source, /Salespeople can only edit orders assigned to their People role/);
  }
});

test("orders persist delivery, pickup schedule, contact, optional products and attachment details without a return venue field", async () => {
  const [dashboard, schema, ensure, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("db/schema.ts"),
    read("db/ensure.ts"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  for (const field of ["deliveryAddress", "deliveryDate", "deliveryTime", "pickupDate", "pickupTime", "contactPerson", "contactPhone", "attachmentKey", "attachmentName", "attachmentType"]) {
    assert.match(dashboard, new RegExp(`name="${field}"|${field}:`));
    assert.match(schema, new RegExp(`${field}:`));
    assert.match(sitesRoute, new RegExp(`${field}: clean\\(payload\\.${field}\\)|${field}: money\\(payload\\.${field}\\)`));
    assert.match(mongoRoute, new RegExp(`${field}: clean\\(payload\\.${field}\\)|${field}: money\\(payload\\.${field}\\)`));
  }
  assert.doesNotMatch(dashboard, /name="pickupAddress"/);
  assert.match(schema, /pickupAddress:/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /pickupAddress: clean\(payload\.pickupAddress\)/);
    assert.doesNotMatch(source, /\["deliveryAddress", "pickupAddress", "contactPerson", "contactPhone"\]/);
  }
  assert.match(dashboard, /name="products"/);
  assert.match(schema, /export const orderProducts/);
  for (const source of [sitesRoute, mongoRoute]) assert.match(source, /orderProductInputs/);
  assert.match(schema, /pickupFromGodown:/);
  assert.match(ensure, /pickup_from_godown integer DEFAULT 0 NOT NULL/);
  assert.match(dashboard, /Pickup from godown/);
  for (const source of [sitesRoute, mongoRoute]) {
    assert.match(source, /validTime/);
    assert.match(source, /Pickup date and time cannot be before delivery date and time/);
  }
});

test("admin and sales order edits accept images, Excel or PDF documents in both storage targets", async () => {
  const [dashboard, uploadTypes, uploadRoute, netlifyUpload] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/upload-types.ts"),
    read("app/api/upload/route.ts"),
    read("app/api/upload/netlify.ts"),
  ]);

  assert.match(dashboard, /image\/\*/);
  assert.match(dashboard, /Attach a new image or document/);
  assert.match(uploadRoute, /kind === "order"/);
  assert.match(uploadTypes, /application\/vnd\.ms-excel/);
  assert.match(uploadTypes, /text\/csv/);
  assert.match(uploadTypes, /image\/jpeg/);
  for (const source of [uploadRoute, netlifyUpload]) {
    assert.match(source, /isSupportedOrderDocument/);
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

test("admin order updates preload and replace vendor assignments in both databases", async () => {
  const [dashboard, sitesRoute, mongoRoute] = await Promise.all([
    read("app/components/ExpenseDashboard.tsx"),
    read("app/api/records/route.ts"),
    read("app/api/records/mongodb.ts"),
  ]);

  assert.match(dashboard, /data\.orderVendors\.filter\(\(assignment\) => assignment\.orderId === editingOrder\.id\)/);
  assert.match(dashboard, /order-vendor-editor/);
  assert.match(dashboard, /Update vendors for this order/);
  assert.match(sitesRoute, /db\.delete\(orderVendors\)\.where\(eq\(orderVendors\.orderId, id\)\)/);
  assert.match(sitesRoute, /db\.insert\(orderVendors\)\.values\(assignmentRows\)/);
  assert.match(mongoRoute, /collections\.orderVendors\.deleteMany\(\{ orderId: id \}/);
  assert.match(mongoRoute, /collections\.orderVendors\.insertMany\(assignmentRows/);
});
