import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCallRecord,
  completeCallRecord,
  listCallResultEvents,
  markCallResult,
  selectCallResult,
} from "@agentmesh/runtime/src/calls/history.js";

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "agentmesh-result-status-"));
}

function call(workspacePath: string, comparisonGroupId?: string) {
  return createCallRecord({
    workspace: workspacePath,
    cwd: workspacePath,
    agentId: "reviewer",
    adapter: "command",
    promptSource: "inline",
    promptContent: "review this",
    comparisonGroupId,
  });
}

function finish(created: ReturnType<typeof call>): void {
  completeCallRecord(created, { status: "success", stdout: "answer" });
}

test("single-agent result can be marked and re-marked without adoption artifacts", () => {
  const root = workspace();
  test.after(() => rmSync(root, { recursive: true, force: true }));
  const created = call(root);
  finish(created);

  const accepted = markCallResult({
    callDir: created.callDir,
    status: "accepted",
    updatedByEntrypoint: "cli",
    reason: "used",
  });
  assert.equal(accepted.result_status, "accepted");
  const rejected = markCallResult({
    callDir: created.callDir,
    status: "rejected",
    updatedByEntrypoint: "studio",
  });
  assert.equal(rejected.result_status, "rejected");
  assert.equal(existsSync(path.join(created.callDir, "adoption.jsonl")), false);
  assert.equal(listCallResultEvents(created.callDir).length, 2);
});

test("selecting a result only works within the same comparison group and supersedes the previous choice", () => {
  const root = workspace();
  test.after(() => rmSync(root, { recursive: true, force: true }));
  const first = call(root, "group-1");
  const second = call(root, "group-1");
  finish(first);
  finish(second);
  markCallResult({ callDir: first.callDir, status: "accepted", updatedByEntrypoint: "cli" });

  const selected = selectCallResult({
    callDir: second.callDir,
    updatedByEntrypoint: "studio",
  });
  assert.equal(selected.result_status, "accepted");
  assert.equal(selected.replaced_by_call_id, null);
  const firstEvents = listCallResultEvents(first.callDir);
  assert.equal(firstEvents.at(-1)?.status, "superseded");
  assert.equal(firstEvents.at(-1)?.replaced_by_call_id, second.record.id);

  assert.throws(() => selectCallResult({
    callDir: call(root).callDir,
    updatedByEntrypoint: "cli",
  }), /comparison group/);
});
