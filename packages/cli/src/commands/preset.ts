import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";

import {
  findRegistryPreset,
  formatPreset,
  generatePresetRegistrationId,
  getPreset,
  listPresets as listRuntimePresets,
  loadPresetFile,
  presetDoctorReport,
  presetRegistryDirForWrite,
  presetSearchDirs,
  presetTemplate,
} from "@agentmesh/runtime/src/preset/registry.js";
import { getWorkflow, workflowSearchDirs } from "@agentmesh/runtime/src/workflow/registry.js";
import { optionValue, positionalArgs } from "../flags.js";

export function presetList(args: string[], configPath?: string): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  if (positional.length !== 0) {
    console.error("usage: agentmesh preset list [--json]");
    return 2;
  }
  const presets = listRuntimePresets(presetSearchDirs(process.cwd(), configPath), process.cwd(), configPath);
  if (json) {
    console.log(JSON.stringify(presets.map(presetListEntry), null, 2));
  } else {
    for (const preset of presets) {
      console.log([
        preset.presetId,
        preset.workflowId,
        preset.source,
        preset.validationWarnings.length ? `warnings=${preset.validationWarnings.length}` : "ok",
      ].join("\t"));
    }
  }
  return 0;
}

export function presetShow(args: string[], configPath?: string): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const presetId = positional[0];
  if (!presetId || positional.length !== 1) {
    console.error("usage: agentmesh preset show <preset-id> [--json]");
    return 2;
  }
  const preset = getPreset(presetId, presetSearchDirs(process.cwd(), configPath), process.cwd(), configPath);
  if (json) {
    console.log(JSON.stringify(preset, null, 2));
  } else {
    process.stdout.write(formatPreset(preset));
  }
  return 0;
}

export function presetInit(args: string[], configPath?: string): number {
  const positional = positionalArgs(args);
  const workflowId = optionValue(args, "--workflow");
  if (positional.length !== 0 || !workflowId) {
    console.error("usage: agentmesh preset init --workflow <workflow-id>");
    return 2;
  }
  const workflow = getWorkflow(workflowId, workflowSearchDirs(process.cwd(), configPath));
  process.stdout.write(presetTemplate(workflow));
  return 0;
}

export function presetAdd(args: string[], configPath?: string): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const presetPath = positional[0];
  if (!presetPath || positional.length !== 1) {
    console.error("usage: agentmesh preset add <preset-file>");
    return 2;
  }
  const presetId = generatePresetRegistrationId(
    listRuntimePresets(
      presetSearchDirs(process.cwd(), configPath),
      process.cwd(),
      configPath,
    ).map((item) => item.presetId),
  );
  const preset = loadPresetFile(presetPath, process.cwd(), configPath, { presetId });
  const registryDir = presetRegistryDirForWrite(process.cwd(), configPath);
  const targetPath = path.join(registryDir, `${preset.presetId}.toml`);
  if (existsSync(targetPath)) {
    throw new Error(`preset file already exists: ${targetPath}`);
  }
  mkdirSync(registryDir, { recursive: true });
  copyFileSync(preset.path ?? presetPath, targetPath);
  console.log(`Added preset: ${preset.presetId}`);
  console.log(`Preset file: ${targetPath}`);
  for (const warning of preset.validationWarnings) {
    console.warn(`warning: ${warning}`);
  }
  return 0;
}

export function presetUpdate(args: string[], configPath?: string): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const presetId = positional[0];
  const presetPath = positional[1];
  if (!presetId || !presetPath || positional.length !== 2) {
    console.error("usage: agentmesh preset update <preset-id> <preset-file>");
    return 2;
  }
  const existing = findRegistryPreset(presetId, process.cwd(), configPath);
  if (!existing?.path) {
    throw new Error(`preset not found in user registry: ${presetId}`);
  }
  const preset = loadPresetFile(presetPath, process.cwd(), configPath, { presetId });
  copyFileIfDifferent(preset.path ?? presetPath, existing.path);
  console.log(`Updated preset: ${preset.presetId}`);
  console.log(`Preset file: ${existing.path}`);
  for (const warning of preset.validationWarnings) {
    console.warn(`warning: ${warning}`);
  }
  return 0;
}

export function presetRemove(args: string[], configPath?: string): number {
  if (rejectScope(args)) {
    return 2;
  }
  const positional = positionalArgs(args);
  const presetId = positional[0];
  if (!presetId || positional.length !== 1) {
    console.error("usage: agentmesh preset remove <preset-id>");
    return 2;
  }
  const preset = findRegistryPreset(presetId, process.cwd(), configPath);
  if (!preset?.path) {
    throw new Error(`preset not found in user registry: ${presetId}`);
  }
  unlinkSync(preset.path);
  console.log(`Removed preset: ${presetId}`);
  console.log(`Preset file: ${preset.path}`);
  return 0;
}

function copyFileIfDifferent(sourcePath: string, targetPath: string): void {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return;
  }
  copyFileSync(sourcePath, targetPath);
}

export function presetDoctor(args: string[], configPath?: string): number {
  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const presetId = positional[0];
  if (!presetId || positional.length !== 1) {
    console.error("usage: agentmesh preset doctor <preset-id> [--json]");
    return 2;
  }
  const preset = getPreset(presetId, presetSearchDirs(process.cwd(), configPath), process.cwd(), configPath);
  const report = presetDoctorReport(preset);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Preset: ${report.preset_id}`);
    console.log(`Workflow: ${report.workflow_id}`);
    console.log(`Status: ${report.ok ? "ok" : "not ok"}`);
    for (const warning of report.warnings) {
      console.log(`warning: ${warning}`);
    }
  }
  return report.ok ? 0 : 1;
}

function presetListEntry(preset: ReturnType<typeof listRuntimePresets>[number]): Record<string, unknown> {
  return {
    presetId: preset.presetId,
    workflowId: preset.workflowId,
    source: preset.source,
    path: preset.path,
    validationWarnings: preset.validationWarnings,
  };
}

function rejectScope(args: string[]): boolean {
  if (!args.includes("--scope")) {
    return false;
  }
  console.error("presets are global user-level resources; --scope is not supported");
  return true;
}
