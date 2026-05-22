import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import {
  BUILTIN_WORKFLOWS,
  findRegistryWorkflow,
  formatWorkflow,
  generateWorkflowRegistrationId,
  listWorkflows as listRuntimeWorkflows,
  loadWorkflowFile,
  workflowRegistryDirForWrite,
  workflowSearchDirs,
} from "@agentmesh/runtime/src/workflow/registry.js";
import {
  getWorkflow as getSdkWorkflow,
  listWorkflows as listSdkWorkflows,
} from "@agentmesh/sdk";
import { positionalArgs } from "../flags.js";

export function workflowsList(args: string[], configPath?: string): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 0) {
    console.error("usage: agentmesh workflows list [--json]");
    return 2;
  }
  const workflows = listSdkWorkflows({ configPath, cwd: process.cwd() });
  if (json) {
    console.log(JSON.stringify(workflows, null, 2));
  } else {
    for (const workflow of workflows) {
      console.log(
        [
          workflow.workflowId,
          workflow.source,
          workflow.stages.join(", "),
          workflow.name,
        ].join("\t"),
      );
    }
  }
  return 0;
}

export function workflowsShow(args: string[], configPath?: string): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const workflowId = positional[0];
  if (!workflowId || positional.length !== 1) {
    console.error("usage: agentmesh workflows show <workflow-id> [--json]");
    return 2;
  }
  const workflow = getSdkWorkflow(workflowId, { configPath, cwd: process.cwd() });
  if (json) {
    console.log(JSON.stringify(workflow, null, 2));
  } else {
    process.stdout.write(formatWorkflow(workflow as unknown as Parameters<typeof formatWorkflow>[0]));
  }
  return 0;
}

export function workflowsAdd(args: string[], configPath?: string): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const workflowPath = positional[0];
  if (!workflowPath || positional.length !== 1) {
    console.error("usage: agentmesh workflows add <workflow-file>");
    return 2;
  }
  const workflowId = generateWorkflowRegistrationId(
    listRuntimeWorkflows(workflowSearchDirs(process.cwd(), configPath)).map((item) => item.workflowId),
  );
  const workflow = loadWorkflowFile(workflowPath, process.cwd(), { workflowId });
  const registryDir = workflowRegistryDirForWrite(process.cwd(), configPath);
  const targetPath = path.join(registryDir, `${workflow.workflowId}.toml`);
  if (existsSync(targetPath)) {
    throw new Error(`workflow file already exists: ${targetPath}`);
  }
  mkdirSync(registryDir, { recursive: true });
  copyFileSync(workflow.path ?? workflowPath, targetPath);
  console.log(`Added workflow: ${workflow.workflowId}`);
  console.log(`Workflow file: ${targetPath}`);
  return 0;
}

export function workflowsUpdate(args: string[], configPath?: string): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const workflowId = positional[0];
  const workflowPath = positional[1];
  if (!workflowId || !workflowPath || positional.length !== 2) {
    console.error("usage: agentmesh workflows update <workflow-id> <workflow-file>");
    return 2;
  }
  const existing = findRegistryWorkflow(workflowId, process.cwd(), configPath);
  if (!existing?.path) {
    if (BUILTIN_WORKFLOWS.some((item) => item.workflowId === workflowId)) {
      throw new Error(`cannot update built-in workflow: ${workflowId}`);
    }
    throw new Error(`workflow not found in user registry: ${workflowId}`);
  }
  const workflow = loadWorkflowFile(workflowPath, process.cwd(), { workflowId });
  copyFileIfDifferent(workflow.path ?? workflowPath, existing.path);
  console.log(`Updated workflow: ${workflow.workflowId}`);
  console.log(`Workflow file: ${existing.path}`);
  return 0;
}

export function workflowsRemove(args: string[], configPath?: string): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const workflowId = positional[0];
  if (!workflowId || positional.length !== 1) {
    console.error("usage: agentmesh workflows remove <workflow-id>");
    return 2;
  }
  const workflow = findRegistryWorkflow(workflowId, process.cwd(), configPath);
  if (!workflow?.path) {
    if (BUILTIN_WORKFLOWS.some((item) => item.workflowId === workflowId)) {
      throw new Error(`cannot remove built-in workflow: ${workflowId}`);
    }
    throw new Error(`workflow not found in user registry: ${workflowId}`);
  }
  unlinkSync(workflow.path);
  console.log(`Removed workflow: ${workflowId}`);
  console.log(`Workflow file: ${workflow.path}`);
  return 0;
}

function copyFileIfDifferent(sourcePath: string, targetPath: string): void {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return;
  }
  copyFileSync(sourcePath, targetPath);
}

function rejectScope(args: string[]): boolean {
  if (!args.includes("--scope")) {
    return false;
  }
  console.error("workflows are global user-level resources; --scope is not supported");
  return true;
}
