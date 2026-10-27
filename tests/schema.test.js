import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseImport } from "../src/logic.js";

test("readme and schema doc include the fake example", () => {
  const example = fs.readFileSync(new URL("./fixtures/example.json", import.meta.url), "utf8").trim();
  const schema = fs.readFileSync("docs/schema.md", "utf8");
  const readme = fs.readFileSync("README.md", "utf8");
  assert.ok(schema.includes(example));
  assert.ok(readme.includes(example));
  const parsed = parseImport(example);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.days[0].exercises[1].baseWeightLb, 120);
  assert.equal(parsed.value.days[0].exercises[2].bodyweight, true);
  assert.equal(parsed.value.sessions[0].entries.length, 4);
});
