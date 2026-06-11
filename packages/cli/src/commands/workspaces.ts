import { existsSync } from "node:fs";
import path from "node:path";

import { isAgentMeshWorkspace } from "@agentmesh/runtime/src/calls/history.js";
import {
  disableRegisteredWorkspace,
  enableRegisteredWorkspace,
  listRegisteredWorkspaces,
  registerWorkspace,
  type WorkspaceRegistryEntry,
} from "@agentmesh/runtime/src/workspaces/registry.js";
import { optionValue, positionalArgs } from "../flags.js";

export function workspacesCommand(args: string[]): number {
  const [subcommand, ...rest] = args;
  if (subcommand === "list") {
    return workspacesList(rest);
  }
  if (subcommand === "add") {
    return workspacesAdd(rest);
  }
  if (subcommand === "enable") {
    return workspacesEnable(rest);
  }
  if (subcommand === "disable") {
    return workspacesDisable(rest);
  }
  usage();
  return 2;
}

function workspacesList(args: string[]): number {
  const json = args.includes("--json");
  const positional = positionalArgs(args);
  if (positional.length !== 0) {
    console.error("usage: agentmesh workspaces list [--json]");
    return 2;
  }
  const workspaces = listRegisteredWorkspaces().map(withDiagnostics);
  if (json) {
    console.log(JSON.stringify({ schema_version: 1, workspaces }, null, 2));
    return 0;
  }
  for (const workspace of workspaces) {
    console.log([
      workspace.id,
      workspace.enabled ? "enabled" : "disabled",
      workspace.exists ? "present" : "missing",
      workspace.label,
      workspace.path,
    ].join("\t"));
  }
  return 0;
}

function workspacesAdd(args: string[]): number {
  const json = args.includes("--json");
  const positional = positionalArgs(args);
  const workspace = positional[0];
  if (!workspace || positional.length !== 1) {
    console.error("usage: agentmesh workspaces add <path> [--label <label>] [--json]");
    return 2;
  }
  const workspacePath = path.resolve(process.cwd(), workspace);
  if (!isAgentMeshWorkspace(workspacePath)) {
    throw new Error(`not an AgentMesh workspace: ${workspacePath}`);
  }
  const entry = registerWorkspace(workspacePath, { label: optionValue(args, "--label") });
  if (json) {
    console.log(JSON.stringify({ workspace: withDiagnostics(entry) }, null, 2));
  } else {
    console.log(`Added workspace: ${entry.id}`);
    console.log(`Label: ${entry.label}`);
    console.log(`Path: ${entry.path}`);
  }
  return 0;
}

function workspacesEnable(args: string[]): number {
  return setWorkspaceEnabled(args, true);
}

function workspacesDisable(args: string[]): number {
  return setWorkspaceEnabled(args, false);
}

function setWorkspaceEnabled(args: string[], enabled: boolean): number {
  const json = args.includes("--json");
  const positional = positionalArgs(args);
  const workspaceId = positional[0];
  if (!workspaceId || positional.length !== 1) {
    console.error(`usage: agentmesh workspaces ${enabled ? "enable" : "disable"} <workspace-id> [--json]`);
    return 2;
  }
  const entry = enabled
    ? enableRegisteredWorkspace(workspaceId)
    : disableRegisteredWorkspace(workspaceId);
  if (json) {
    console.log(JSON.stringify({ workspace: withDiagnostics(entry) }, null, 2));
  } else {
    console.log(`${enabled ? "Enabled" : "Disabled"} workspace: ${entry.id}`);
  }
  return 0;
}

function usage(): void {
  console.error(
    [
      "usage: agentmesh workspaces <command>",
      "commands:",
      "  workspaces list [--json]",
      "  workspaces add <path> [--label <label>] [--json]",
      "  workspaces enable <workspace-id> [--json]",
      "  workspaces disable <workspace-id> [--json]",
    ].join("\n"),
  );
}

function withDiagnostics(entry: WorkspaceRegistryEntry): WorkspaceRegistryEntry & { exists: boolean } {
  return {
    ...entry,
    exists: existsSync(entry.path),
  };
}
