import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  CURRENT_SCHEMA_VERSION,
  type CorrectionRecord,
  type CorrectionSessionImpact,
  CorrectionRecordSchema,
  type CorrectionStatus,
  CorrectionStatusSchema,
} from "@agentmesh/core";
import { writeFileAtomic } from "../packet/io.js";
import { parseTomlDocument, stringifyTomlDocument } from "../toml.js";

export const CORRECTIONS_RELATIVE_DIR = ".agentmesh/corrections";

export interface AddCorrectionInput {
  id?: string;
  scope: string;
  statement: string;
  source?: string;
  owner?: string;
  createdAt?: Date;
  supersedes?: string[];
  sessionImpact?: CorrectionSessionImpact;
}

export interface AddCorrectionResult {
  record: CorrectionRecord;
  path: string;
}

export interface ListCorrectionsOptions {
  status?: string;
  scope?: string;
}

export interface CorrectionListEntry {
  record: CorrectionRecord;
  path: string;
}

export interface SupersedeCorrectionInput {
  id?: string;
  scope?: string;
  statement: string;
  source?: string;
  owner?: string;
  createdAt?: Date;
  sessionImpact?: CorrectionSessionImpact;
}

export interface SupersedeCorrectionResult {
  superseded: CorrectionListEntry;
  replacement: CorrectionListEntry;
}

export function correctionStoreDir(cwd = process.cwd()): string {
  return path.resolve(cwd, CORRECTIONS_RELATIVE_DIR);
}

export function correctionRecordPath(id: string, cwd = process.cwd()): string {
  return path.join(correctionStoreDir(cwd), `${validateCorrectionId(id)}.toml`);
}

export function validateCorrectionId(id: string): string {
  if (id.length === 0) {
    throw new Error("correction id cannot be empty");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new Error(
      "correction id may only contain letters, numbers, dot, underscore, and dash: " +
        id,
    );
  }
  if (id === "." || id === "..") {
    throw new Error(`unsafe correction id: ${id}`);
  }
  return id;
}

export function addCorrection(
  input: AddCorrectionInput,
  cwd = process.cwd(),
): AddCorrectionResult {
  const createdAt = input.createdAt ?? new Date();
  const id = validateCorrectionId(input.id ?? correctionIdFromDate(createdAt));
  const record = CorrectionRecordSchema.parse({
    schema_version: CURRENT_SCHEMA_VERSION,
    id,
    scope: requiredText(input.scope, "scope"),
    statement: requiredText(input.statement, "statement"),
    source: requiredText(input.source ?? "manual", "source"),
    created_at: createdAt.toISOString(),
    supersedes: (input.supersedes ?? []).map(validateCorrectionId),
    status: "active",
    owner: requiredText(input.owner ?? "unknown", "owner"),
    ...(input.sessionImpact === undefined ? {} : { session_impact: input.sessionImpact }),
  });
  const filePath = correctionRecordPath(id, cwd);
  if (existsSync(filePath)) {
    throw new Error(`correction already exists: ${id}`);
  }
  writeFileAtomic(filePath, stringifyTomlDocument(record));
  return { record, path: filePath };
}

export function listCorrections(
  options: ListCorrectionsOptions = {},
  cwd = process.cwd(),
): CorrectionListEntry[] {
  const statusFilter = options.status ? parseCorrectionStatus(options.status) : undefined;
  const scopeFilter =
    options.scope === undefined ? undefined : requiredText(options.scope, "scope");
  const storeDir = correctionStoreDir(cwd);
  if (!existsSync(storeDir)) {
    return [];
  }
  return readdirSync(storeDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
    .map((entry) => path.join(storeDir, entry.name))
    .sort()
    .map((filePath) => ({ record: loadCorrection(filePath), path: filePath }))
    .filter((entry) => !statusFilter || entry.record.status === statusFilter)
    .filter((entry) => !scopeFilter || entry.record.scope === scopeFilter);
}

export function supersedeCorrection(
  targetId: string,
  input: SupersedeCorrectionInput,
  cwd = process.cwd(),
): SupersedeCorrectionResult {
  const oldId = validateCorrectionId(targetId);
  const oldPath = correctionRecordPath(oldId, cwd);
  if (!existsSync(oldPath)) {
    throw new Error(`correction not found: ${oldId}`);
  }
  const oldContent = readFileSync(oldPath, { encoding: "utf-8" });
  const oldRecord = parseCorrectionToml(oldContent, oldPath);
  if (oldRecord.id !== oldId) {
    throw new Error(`correction id mismatch: ${oldPath} contains ${oldRecord.id}`);
  }
  if (oldRecord.status === "superseded") {
    throw new Error(`correction already superseded: ${oldId}`);
  }

  const replacement = addCorrection(
    {
      id: input.id,
      scope: input.scope ?? oldRecord.scope,
      statement: input.statement,
      source: input.source,
      owner: input.owner ?? oldRecord.owner,
      createdAt: input.createdAt,
      sessionImpact: input.sessionImpact ?? oldRecord.session_impact,
      supersedes: [oldId],
    },
    cwd,
  );
  const updatedOldContent = replaceActiveStatus(oldContent, oldId);
  writeFileAtomic(oldPath, updatedOldContent);
  return {
    superseded: {
      record: loadCorrection(oldPath),
      path: oldPath,
    },
    replacement: {
      record: replacement.record,
      path: replacement.path,
    },
  };
}

export function loadCorrection(filePath: string): CorrectionRecord {
  return parseCorrectionToml(readFileSync(filePath, { encoding: "utf-8" }), filePath);
}

export function parseCorrectionToml(
  content: string,
  label = CORRECTIONS_RELATIVE_DIR,
): CorrectionRecord {
  const payload = parseTomlDocument(content, label, "invalid correction TOML");
  return CorrectionRecordSchema.parse(payload);
}

function correctionIdFromDate(date: Date): string {
  return `correction-${date.toISOString().replace(/[-:.]/g, "")}`;
}

function parseCorrectionStatus(status: string): CorrectionStatus {
  return CorrectionStatusSchema.parse(status);
}

function replaceActiveStatus(content: string, id: string): string {
  const activeStatusPattern = /^(\s*status\s*=\s*)(["'])active\2(.*)$/m;
  if (!activeStatusPattern.test(content)) {
    throw new Error(`correction ${id} does not contain an active status assignment`);
  }
  return content.replace(activeStatusPattern, '$1$2superseded$2$3');
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is required and cannot be empty`);
  }
  return trimmed;
}
