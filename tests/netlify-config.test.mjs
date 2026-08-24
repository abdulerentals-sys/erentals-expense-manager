import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Netlify build, MongoDB persistence, and document storage are configured", async () => {
  const [packageText, config, envExample, mongoAdapter] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../app/api/records/mongodb.ts", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.match(packageJson.scripts["build:netlify"], /next build --webpack/);
  assert.equal(packageJson.dependencies.mongodb, "7.5.0");
  assert.equal(packageJson.dependencies["@netlify/database"], undefined);
  assert.equal(packageJson.dependencies["@netlify/blobs"], "11.0.1");
  assert.match(config, /command = "npm run build:netlify"/);
  assert.match(config, /NODE_VERSION = "22\.13\.0"/);
  assert.match(config, /MONGODB_DB_NAME = "erentals_expense_manager"/);
  assert.match(envExample, /^MONGODB_URI=/m);
  assert.match(envExample, /^MONGODB_DB_NAME=erentals_expense_manager$/m);
  assert.match(mongoAdapter, /new MongoClient\(uri/);

  for (const collection of ["customers", "persons", "orders", "invoices", "expenses", "payments"]) {
    assert.match(mongoAdapter, new RegExp(`collection<[^>]+>\\("${collection}"\\)`));
    assert.match(mongoAdapter, new RegExp(`collections\\.${collection}\\.insertOne\\(`));
  }

  for (const reference of ["orderNo", "invoiceNo", "expenseNo"]) {
    assert.match(mongoAdapter, new RegExp(`${reference}: 1`));
  }
});
