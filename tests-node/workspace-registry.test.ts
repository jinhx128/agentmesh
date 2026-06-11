import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  currentWorkspaceRegistryEntry,
  disableRegisteredWorkspace,
  enableRegisteredWorkspace,
  listRegisteredWorkspaces,
  recordWorkspaceActivity,
  registerWorkspace,
  resolveRegisteredWorkspace,
  workspaceIdForPath,
} from "../packages/runtime/src/workspaces/registry.js";

function makeSandbox(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-workspace-registry-"));
}

function makeWorkspace(root: string, name: string): string {
  const workspace = path.join(root, name);
  mkdirSync(path.join(workspace, ".agentmesh"), { recursive: true });
  return workspace;
}

test("workspace registry realpaths paths and updates stable entries", () => {
  const root = makeSandbox();
  test.after(() => rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, "home", ".config", "agentmesh", "workspaces.json");
  const workspace = makeWorkspace(root, "project-a");
  const link = path.join(root, "project-link");
  symlinkSync(workspace, link);

  const first = registerWorkspace(workspace, {
    registryPath,
    label: "Project A",
    now: "2026-06-10T10:00:00.000Z",
  });
  const second = recordWorkspaceActivity(link, {
    registryPath,
    now: "2026-06-10T10:05:00.000Z",
  });

  assert.equal(first.id, workspaceIdForPath(workspace));
  assert.equal(second.id, first.id);
  assert.equal(second.path, first.path);
  assert.equal(second.label, "Project A");
  assert.equal(second.created_at, "2026-06-10T10:00:00.000Z");
  assert.equal(second.last_seen_at, "2026-06-10T10:05:00.000Z");
  assert.equal(second.last_recorded_at, "2026-06-10T10:05:00.000Z");

  const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as {
    schema_version: number;
    workspaces: unknown[];
  };
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.workspaces.length, 1);
  assert.deepEqual(listRegisteredWorkspaces({ registryPath }).map((entry) => entry.id), [first.id]);
});

test("workspace registry resolves enabled entries and current workspace scope", () => {
  const root = makeSandbox();
  test.after(() => rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, "workspaces.json");
  const current = makeWorkspace(root, "current");
  const remote = makeWorkspace(root, "remote");

  const remoteEntry = registerWorkspace(remote, {
    registryPath,
    now: "2026-06-10T11:00:00.000Z",
  });
  const currentEntry = currentWorkspaceRegistryEntry(current, {
    now: "2026-06-10T11:01:00.000Z",
  });

  assert.equal(resolveRegisteredWorkspace(remoteEntry.id, { registryPath })?.path, remoteEntry.path);
  disableRegisteredWorkspace(remoteEntry.id, {
    registryPath,
    now: "2026-06-10T11:02:00.000Z",
  });
  assert.equal(resolveRegisteredWorkspace(remoteEntry.id, { registryPath }), undefined);
  assert.equal(
    resolveRegisteredWorkspace(currentEntry.id, { registryPath, currentWorkspace: current })?.path,
    currentEntry.path,
  );
  enableRegisteredWorkspace(remoteEntry.id, {
    registryPath,
    now: "2026-06-10T11:03:00.000Z",
  });
  assert.equal(resolveRegisteredWorkspace(remoteEntry.id, { registryPath })?.enabled, true);
});

test("workspace registry reports invalid registry files clearly", () => {
  const root = makeSandbox();
  test.after(() => rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, "workspaces.json");
  writeFileSync(registryPath, "{nope\n");

  assert.throws(
    () => listRegisteredWorkspaces({ registryPath }),
    /workspace registry invalid JSON/,
  );
});
