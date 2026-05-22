import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  findRegistryPreset,
  generatePresetRegistrationId,
  listPresets as listRuntimePresets,
  loadPresetFile,
  presetRegistryDirForWrite,
  presetSearchDirs,
} from "@agentmesh/runtime/src/preset/registry.js";

export interface StudioPresetLifecycleOptions {
  cwd?: string;
  configPath?: string;
}

export type StudioPresetLifecycleAction = "create" | "update" | "delete";

export interface StudioPresetCreateRequest {
  preset_file?: string;
  preset_toml?: string;
  source_name?: string;
}

export interface StudioPresetUpdateRequest extends StudioPresetCreateRequest {}

export interface StudioPresetLifecycleRequest {
  action: StudioPresetLifecycleAction;
  presetId?: string;
  create?: StudioPresetCreateRequest;
  update?: StudioPresetUpdateRequest;
}

export interface StudioPresetLifecycleOperation {
  operation_id: string;
  action: StudioPresetLifecycleAction;
  status: "running" | "succeeded" | "failed" | "conflict";
  command: string[];
  exit_code: number | null;
  stdout: string;
  stderr: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  preset_id?: string;
  preset_file?: string;
}

interface PresetLifecycleRuntimeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  presetId?: string;
  presetFile?: string;
}

const operations = new Map<string, StudioPresetLifecycleOperation>();
const activeKeys = new Set<string>();

export async function runStudioPresetLifecycleOperation(
  request: StudioPresetLifecycleRequest,
  options: StudioPresetLifecycleOptions = {},
): Promise<StudioPresetLifecycleOperation> {
  const operationId = `preset-op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const command = studioPresetLifecycleCommand(request, options);
  const presetSource = request.create ? presetSourceLabel(request.create) : request.update ? presetSourceLabel(request.update) : undefined;
  const activeKey = request.action === "update" || request.action === "delete"
    ? `update:${request.presetId ?? "preset"}`
    : `${request.action}:${presetSource ?? "preset"}`;
  const startedAt = Date.now();
  const operation: StudioPresetLifecycleOperation = {
    operation_id: operationId,
    action: request.action,
    status: "running",
    command,
    exit_code: null,
    stdout: "",
    stderr: "",
    started_at: new Date(startedAt).toISOString(),
    ...(request.create?.preset_file ? { preset_file: request.create.preset_file } : {}),
    ...(request.update?.preset_file ? { preset_file: request.update.preset_file } : {}),
  };
  operations.set(operationId, operation);
  if (activeKeys.has(activeKey)) {
    const completedAt = Date.now();
    const conflict: StudioPresetLifecycleOperation = {
      ...operation,
      status: "conflict",
      stderr: `preset lifecycle operation already running for ${presetSource ?? request.action}`,
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
    };
    operations.set(operationId, conflict);
    return conflict;
  }
  activeKeys.add(activeKey);
  try {
    let result: PresetLifecycleRuntimeResult;
    try {
      result = runRuntimePresetLifecycle(request, options);
    } catch (error) {
      const completedAt = Date.now();
      const failed: StudioPresetLifecycleOperation = {
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
    const completed: StudioPresetLifecycleOperation = {
      ...operation,
      status: result.exitCode === 0 ? "succeeded" : "failed",
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      ...(result.presetId ? { preset_id: result.presetId } : {}),
      ...(result.presetFile ? { preset_file: result.presetFile } : {}),
    };
    operations.set(operationId, completed);
    return completed;
  } finally {
    activeKeys.delete(activeKey);
  }
}

export function readStudioPresetLifecycleOperation(
  operationId: string,
): StudioPresetLifecycleOperation | undefined {
  return operations.get(operationId);
}

export function studioPresetLifecycleCommand(
  request: StudioPresetLifecycleRequest,
  options: StudioPresetLifecycleOptions = {},
): string[] {
  rejectPresetScope(request);
  if (request.action === "create") {
    const create = request.create;
    if (!create) {
      throw new Error("create request is required");
    }
    return withConfigTrace([
      "runtime",
      "preset",
      "add",
      presetSourceLabel(create),
    ], options);
  }
  if (request.action === "delete") {
    return withConfigTrace([
      "runtime",
      "preset",
      "remove",
      safePresetId(request.presetId),
    ], options);
  }
  if (request.action !== "update") {
    throw new Error(`unsupported preset lifecycle action: ${String(request.action)}`);
  }
  const update = request.update;
  if (!update) {
    throw new Error("update request is required");
  }
  return withConfigTrace([
    "runtime",
    "preset",
    "update",
    safePresetId(request.presetId),
    presetSourceLabel(update),
  ], options);
}

function runRuntimePresetLifecycle(
  request: StudioPresetLifecycleRequest,
  options: StudioPresetLifecycleOptions,
): PresetLifecycleRuntimeResult {
  if (request.action === "create") {
    const create = request.create;
    if (!create) {
      throw new Error("create request is required");
    }
    return addPresetRegistration(create, options);
  }
  if (request.action === "update") {
    const update = request.update;
    if (!update) {
      throw new Error("update request is required");
    }
    return updatePresetRegistration(safePresetId(request.presetId), update, options);
  }
  if (request.action === "delete") {
    return deletePresetRegistration(safePresetId(request.presetId), options);
  }
  throw new Error(`unsupported preset lifecycle action: ${String(request.action)}`);
}

function addPresetRegistration(
  create: StudioPresetCreateRequest,
  options: StudioPresetLifecycleOptions,
): PresetLifecycleRuntimeResult {
  rejectPresetCreateScope(create);
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath;
  const source = materializePresetSource(create, cwd);
  try {
    const existingPresets = listRuntimePresets(presetSearchDirs(cwd, configPath), cwd, configPath);
    const presetId = generatePresetRegistrationId(existingPresets.map((item) => item.presetId));
    const preset = loadPresetFile(source.path, cwd, configPath, { presetId });
    const registryDir = presetRegistryDirForWrite(cwd, configPath);
    const targetPath = path.join(registryDir, `${preset.presetId}.toml`);
    if (existsSync(targetPath)) {
      throw new Error(`preset file already exists: ${targetPath}`);
    }
    mkdirSync(registryDir, { recursive: true });
    copyFileSync(preset.path ?? source.path, targetPath);
    return {
      exitCode: 0,
      stdout: [
        `Added preset: ${preset.presetId}`,
        `Preset file: ${targetPath}`,
        "",
        ...preset.validationWarnings.map((warning) => `Warning: ${warning}`),
      ].join("\n"),
      stderr: "",
      presetId: preset.presetId,
      presetFile: targetPath,
    };
  } finally {
    source.cleanup();
  }
}

function updatePresetRegistration(
  presetId: string,
  update: StudioPresetUpdateRequest,
  options: StudioPresetLifecycleOptions,
): PresetLifecycleRuntimeResult {
  rejectPresetCreateScope(update);
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath;
  const existing = findRegistryPreset(presetId, cwd, configPath);
  if (!existing?.path) {
    throw new Error(`preset not found in user registry: ${presetId}`);
  }
  const source = materializePresetSource(update, cwd);
  try {
    const preset = loadPresetFile(source.path, cwd, configPath, { presetId });
    copyFileIfDifferent(preset.path ?? source.path, existing.path);
    return {
      exitCode: 0,
      stdout: [
        `Updated preset: ${preset.presetId}`,
        `Preset file: ${existing.path}`,
        "",
        ...preset.validationWarnings.map((warning) => `Warning: ${warning}`),
      ].join("\n"),
      stderr: "",
      presetId: preset.presetId,
      presetFile: existing.path,
    };
  } finally {
    source.cleanup();
  }
}

function deletePresetRegistration(
  presetId: string,
  options: StudioPresetLifecycleOptions,
): PresetLifecycleRuntimeResult {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath;
  const existing = findRegistryPreset(presetId, cwd, configPath);
  if (!existing?.path) {
    throw new Error(`preset not found in user registry: ${presetId}`);
  }
  unlinkSync(existing.path);
  return {
    exitCode: 0,
    stdout: [
      `Removed preset: ${presetId}`,
      `Preset file: ${existing.path}`,
      "",
    ].join("\n"),
    stderr: "",
    presetId,
    presetFile: existing.path,
  };
}

function withConfigTrace(command: string[], options: StudioPresetLifecycleOptions): string[] {
  return options.configPath ? [...command, "--config", options.configPath] : command;
}

function rejectPresetScope(request: StudioPresetLifecycleRequest): void {
  if (isRecord(request.create)) {
    rejectPresetCreateScope(request.create);
  }
  if (isRecord(request.update)) {
    rejectPresetCreateScope(request.update);
  }
}

function rejectPresetCreateScope(create: StudioPresetCreateRequest): void {
  if (isRecord(create) && (Object.hasOwn(create, "scope") || Object.hasOwn(create, "project_dir"))) {
    throw new Error("preset scope is not supported; presets are global user-level resources");
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

function safePresetId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("preset_id must be a non-empty string");
  }
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`preset_id contains unsupported characters: ${value}`);
  }
  return value;
}

function presetSourceLabel(create: StudioPresetCreateRequest): string {
  if (typeof create.preset_file === "string" && create.preset_file.trim().length > 0) {
    return safePathValue(create.preset_file, "preset_file");
  }
  if (typeof create.preset_toml === "string" && create.preset_toml.trim().length > 0) {
    return `uploaded:${safeSourceName(create.source_name, "preset.toml")}`;
  }
  throw new Error("preset_toml or preset_file must be provided");
}

function materializePresetSource(
  create: StudioPresetCreateRequest,
  cwd: string,
): { path: string; cleanup: () => void } {
  if (typeof create.preset_file === "string" && create.preset_file.trim().length > 0) {
    const presetFile = safePathValue(create.preset_file, "preset_file");
    return {
      path: path.isAbsolute(presetFile) ? path.resolve(presetFile) : path.resolve(cwd, presetFile),
      cleanup: () => undefined,
    };
  }
  if (typeof create.preset_toml === "string" && create.preset_toml.trim().length > 0) {
    const tempDir = mkdtempSync(path.join(tmpdir(), "agentmesh-studio-preset-"));
    const sourcePath = path.join(tempDir, safeSourceName(create.source_name, "preset.toml"));
    writeFileSync(sourcePath, create.preset_toml, { encoding: "utf-8" });
    return {
      path: sourcePath,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
    };
  }
  throw new Error("preset_toml or preset_file must be provided");
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
