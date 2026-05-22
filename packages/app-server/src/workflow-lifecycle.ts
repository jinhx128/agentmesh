import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  BUILTIN_WORKFLOWS,
  findRegistryWorkflow,
  generateWorkflowRegistrationId,
  listWorkflows as listRuntimeWorkflows,
  loadWorkflowFile,
  workflowRegistryDirForWrite,
  workflowSearchDirs,
} from "@agentmesh/runtime/src/workflow/registry.js";

export interface StudioWorkflowLifecycleOptions {
  cwd?: string;
  configPath?: string;
}

export type StudioWorkflowLifecycleAction = "create" | "update" | "delete";

export interface StudioWorkflowCreateRequest {
  workflow_file?: string;
  workflow_toml?: string;
  source_name?: string;
}

export interface StudioWorkflowUpdateRequest extends StudioWorkflowCreateRequest {}

export interface StudioWorkflowLifecycleRequest {
  action: StudioWorkflowLifecycleAction;
  workflowId?: string;
  create?: StudioWorkflowCreateRequest;
  update?: StudioWorkflowUpdateRequest;
}

export interface StudioWorkflowLifecycleOperation {
  operation_id: string;
  action: StudioWorkflowLifecycleAction;
  status: "running" | "succeeded" | "failed" | "conflict";
  command: string[];
  exit_code: number | null;
  stdout: string;
  stderr: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  workflow_id?: string;
  workflow_file?: string;
}

interface WorkflowLifecycleRuntimeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  workflowId?: string;
  workflowFile?: string;
}

const operations = new Map<string, StudioWorkflowLifecycleOperation>();
const activeKeys = new Set<string>();

export async function runStudioWorkflowLifecycleOperation(
  request: StudioWorkflowLifecycleRequest,
  options: StudioWorkflowLifecycleOptions = {},
): Promise<StudioWorkflowLifecycleOperation> {
  const operationId = `workflow-op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const command = studioWorkflowLifecycleCommand(request, options);
  const workflowSource = request.create ? workflowSourceLabel(request.create) : request.update ? workflowSourceLabel(request.update) : undefined;
  const activeKey = request.action === "update" || request.action === "delete"
    ? `update:${request.workflowId ?? "workflow"}`
    : `${request.action}:${workflowSource ?? "workflow"}`;
  const startedAt = Date.now();
  const operation: StudioWorkflowLifecycleOperation = {
    operation_id: operationId,
    action: request.action,
    status: "running",
    command,
    exit_code: null,
    stdout: "",
    stderr: "",
    started_at: new Date(startedAt).toISOString(),
    ...(request.create?.workflow_file ? { workflow_file: request.create.workflow_file } : {}),
    ...(request.update?.workflow_file ? { workflow_file: request.update.workflow_file } : {}),
  };
  operations.set(operationId, operation);
  if (activeKeys.has(activeKey)) {
    const completedAt = Date.now();
    const conflict: StudioWorkflowLifecycleOperation = {
      ...operation,
      status: "conflict",
      stderr: `workflow lifecycle operation already running for ${workflowSource ?? request.action}`,
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
    };
    operations.set(operationId, conflict);
    return conflict;
  }
  activeKeys.add(activeKey);
  try {
    let result: WorkflowLifecycleRuntimeResult;
    try {
      result = runRuntimeWorkflowLifecycle(request, options);
    } catch (error) {
      const completedAt = Date.now();
      const failed: StudioWorkflowLifecycleOperation = {
        ...operation,
        status: "failed",
        exit_code: 1,
        stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        completed_at: new Date(completedAt).toISOString(),
        duration_ms: completedAt - startedAt,
      };
      operations.set(operationId, failed);
      return failed;
    }
    const completedAt = Date.now();
    const completed: StudioWorkflowLifecycleOperation = {
      ...operation,
      status: result.exitCode === 0 ? "succeeded" : "failed",
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      ...(result.workflowId ? { workflow_id: result.workflowId } : {}),
      ...(result.workflowFile ? { workflow_file: result.workflowFile } : {}),
    };
    operations.set(operationId, completed);
    return completed;
  } finally {
    activeKeys.delete(activeKey);
  }
}

export function readStudioWorkflowLifecycleOperation(
  operationId: string,
): StudioWorkflowLifecycleOperation | undefined {
  return operations.get(operationId);
}

export function studioWorkflowLifecycleCommand(
  request: StudioWorkflowLifecycleRequest,
  options: StudioWorkflowLifecycleOptions = {},
): string[] {
  rejectWorkflowScope(request);
  if (request.action === "create") {
    const create = request.create;
    if (!create) {
      throw new Error("create request is required");
    }
    return withConfigTrace([
      "runtime",
      "workflows",
      "add",
      workflowSourceLabel(create),
    ], options);
  }
  if (request.action === "delete") {
    return withConfigTrace([
      "runtime",
      "workflows",
      "remove",
      safeWorkflowId(request.workflowId),
    ], options);
  }
  if (request.action !== "update") {
    throw new Error(`unsupported workflow lifecycle action: ${String(request.action)}`);
  }
  const update = request.update;
  if (!update) {
    throw new Error("update request is required");
  }
  return withConfigTrace([
    "runtime",
    "workflows",
    "update",
    safeWorkflowId(request.workflowId),
    workflowSourceLabel(update),
  ], options);
}

function runRuntimeWorkflowLifecycle(
  request: StudioWorkflowLifecycleRequest,
  options: StudioWorkflowLifecycleOptions,
): WorkflowLifecycleRuntimeResult {
  if (request.action === "create") {
    const create = request.create;
    if (!create) {
      throw new Error("create request is required");
    }
    return addWorkflowRegistration(create, options);
  }
  if (request.action === "update") {
    const update = request.update;
    if (!update) {
      throw new Error("update request is required");
    }
    return updateWorkflowRegistration(safeWorkflowId(request.workflowId), update, options);
  }
  if (request.action === "delete") {
    return deleteWorkflowRegistration(safeWorkflowId(request.workflowId), options);
  }
  throw new Error(`unsupported workflow lifecycle action: ${String(request.action)}`);
}

function addWorkflowRegistration(
  create: StudioWorkflowCreateRequest,
  options: StudioWorkflowLifecycleOptions,
): WorkflowLifecycleRuntimeResult {
  rejectWorkflowCreateScope(create);
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath;
  const source = materializeWorkflowSource(create, cwd);
  try {
    const existingWorkflows = listRuntimeWorkflows(workflowSearchDirs(cwd, configPath));
    const workflowId = generateWorkflowRegistrationId(existingWorkflows.map((item) => item.workflowId));
    const workflow = loadWorkflowFile(source.path, cwd, { workflowId });
    const registryDir = workflowRegistryDirForWrite(cwd, configPath);
    const targetPath = path.join(registryDir, `${workflow.workflowId}.toml`);
    if (existsSync(targetPath)) {
      throw new Error(`workflow file already exists: ${targetPath}`);
    }
    mkdirSync(registryDir, { recursive: true });
    copyFileSync(workflow.path ?? source.path, targetPath);
    return {
      exitCode: 0,
      stdout: [
        `Added workflow: ${workflow.workflowId}`,
        `Workflow file: ${targetPath}`,
        "",
      ].join("\n"),
      stderr: "",
      workflowId: workflow.workflowId,
      workflowFile: targetPath,
    };
  } finally {
    source.cleanup();
  }
}

function updateWorkflowRegistration(
  workflowId: string,
  update: StudioWorkflowUpdateRequest,
  options: StudioWorkflowLifecycleOptions,
): WorkflowLifecycleRuntimeResult {
  rejectWorkflowCreateScope(update);
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath;
  const existing = findRegistryWorkflow(workflowId, cwd, configPath);
  if (!existing?.path) {
    if (BUILTIN_WORKFLOWS.some((workflow) => workflow.workflowId === workflowId)) {
      throw new Error(`cannot update built-in workflow: ${workflowId}`);
    }
    throw new Error(`workflow not found in user registry: ${workflowId}`);
  }
  const source = materializeWorkflowSource(update, cwd);
  try {
    const workflow = loadWorkflowFile(source.path, cwd, { workflowId });
    copyFileIfDifferent(workflow.path ?? source.path, existing.path);
    return {
      exitCode: 0,
      stdout: [
        `Updated workflow: ${workflow.workflowId}`,
        `Workflow file: ${existing.path}`,
        "",
      ].join("\n"),
      stderr: "",
      workflowId: workflow.workflowId,
      workflowFile: existing.path,
    };
  } finally {
    source.cleanup();
  }
}

function deleteWorkflowRegistration(
  workflowId: string,
  options: StudioWorkflowLifecycleOptions,
): WorkflowLifecycleRuntimeResult {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath;
  const existing = findRegistryWorkflow(workflowId, cwd, configPath);
  if (!existing?.path) {
    if (BUILTIN_WORKFLOWS.some((workflow) => workflow.workflowId === workflowId)) {
      throw new Error(`cannot remove built-in workflow: ${workflowId}`);
    }
    throw new Error(`workflow not found in user registry: ${workflowId}`);
  }
  unlinkSync(existing.path);
  return {
    exitCode: 0,
    stdout: [
      `Removed workflow: ${workflowId}`,
      `Workflow file: ${existing.path}`,
      "",
    ].join("\n"),
    stderr: "",
    workflowId,
    workflowFile: existing.path,
  };
}

function withConfigTrace(command: string[], options: StudioWorkflowLifecycleOptions): string[] {
  return options.configPath ? [...command, "--config", options.configPath] : command;
}

function rejectWorkflowScope(request: StudioWorkflowLifecycleRequest): void {
  if (isRecord(request.create)) {
    rejectWorkflowCreateScope(request.create);
  }
  if (isRecord(request.update)) {
    rejectWorkflowCreateScope(request.update);
  }
}

function rejectWorkflowCreateScope(create: StudioWorkflowCreateRequest): void {
  if (isRecord(create) && (Object.hasOwn(create, "scope") || Object.hasOwn(create, "project_dir"))) {
    throw new Error("workflow scope is not supported; workflows are global user-level resources");
  }
}

function safePathValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.includes("\0")) {
    throw new Error(`${label} cannot contain null bytes`);
  }
  return value;
}

function safeWorkflowId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("workflow_id must be a non-empty string");
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`workflow_id contains unsupported characters: ${value}`);
  }
  return value;
}

function workflowSourceLabel(create: StudioWorkflowCreateRequest): string {
  if (typeof create.workflow_file === "string" && create.workflow_file.trim().length > 0) {
    return safePathValue(create.workflow_file, "workflow_file");
  }
  if (typeof create.workflow_toml === "string" && create.workflow_toml.trim().length > 0) {
    return `uploaded:${safeSourceName(create.source_name, "workflow.toml")}`;
  }
  throw new Error("workflow_toml or workflow_file must be provided");
}

function materializeWorkflowSource(
  create: StudioWorkflowCreateRequest,
  cwd: string,
): { path: string; cleanup: () => void } {
  if (typeof create.workflow_file === "string" && create.workflow_file.trim().length > 0) {
    const workflowFile = safePathValue(create.workflow_file, "workflow_file");
    return {
      path: path.isAbsolute(workflowFile) ? path.resolve(workflowFile) : path.resolve(cwd, workflowFile),
      cleanup: () => undefined,
    };
  }
  if (typeof create.workflow_toml === "string" && create.workflow_toml.trim().length > 0) {
    const tempDir = mkdtempSync(path.join(tmpdir(), "agentmesh-studio-workflow-"));
    const sourcePath = path.join(tempDir, safeSourceName(create.source_name, "workflow.toml"));
    writeFileSync(sourcePath, create.workflow_toml, { encoding: "utf-8" });
    return {
      path: sourcePath,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
  }
  throw new Error("workflow_toml or workflow_file must be provided");
}

function copyFileIfDifferent(sourcePath: string, targetPath: string): void {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return;
  }
  copyFileSync(sourcePath, targetPath);
}

function safeSourceName(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  if (value.includes("\0")) {
    throw new Error("source_name cannot contain null bytes");
  }
  const basename = path.basename(value.trim());
  return basename.length > 0 && basename !== "." ? basename : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
