import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  type ProjectSpec,
  ProjectSpecSchema,
} from "@agentmesh/core";
import { parseTomlDocument } from "../toml.js";

export const PROJECT_SPEC_RELATIVE_PATH = ".agentmesh/spec/project.toml";

export interface ProjectSpecDiagnostic {
  classification:
    | "missing_spec"
    | "malformed_spec"
    | "missing_required_field"
    | "stale_spec"
    | "validation_failed";
  message: string;
}

export interface ProjectSpecCheckReport {
  schema_version: 1;
  ok: boolean;
  path: string;
  diagnostics: ProjectSpecDiagnostic[];
  project?: {
    id: string;
    name?: string;
    key_command_count: number;
    constraint_count: number;
    risk_count: number;
    freshness: string;
    validation_state: string;
  };
}

export function projectSpecPath(cwd = process.cwd()): string {
  return path.resolve(cwd, PROJECT_SPEC_RELATIVE_PATH);
}

export function checkProjectSpec(filePath = projectSpecPath()): ProjectSpecCheckReport {
  if (!existsSync(filePath)) {
    return {
      schema_version: 1,
      ok: false,
      path: filePath,
      diagnostics: [
        {
          classification: "missing_spec",
          message: `project spec not found: ${filePath}`,
        },
      ],
    };
  }
  try {
    const spec = parseProjectSpecToml(readFileSync(filePath, { encoding: "utf-8" }), filePath);
    const diagnostics = semanticDiagnostics(spec);
    return {
      schema_version: 1,
      ok: diagnostics.length === 0,
      path: filePath,
      diagnostics,
      project: {
        id: spec.project.id,
        ...(spec.project.name ? { name: spec.project.name } : {}),
        key_command_count: spec.key_commands.length,
        constraint_count: spec.constraints.length,
        risk_count: spec.risks.length,
        freshness: spec.freshness.freshness,
        validation_state: spec.validation.validation_state,
      },
    };
  } catch (error) {
    return {
      schema_version: 1,
      ok: false,
      path: filePath,
      diagnostics: projectSpecParseDiagnostics(error),
    };
  }
}

export function loadProjectSpec(filePath = projectSpecPath()): ProjectSpec {
  return parseProjectSpecToml(readFileSync(filePath, { encoding: "utf-8" }), filePath);
}

export function parseProjectSpecToml(content: string, label = PROJECT_SPEC_RELATIVE_PATH): ProjectSpec {
  const payload = parseTomlDocument(content, label, "invalid project spec TOML");
  for (const [key, value] of Object.entries(payload)) {
    if (!PROJECT_SPEC_KEYS.has(key)) {
      throw new Error(
        `invalid project spec TOML ${label}: unsupported ${isRecord(value) ? "section" : "key"}: ${key}`,
      );
    }
  }
  return ProjectSpecSchema.parse(payload);
}

function semanticDiagnostics(spec: ProjectSpec): ProjectSpecDiagnostic[] {
  const diagnostics: ProjectSpecDiagnostic[] = [];
  if (spec.freshness.freshness === "stale") {
    diagnostics.push({
      classification: "stale_spec",
      message: "project spec freshness is stale",
    });
  }
  if (spec.validation.validation_state !== "ok") {
    diagnostics.push({
      classification: "validation_failed",
      message: `project spec validation_state is ${spec.validation.validation_state}`,
    });
  }
  return diagnostics;
}

function projectSpecParseDiagnostics(error: unknown): ProjectSpecDiagnostic[] {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => {
      const field = issue.path.join(".") || "<root>";
      const missing = issue.message.includes("received undefined");
      return {
        classification: missing ? "missing_required_field" : "malformed_spec",
        message: missing
          ? `missing required field: ${field}`
          : `${field}: ${issue.message}`,
      };
    });
  }
  return [
    {
      classification: "malformed_spec",
      message: error instanceof Error ? error.message : String(error),
    },
  ];
}

const PROJECT_SPEC_KEYS = new Set([
  "schema_version",
  "project",
  "key_commands",
  "constraints",
  "risks",
  "freshness",
  "owner",
  "validation",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
