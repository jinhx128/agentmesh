import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  formatLocalTimestamp,
  nextTimestampedId,
  reserveTimestampedId,
} from "../packages/runtime/src/generated-id.js";

function makeSandbox(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-generated-id-"));
}

test("timestamped ids use local compact time and numeric collision suffixes", () => {
  const root = makeSandbox();
  test.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "records");
  mkdirSync(directory, { recursive: true });
  const timestamp = new Date(2026, 5, 16, 10, 42, 52);

  assert.equal(formatLocalTimestamp(timestamp), "20260616104252");
  assert.equal(nextTimestampedId("preset", directory, timestamp), "preset-20260616104252");

  mkdirSync(path.join(directory, "preset-20260616104252"));
  mkdirSync(path.join(directory, "preset-20260616104252-1"));

  assert.equal(nextTimestampedId("preset", directory, timestamp), "preset-20260616104252-2");
});

test("timestamped id reservation creates the selected directory atomically", () => {
  const root = makeSandbox();
  test.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "records");
  const timestamp = new Date(2026, 5, 16, 10, 42, 52);

  const first = reserveTimestampedId("workflow", directory, timestamp);
  const second = reserveTimestampedId("workflow", directory, timestamp);

  assert.equal(first.id, "workflow-20260616104252");
  assert.equal(second.id, "workflow-20260616104252-1");
  assert.equal(first.path, path.join(directory, first.id));
  assert.equal(second.path, path.join(directory, second.id));
});
