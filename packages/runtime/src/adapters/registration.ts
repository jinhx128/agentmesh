import { STAGE_TYPES } from "@agentmesh/core";
import {
  defaultAgentLabel,
  type AgentConfig,
} from "../adapters.js";
import {
  probeAgentReadiness,
  type DoctorAgentReport,
} from "../doctor/readiness.js";
import { lookupRuntimeAdapter } from "./registry.js";

const DEFAULT_CAPABILITIES = [...STAGE_TYPES];
const SAFE_AGENT_TOKEN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const MIN_INVOCATION_TIMEOUT_SECONDS = 30;
const MAX_INVOCATION_TIMEOUT_SECONDS = 3600;

export interface AgentRegistrationCandidateInput {
  agentId: string;
  adapter: string;
  model: string;
  command?: string;
  args?: string[];
  env?: string[];
  reasoningEffort?: string;
  capabilities?: string[];
  label?: string;
  timeoutSeconds?: number;
}

export interface AgentRegistrationReadinessOptions {
  skipVerify?: boolean;
  probeTimeoutSecs?: number;
}

export interface AgentRegistrationReadinessResult {
  ok: boolean;
  report: DoctorAgentReport;
  classification: DoctorAgentReport["classification"];
  message: string;
  hints: string[];
  warnings: string[];
}

export function buildAgentRegistrationCandidate(
  input: AgentRegistrationCandidateInput,
): AgentConfig {
  const adapter = lookupRuntimeAdapter(input.adapter);
  const canonicalModel = input.model.trim();
  const id = validateAgentToken(input.agentId, "agent id");
  const capabilities = uniqueStrings(
    input.capabilities?.length ? input.capabilities : DEFAULT_CAPABILITIES,
  ).map((capability) => validateAgentToken(capability, "agent capability"));
  const reasoningEffort = input.reasoningEffort ?? "high";
  validateReasoningEffort(reasoningEffort);
  const timeoutSeconds = validateTimeoutSeconds(input.timeoutSeconds);
  return {
    id,
    label: input.label ?? defaultAgentLabel(adapter.id, canonicalModel),
    adapter: adapter.id,
    command: input.command ?? adapter.command,
    args: input.args ? [...input.args] : [...adapter.args],
    env: [...(input.env ?? [])],
    capabilities,
    model: canonicalModel,
    reasoning_effort: reasoningEffort,
    ...(timeoutSeconds === undefined ? {} : { timeout_seconds: timeoutSeconds }),
  };
}

export function probeAgentRegistrationReadiness(
  candidate: AgentConfig,
  options: AgentRegistrationReadinessOptions = {},
): AgentRegistrationReadinessResult {
  const skipVerify = options.skipVerify === true;
  const report = probeAgentReadiness(candidate, {
    probeAuth: !skipVerify,
    probeTimeoutSecs: options.probeTimeoutSecs,
  });
  const warnings = skipVerify
    ? [
        "Agent candidate was not checked for auth/model availability; run `agentmesh doctor` before dispatching.",
      ]
    : [];
  const ok = skipVerify
    ? report.status !== "command not found"
    : report.classification === "ready";
  return {
    ok,
    report,
    classification: report.classification,
    message: ok ? "" : registrationReadinessMessage(report),
    hints: ok ? [] : report.hints,
    warnings,
  };
}

function registrationReadinessMessage(report: DoctorAgentReport): string {
  if (report.classification === "command_not_found") {
    return `Command not found for agent ${report.id}: ${report.command}`;
  }
  if (report.classification === "auth_timeout") {
    return `Auth/model probe for agent ${report.id} ${report.status}`;
  }
  if (report.classification === "model_unavailable") {
    return `Model unavailable for agent ${report.id}: ${report.status}`;
  }
  if (report.classification === "auth_failed") {
    return `Auth/model probe failed for agent ${report.id}: ${report.status}`;
  }
  if (report.classification === "help_failed") {
    return `Help probe failed for agent ${report.id}: ${report.command} --help => ${report.help_probe}`;
  }
  if (report.classification === "version_failed") {
    return `Version probe failed for agent ${report.id}: ${report.command} --version => ${report.version_probe}`;
  }
  return `Agent ${report.id} is not ready: ${report.status}`;
}

function validateAgentToken(value: string, label: string): string {
  const trimmed = value.trim();
  if (!SAFE_AGENT_TOKEN.test(trimmed)) {
    throw new Error(`${label} may only contain letters, numbers, dot, underscore, and dash, and must start with a letter: ${value}`);
  }
  return trimmed;
}

function validateReasoningEffort(value: string): void {
  if (!REASONING_EFFORTS.has(value)) {
    throw new Error(`reasoning_effort must be one of: ${[...REASONING_EFFORTS].join(", ")}`);
  }
}

function validateTimeoutSeconds(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !Number.isInteger(value) ||
    value < MIN_INVOCATION_TIMEOUT_SECONDS ||
    value > MAX_INVOCATION_TIMEOUT_SECONDS
  ) {
    throw new Error(`timeout_seconds must be between ${MIN_INVOCATION_TIMEOUT_SECONDS} and ${MAX_INVOCATION_TIMEOUT_SECONDS}`);
  }
  return value;
}

function uniqueStrings(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}
