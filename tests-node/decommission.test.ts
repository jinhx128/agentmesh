import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("python decommission has a tracked deletion checklist", () => {
  const root = process.cwd();
  const docPath = path.join(root, "docs", "python-decommission.md");
  const content = readFileSync(docPath, { encoding: "utf-8" });

  assert.match(content, /Python Decommission/);
  assert.match(content, /src\/agentmesh/);
  assert.match(content, /pyproject\.toml/);
  assert.match(content, /Makefile/);
});

test("legacy Python implementation is removed from the target tree", () => {
  const root = process.cwd();

  assert.equal(existsSync(path.join(root, "src", "agentmesh")), false);
  assert.equal(existsSync(path.join(root, "tests")), false);
  assert.equal(existsSync(path.join(root, "pyproject.toml")), false);
});
