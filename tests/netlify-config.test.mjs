import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Netlify build, storage dependencies, and schema migration are configured", async () => {
  const [packageText, config, migration] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../netlify.toml", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../netlify/database/migrations/20260824090000_create_expense_manager.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.match(packageJson.scripts["build:netlify"], /next build --webpack/);
  assert.equal(packageJson.dependencies["@netlify/database"], "2.0.0");
  assert.equal(packageJson.dependencies["@netlify/blobs"], "11.0.1");
  assert.match(config, /command = "npm run build:netlify"/);
  assert.match(config, /NODE_VERSION = "22\.13\.0"/);

  for (const table of ["customers", "persons", "orders", "invoices", "expenses", "payments"]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table} \\(`));
  }
});
