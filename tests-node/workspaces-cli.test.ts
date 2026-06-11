import assert from "node:assert/strict";
import {
  mkdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import { makeWorkspace, runCli } from "./helpers/write-side-runtime.js";

test("agentmesh workspaces imports and toggles registered workspaces", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const remote = path.join(workspace, "remote-project");
  mkdirSync(path.join(remote, ".agentmesh"), { recursive: true });

  const added = runCli(workspace, [
    "workspaces",
    "add",
    remote,
    "--label",
    "Remote Project",
    "--json",
  ]);
  assert.equal(added.status, 0, added.stderr);
  const addedPayload = JSON.parse(added.stdout) as {
    workspace: { id: string; path: string; label: string; enabled: boolean; exists: boolean };
  };
  assert.equal(addedPayload.workspace.path, realpathSync(remote));
  assert.equal(addedPayload.workspace.label, "Remote Project");
  assert.equal(addedPayload.workspace.enabled, true);
  assert.equal(addedPayload.workspace.exists, true);

  const listed = runCli(workspace, ["workspaces", "list", "--json"]);
  assert.equal(listed.status, 0, listed.stderr);
  const listedPayload = JSON.parse(listed.stdout) as {
    workspaces: Array<{ id: string; label: string; enabled: boolean }>;
  };
  assert.deepEqual(listedPayload.workspaces.map((entry) => entry.label), ["Remote Project"]);

  const disabled = runCli(workspace, [
    "workspaces",
    "disable",
    addedPayload.workspace.id,
    "--json",
  ]);
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal((JSON.parse(disabled.stdout) as { workspace: { enabled: boolean } }).workspace.enabled, false);

  const enabled = runCli(workspace, [
    "workspaces",
    "enable",
    addedPayload.workspace.id,
    "--json",
  ]);
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.equal((JSON.parse(enabled.stdout) as { workspace: { enabled: boolean } }).workspace.enabled, true);
});

test("agentmesh workspaces add rejects non-AgentMesh directories", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const plain = path.join(workspace, "plain-project");
  mkdirSync(plain, { recursive: true });

  const result = runCli(workspace, ["workspaces", "add", plain]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not an AgentMesh workspace/);
});
