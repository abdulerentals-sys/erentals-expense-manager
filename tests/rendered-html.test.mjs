import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("build contains production metadata and the social card", async () => {
  const worker = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
  const socialCard = await stat(new URL("../dist/client/og.png", import.meta.url));

  assert.match(worker, /title: "eRentals Expense Manager"/);
  assert.match(worker, /description: "Customers, invoices, orders and expenses — connected\."/);
  assert.match(worker, /url: "\/og\.png"/);
  assert.doesNotMatch(worker, /codex-preview/);
  assert.ok(socialCard.size > 100_000, "social card should be a real production image");
});
