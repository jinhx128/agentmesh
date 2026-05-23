import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, TomlError } from "smol-toml";

import {
  BUILTIN_WORKFLOW_IDS,
  CURRENT_PACKET_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  WORKFLOW_RECIPE_SCHEMA_VERSION,
  deriveStageNodes,
  type PacketEvent,
  type StageNode,
} from "@agentmesh/core";

export interface AgentMeshReadOptions {
  cwd?: string;
  configPath?: string;
}

type ConfigLayerKind = "user" | "project" | "explicit";
type WorkflowSource = "builtin" | "user" | "temporary";
type CallRecordStatus = "running" | "success" | "failed" | "aborted" | "timeout" | "stale";
type CallPromptSource = "inline" | "stdin" | "file" | "generated" | "unknown";
type CallErrorKind =
  | "none"
  | "adapter_error"
  | "provider_auth"
  | "provider_missing"
  | "network"
  | "timeout"
  | "schema"
  | "user_aborted"
  | "internal"
  | "unknown";
type CallAdoptionStatus = "unreviewed" | "accepted" | "rejected" | "superseded";
type FinalCallAdoptionStatus = Exclude<CallAdoptionStatus, "unreviewed">;

interface ConfigSourceRef {
  source: ConfigLayerKind;
  path: string;
}

interface LoadedAgentmeshConfig {
  config: {
    agents: Record<string, Record<string, unknown>>;
  };
  agentSources: Record<string, ConfigSourceRef>;
}

interface Workflow {
  workflowId: string;
  name: string;
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  workflowRecipeVersion: typeof WORKFLOW_RECIPE_SCHEMA_VERSION;
  compatiblePacketSchemaVersions: (typeof CURRENT_PACKET_SCHEMA_VERSION)[];
  stages: string[];
  stageNodes: StageNode[];
  description: string;
  whenToUse: string[];
  packetArtifacts: string[];
  qualityGates: string[];
  failurePolicy: {
    stage_types: Record<string, Record<string, unknown>>;
    nodes: Record<string, Record<string, unknown>>;
  };
  source: WorkflowSource;
  recipeSource?: string;
  path?: string;
}

interface RuntimeAdapterMetadata {
  id: string;
  aliases: string[];
  command: string;
  args: string[];
  label: string;
}

interface WorkspaceCompatibilityDiagnostics {
  decision: "read_write" | "read_only" | "refused";
  metadata_state: "ok" | "missing_legacy" | "newer_schema" | "invalid";
  current_runtime_version: string;
  current_entrypoint: string;
  compatibility_path: string;
  metadata: Record<string, unknown> | null;
  reasons: string[];
}

interface CallArtifactRef {
  kind: "file";
  path: string;
  sha256: string | null;
  redaction_state: string;
  authoritative: boolean;
}

interface DirectCallRecord {
  schema_version: number;
  id: string;
  agent_id: string | null;
  adapter: string;
  model: string | null;
  purpose: string;
  status: CallRecordStatus;
  cwd: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  heartbeat_at: string | null;
  prompt_source: CallPromptSource;
  prompt_ref: CallArtifactRef | null;
  output_ref: CallArtifactRef | null;
  output_path: string | null;
  exit_code: number | null;
  error_kind: CallErrorKind;
  error_summary: string | null;
  redaction_state: string;
  redactions_applied: string[];
  related_files: string[];
  related_run_ids: string[];
  related_call_ids: string[];
  tokens_in: number | null;
  tokens_out: number | null;
  cost_estimate_usd: number | null;
  adoption_status: CallAdoptionStatus;
  read_only?: boolean;
  schema_warning?: string;
}

interface CallAdoptionEvent {
  schema_version: number;
  call_id: string;
  previous_status: CallAdoptionStatus;
  status: FinalCallAdoptionStatus;
  updated_at: string;
  updated_by_entrypoint: string;
  reason: string | null;
  related_commit: string | null;
  related_run_id: string | null;
  superseded_by_call_id: string | null;
}

export interface AgentMeshRunReadOptions extends AgentMeshReadOptions {
  eventTail?: number;
  eventOffset?: number;
  eventLimit?: number;
  previewBytes?: number;
}

export interface AgentMeshCallReadOptions extends AgentMeshReadOptions {}

export interface AgentMeshPageOptions extends AgentMeshReadOptions {
  page?: number;
  pageSize?: number;
}

export interface AgentMeshRunListOptions extends AgentMeshPageOptions {
  eventTail?: number;
}

export interface AgentMeshRunEventListOptions extends AgentMeshPageOptions {}

export interface AgentMeshAgentSummary {
  id: string;
  label: string;
  adapter: string;
  command: string;
  args: string[];
  env: string[];
  capabilities: string[];
  verification_status: "configured";
  model?: string;
  reasoning_effort?: string;
  prompt_file_arg?: string;
  prompt_arg?: string;
  output_file_arg?: string;
  stdin?: boolean;
  disabled: boolean;
  status: "enabled" | "disabled";
  source_layer?: ConfigLayerKind;
  source_path?: string;
}

export interface AgentMeshWorkflowRunRef {
  run_id: string;
  status: string;
  updated_at?: string;
  latest_event?: string;
  latest_event_timestamp?: string;
}

export interface AgentMeshWorkflowSummary {
  workflowId: string;
  name: string;
  source: WorkflowSource;
  stages: string[];
  created_at?: string;
  updated_at?: string;
  latest_run?: AgentMeshWorkflowRunRef;
  recipeSource?: string;
  path?: string;
}

export interface AgentMeshWorkflowDetail extends AgentMeshWorkflowSummary {
  schemaVersion: Workflow["schemaVersion"];
  workflowRecipeVersion: Workflow["workflowRecipeVersion"];
  compatiblePacketSchemaVersions: Workflow["compatiblePacketSchemaVersions"];
  stageNodes: Workflow["stageNodes"];
  description: string;
  whenToUse: string[];
  packetArtifacts: string[];
  qualityGates: string[];
  failurePolicy: Workflow["failurePolicy"];
  agents: AgentMeshAgentSummary[];
  recipeSource?: string;
  path?: string;
}

export interface AgentMeshRunPage {
  runs: AgentMeshRunSummary[];
  page: number;
  page_size: number;
  total: number;
}

export interface AgentMeshEventPage {
  offset: number;
  limit: number;
  total: number;
}

export interface AgentMeshRunEventPage extends AgentMeshEventPage {
  events: PacketEvent[];
  page: number;
  page_size: number;
}

export type AgentMeshWorkspaceCompatibility = WorkspaceCompatibilityDiagnostics;
export type AgentMeshCallRecord = DirectCallRecord;
export type AgentMeshCallAdoptionEvent = CallAdoptionEvent;
export const AGENTMESH_CALLS_RELATIVE_DIR = path.join(".agentmesh", "calls");

export interface AgentMeshRunSummary {
  run_id: string;
  run_dir: string;
  status: string;
  stages: string[];
  stage_nodes?: AgentMeshStageNodeSummary[];
  completed_stages: string[];
  stage_timing: AgentMeshStageTimingSummary[];
  stage_assignments?: Record<string, string[]>;
  stage_invocations?: Record<string, Array<Record<string, unknown>>>;
  stage_failure_policies?: Record<string, Record<string, unknown>>;
  stage_fallbacks?: Record<string, Record<string, unknown>>;
  stage_attempts?: Record<string, Array<Record<string, unknown>>>;
  assignment_provenance?: Record<string, unknown>;
  fallback_provenance?: Record<string, unknown>;
  timeout_provenance?: Record<string, unknown>;
  context_bytes?: number;
  prompt_bytes?: Record<string, AgentMeshPromptByteMetric>;
  created_at?: string;
  updated_at?: string;
  workflow?: string;
  current_stage?: string;
  latest_event?: string;
  latest_event_timestamp?: string;
  resolved_context_policy?: Record<string, unknown>;
  resolved_execution_policy?: Record<string, unknown>;
}

export function getWorkspaceCompatibility(
  options: AgentMeshReadOptions = {},
): AgentMeshWorkspaceCompatibility {
  return workspaceCompatibilityDiagnostics(options.cwd ?? process.cwd(), {
    entrypoint: "cli",
  });
}

function loadConfigWithSources(configPath?: string, cwd = process.cwd()): LoadedAgentmeshConfig {
  const candidates = configLayerCandidates(configPath, cwd);
  const existing = candidates.filter((candidate) => isFile(candidate.path));
  if (existing.length === 0) {
    throw new Error(`no config found; searched: ${candidates.map((candidate) => candidate.path).join(", ")}`);
  }
  const agents: Record<string, Record<string, unknown>> = {};
  const agentSources: Record<string, ConfigSourceRef> = {};
  for (const layer of existing) {
    const payload = parseTomlDocument(readFileSync(layer.path, "utf-8"), layer.path, "invalid agentmesh TOML");
    if (payload.schema_version !== 1) {
      throw new Error("config schema_version must be 1");
    }
    const agentSection = isRecord(payload.agents) ? payload.agents : {};
    for (const [id, value] of Object.entries(agentSection)) {
      if (isRecord(value)) {
        if (Object.hasOwn(value, "aliases")) {
          throw new Error(`agents.${id}.aliases is not supported`);
        }
        agents[id] = value;
        agentSources[id] = { source: layer.kind, path: layer.path };
      }
    }
  }
  return { config: { agents }, agentSources };
}

function configLayerCandidates(
  configPath: string | undefined,
  cwd: string,
): Array<{ kind: ConfigLayerKind; path: string }> {
  const candidates: Array<{ kind: ConfigLayerKind; path: string }> = [
    { kind: "user", path: path.join(os.homedir(), ".config", "agentmesh", "config.toml") },
    { kind: "project", path: path.resolve(cwd, ".agentmesh", "config.toml") },
    { kind: "project", path: path.resolve(cwd, "agentmesh.toml") },
  ];
  const overlay = configPath ?? process.env.AGENTMESH_CONFIG;
  if (overlay) {
    candidates.push({ kind: "explicit", path: path.resolve(cwd, overlay) });
  }
  const deduped: Array<{ kind: ConfigLayerKind; path: string }> = [];
  for (const candidate of candidates) {
    const key = path.resolve(candidate.path);
    const existingIndex = deduped.findIndex((item) => path.resolve(item.path) === key);
    if (existingIndex === -1) {
      deduped.push(candidate);
    } else {
      deduped[existingIndex] = candidate;
    }
  }
  return deduped;
}

function lookupRuntimeAdapter(idOrAlias: string): RuntimeAdapterMetadata {
  const id = normalizeRuntimeAdapterId(idOrAlias);
  const adapter = RUNTIME_ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) {
    throw new Error(`unknown adapter: ${idOrAlias}`);
  }
  return { ...adapter, aliases: [...adapter.aliases], args: [...adapter.args] };
}

function normalizeRuntimeAdapterId(idOrAlias: string): string {
  return RUNTIME_ADAPTERS.find((adapter) => adapter.aliases.includes(idOrAlias))?.id ?? idOrAlias;
}

function workflowSearchDirs(
  _cwd = process.cwd(),
  _configPath?: string,
): Array<{ source: "user"; path: string }> {
  const dirs: Array<{ source: "user"; path: string }> = [
    { source: "user", path: path.join(os.homedir(), ".config", "agentmesh", "workflows") },
  ];
  const deduped: Array<{ source: "user"; path: string }> = [];
  for (const dir of dirs) {
    const key = path.resolve(dir.path);
    const existingIndex = deduped.findIndex((item) => path.resolve(item.path) === key);
    if (existingIndex === -1) {
      deduped.push(dir);
    } else {
      deduped[existingIndex] = dir;
    }
  }
  return deduped;
}

function listRuntimeWorkflows(searchDirs: Array<{ source: "user"; path: string }>): Workflow[] {
  return [...BUILTIN_WORKFLOWS, ...searchDirs.flatMap((dir) => workflowFiles(dir))].sort((left, right) =>
    left.workflowId.localeCompare(right.workflowId),
  );
}

function getRuntimeWorkflow(
  workflowId: string,
  searchDirs: Array<{ source: "user"; path: string }>,
): Workflow {
  const workflow = listRuntimeWorkflows(searchDirs).find((candidate) => candidate.workflowId === workflowId);
  if (!workflow) {
    throw new Error(`unknown workflow: ${workflowId}`);
  }
  return workflow;
}

function workflowFiles(dir: { source: "user"; path: string }): Workflow[] {
  if (!isDirectory(dir.path)) {
    return [];
  }
  return readdirSync(dir.path)
    .filter((fileName) => fileName.endsWith(".toml"))
    .map((fileName) => loadWorkflowFile(path.join(dir.path, fileName), dir.source));
}

const WORKFLOW_TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "workflow_recipe_version",
  "compatible_packet_schema_versions",
  "name",
  "stages",
  "description",
  "when_to_use",
  "packet_artifacts",
  "quality_gates",
  "user_gate",
  "recipe_source",
  "failure_policy",
]);
const WORKFLOW_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

function loadWorkflowFile(filePath: string, source: "user"): Workflow {
  const payload = parseTomlDocument(readFileSync(filePath, "utf-8"), filePath, "invalid workflow TOML");
  validateWorkflowTomlRoot(payload, filePath);
  const stages = stringArray(payload.stages);
  const workflowId = workflowIdFromPath(filePath);
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new Error(`workflow ${filePath}: id must start with a letter and contain only letters, numbers, underscore, or dash`);
  }
  return {
    workflowId,
    name: stringValue(payload.name) ?? workflowId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    workflowRecipeVersion: WORKFLOW_RECIPE_SCHEMA_VERSION,
    compatiblePacketSchemaVersions: [CURRENT_PACKET_SCHEMA_VERSION],
    stages,
    stageNodes: deriveStageNodes(stages),
    description: stringValue(payload.description) ?? "",
    whenToUse: stringArray(payload.when_to_use),
    packetArtifacts: stringArray(payload.packet_artifacts),
    qualityGates: stringArray(payload.quality_gates),
    failurePolicy: workflowFailurePolicy(payload.failure_policy),
    source,
    path: filePath,
  };
}

function workflowIdFromPath(filePath: string): string {
  return path.basename(filePath, ".toml");
}

function validateWorkflowTomlRoot(payload: Record<string, unknown>, label: string): void {
  for (const [key, value] of Object.entries(payload)) {
    if (!WORKFLOW_TOP_LEVEL_FIELDS.has(key)) {
      throw new Error(`invalid workflow TOML ${label}: unknown top-level field: ${key}`);
    }
    if (isRecord(value) && key !== "failure_policy") {
      throw new Error(`invalid workflow TOML ${label}: sections are not supported: ${key}`);
    }
  }
}

function workflowFailurePolicy(value: unknown): Workflow["failurePolicy"] {
  if (!isRecord(value)) {
    return { stage_types: {}, nodes: {} };
  }
  return {
    stage_types: isRecord(value.stage_types) ? recordMapFromRecord(value.stage_types) : {},
    nodes: isRecord(value.nodes) ? recordMapFromRecord(value.nodes) : {},
  };
}

function recordMapFromRecord(value: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])),
  );
}

export interface AgentMeshStageNodeSummary {
  id: string;
  type: string;
  occurrence: number;
}

export interface AgentMeshPromptByteMetric {
  path: string;
  bytes: number;
  stage: string;
  agent?: string;
  kind?: string;
}

export interface AgentMeshStageTimingSummary {
  stage: string;
  attempt_count: number;
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  duration_ms?: number;
  exit_code?: number | null;
}

export interface AgentMeshArtifactSummary {
  name: string;
  path: string;
  kind: string;
  stage: string;
  agent?: string;
}

export interface AgentMeshArtifactPreview extends AgentMeshArtifactSummary {
  content: string;
  truncated: boolean;
}

export interface AgentMeshRunDetail {
  summary: AgentMeshRunSummary;
  status: Record<string, unknown>;
  events: PacketEvent[];
  events_page: AgentMeshEventPage;
  artifacts: AgentMeshArtifactSummary[];
  review_release: AgentMeshReviewReleaseView;
}

export interface AgentMeshReleaseVerdictView {
  value: string | null;
  diagnostic: string | null;
}

export interface AgentMeshReviewReleaseView {
  release_verdict?: AgentMeshReleaseVerdictView;
  findings: {
    present: boolean;
    accepted: string[];
    rejected: string[];
    needs_decision: string[];
  };
  raw_reviews: AgentMeshRawReviewView[];
  release_summary: {
    present: boolean;
    path: string;
    truncated: boolean;
    sections: AgentMeshMarkdownSectionView[];
  };
  skipped_checks: string[];
  residual_risk: string[];
}

export interface AgentMeshRawReviewView {
  reviewer: string;
  reviewer_label?: string;
  path: string;
  content: string;
  truncated: boolean;
}

export interface AgentMeshMarkdownSectionView {
  heading: string;
  content: string;
  items: string[];
}

const RUNS_RELATIVE_DIR = ".agentmesh/runs";
const DEFAULT_RUN_PAGE_SIZE = 50;
const MAX_RUN_PAGE_SIZE = 5_000;
const DEFAULT_EVENT_TAIL = 50;
const MAX_EVENT_PAGE_SIZE = 200;
const DEFAULT_PREVIEW_BYTES = 64 * 1024;
const RELEASE_SUMMARY_HEADINGS = [
  "Run",
  "Evidence Inventory",
  "Skipped Or Missing Evidence",
  "Verification Evidence",
  "Residual Risk Signals",
  "Controller Verification",
  "Review Findings",
  "Recent Events",
];
const EVENTS_FILE = "events.jsonl";
const STATUS_FILE = "status.json";
const ARTIFACTS_FILE = "artifacts.toml";
const WORKSPACE_COMPATIBILITY_RELATIVE_PATH = path.join(".agentmesh", "compatibility.json");
const WORKSPACE_COMPATIBILITY_SCHEMA_VERSION = 1;
const CALL_RECORD_SCHEMA_VERSION = 1;
const RUNTIME_CALLS_RELATIVE_DIR = AGENTMESH_CALLS_RELATIVE_DIR;
const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

const RUNTIME_ADAPTERS: RuntimeAdapterMetadata[] = [
  { id: "command", aliases: [], command: "", args: [], label: "Command Agent" },
  { id: "codex-cli", aliases: ["codex"], command: "codex", args: ["exec"], label: "Codex CLI" },
  { id: "claude-code-cli", aliases: ["claude"], command: "claude", args: ["-p"], label: "Claude Code CLI" },
  { id: "cursor-agent", aliases: ["cursor"], command: "cursor-agent", args: ["--print", "--trust"], label: "Cursor Agent" },
  { id: "antigravity-cli", aliases: ["antigravity"], command: "agy", args: [], label: "Antigravity CLI" },
  { id: "opencode-cli", aliases: ["opencode"], command: "opencode", args: ["run"], label: "OpenCode CLI" },
];

const BUILTIN_WORKFLOWS: readonly Workflow[] = [
  builtinWorkflow(BUILTIN_WORKFLOW_IDS.BUG_FIX, "Bug Fix", ["plan", "execute", "review", "decide"]),
  builtinWorkflow(BUILTIN_WORKFLOW_IDS.IMPLEMENTATION_PLAN, "Implementation Plan", ["plan", "decide"]),
  builtinWorkflow(BUILTIN_WORKFLOW_IDS.REVIEW_GATE, "Review Gate", ["review", "decide"], {
    recipeSource: "docs/workflows/review-gate.toml",
  }),
  builtinWorkflow(BUILTIN_WORKFLOW_IDS.GUIDED_DELIVERY, "Guided Delivery", ["plan", "execute", "review", "decide"]),
  builtinWorkflow(BUILTIN_WORKFLOW_IDS.VERIFIED_DELIVERY, "Verified Delivery", ["plan", "execute", "verify", "review", "decide"]),
  builtinWorkflow(BUILTIN_WORKFLOW_IDS.HANDOFF, "Handoff", ["plan", "execute", "decide"]),
  builtinWorkflow(BUILTIN_WORKFLOW_IDS.RELEASE_CHECK, "Release Check", ["review", "decide"]),
  builtinWorkflow(BUILTIN_WORKFLOW_IDS.RESEARCH_SPIKE, "Research Spike", ["plan", "execute", "decide"]),
];

function builtinWorkflow(
  workflowId: string,
  name: string,
  stages: string[],
  extras: Partial<Pick<Workflow, "recipeSource">> = {},
): Workflow {
  return {
    workflowId,
    name,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    workflowRecipeVersion: WORKFLOW_RECIPE_SCHEMA_VERSION,
    compatiblePacketSchemaVersions: [CURRENT_PACKET_SCHEMA_VERSION],
    stages,
    stageNodes: deriveStageNodes(stages),
    description: `${name} workflow.`,
    whenToUse: [`Use ${name} when this workflow fits the request.`],
    packetArtifacts: ["request.md", ...canonicalArtifacts(stages)],
    qualityGates: [`${name} records durable packet evidence.`],
    failurePolicy: { stage_types: {}, nodes: {} },
    source: "builtin",
    ...extras,
  };
}

function canonicalArtifacts(stages: string[]): string[] {
  const byStage: Record<string, string> = {
    plan: "plan.md",
    execute: "handoff.md",
    verify: "verification.md",
    review: "findings.md",
    decide: "decision.md",
  };
  return [...new Set(stages.map((stage) => byStage[stage]).filter((item): item is string => item !== undefined))];
}

export function listWorkflows(options: AgentMeshReadOptions = {}): AgentMeshWorkflowSummary[] {
  const latestRuns = latestRunByWorkflow(options);
  return listRuntimeWorkflows(workflowSearchDirs(options.cwd, options.configPath))
    .map((workflow) => workflowSummary(workflow, latestRuns.get(workflow.workflowId)));
}

export function getWorkflow(
  workflowId: string,
  options: AgentMeshReadOptions = {},
): AgentMeshWorkflowDetail {
  const workflow = getRuntimeWorkflow(
    workflowId,
    workflowSearchDirs(options.cwd, options.configPath),
  );
  const summary = workflowSummary(workflow, latestRunByWorkflow(options).get(workflow.workflowId));
  const requiredCapabilities = new Set(workflow.stages);
  const agents = listAgentsIfConfigured(options).filter((agent) =>
    [...requiredCapabilities].every((stage) => agent.capabilities.includes(stage)),
  );
  return {
    ...summary,
    schemaVersion: workflow.schemaVersion,
    workflowRecipeVersion: workflow.workflowRecipeVersion,
    compatiblePacketSchemaVersions: [...workflow.compatiblePacketSchemaVersions],
    stageNodes: workflow.stageNodes,
    description: workflow.description,
    whenToUse: [...workflow.whenToUse],
    packetArtifacts: [...workflow.packetArtifacts],
    qualityGates: [...workflow.qualityGates],
    failurePolicy: workflow.failurePolicy,
    agents,
    ...(workflow.recipeSource ? { recipeSource: workflow.recipeSource } : {}),
    ...(workflow.path ? { path: workflow.path } : {}),
  };
}

export function listAgents(options: AgentMeshReadOptions = {}): AgentMeshAgentSummary[] {
  const loaded = loadConfigWithSources(options.configPath, options.cwd);
  return Object.entries(loaded.config.agents)
    .map(([id, payload]) => agentSummary(id, payload, loaded.agentSources[id]))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function listAgentsIfConfigured(options: AgentMeshReadOptions): AgentMeshAgentSummary[] {
  try {
    return listAgents(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("no config found; searched:")) {
      return [];
    }
    throw error;
  }
}

function optionalAgentLabelMap(options: AgentMeshReadOptions): Map<string, string> {
  try {
    return new Map(listAgentsIfConfigured(options).map((agent) => [agent.id, agent.label]));
  } catch {
    return new Map();
  }
}

export function listRuns(options: AgentMeshRunListOptions = {}): AgentMeshRunPage {
  const runs = readRunSummaries(options.cwd, options.eventTail ?? 1);
  const pageSize = normalizePageSize(options.pageSize, DEFAULT_RUN_PAGE_SIZE, MAX_RUN_PAGE_SIZE);
  const page = normalizePage(options.page);
  const offset = (page - 1) * pageSize;
  return {
    runs: runs.slice(offset, offset + pageSize),
    page,
    page_size: pageSize,
    total: runs.length,
  };
}

export function getRun(
  runIdOrDir: string,
  options: AgentMeshRunReadOptions = {},
): AgentMeshRunDetail {
  const runDir = resolveRunDirectory(runIdOrDir, options.cwd);
  const eventPage = readEventWindow(runDir, {
    offset: options.eventOffset,
    limit: options.eventLimit ?? options.eventTail ?? DEFAULT_EVENT_TAIL,
  });
  const status = loadStatus(runDir) as Record<string, unknown>;
  const agentLabels = optionalAgentLabelMap(options);
  return {
    summary: runSummary(runDir, 1),
    status,
    events: eventPage.events,
    events_page: eventPage.page,
    artifacts: listArtifacts(runDir),
    review_release: readReviewReleaseView(runDir, status, options.previewBytes ?? DEFAULT_PREVIEW_BYTES, agentLabels),
  };
}

export function listRunEvents(
  runIdOrDir: string,
  options: AgentMeshRunEventListOptions = {},
): AgentMeshRunEventPage {
  const runDir = resolveRunDirectory(runIdOrDir, options.cwd);
  const events = readAllEvents(runDir);
  const pageSize = normalizePageSize(options.pageSize, DEFAULT_EVENT_TAIL, MAX_EVENT_PAGE_SIZE);
  const page = normalizePage(options.page);
  const offset = (page - 1) * pageSize;
  return {
    events: events.slice(offset, offset + pageSize),
    page,
    page_size: pageSize,
    offset,
    limit: pageSize,
    total: events.length,
  };
}

export function listArtifacts(
  runIdOrDir: string,
  options: AgentMeshReadOptions = {},
): AgentMeshArtifactSummary[] {
  const runDir = resolveRunDirectory(runIdOrDir, options.cwd);
  return Object.entries(loadArtifacts(runDir))
    .map(([name, artifact]) => ({
      name,
      path: requiredString(artifact.path, `artifacts.${name}.path`),
      kind: requiredString(artifact.kind, `artifacts.${name}.kind`),
      stage: requiredString(artifact.stage, `artifacts.${name}.stage`),
      ...(stringValue(artifact.agent) ? { agent: stringValue(artifact.agent) } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function readArtifactPreview(
  runIdOrDir: string,
  artifactName: string,
  options: AgentMeshRunReadOptions = {},
): AgentMeshArtifactPreview {
  const runDir = resolveRunDirectory(runIdOrDir, options.cwd);
  const artifact = listArtifacts(runDir).find((item) => item.name === artifactName);
  if (!artifact) {
    throw new Error(`artifact not found: ${artifactName}`);
  }
  const resolved = resolveArtifactPath(runDir, artifact.path);
  if (!resolved.insideRunDir) {
    throw new Error(`artifact path escapes run directory: ${artifact.path}`);
  }
  const bytes = readFileSync(resolved.path);
  const limit = options.previewBytes ?? DEFAULT_PREVIEW_BYTES;
  const truncated = bytes.length > limit;
  return {
    ...artifact,
    content: bytes.subarray(0, limit).toString("utf-8"),
    truncated,
  };
}

export function listCalls(options: AgentMeshCallReadOptions = {}): AgentMeshCallRecord[] {
  return listRuntimeCallRecords(options.cwd ?? process.cwd());
}

export function getCall(
  callIdOrDir: string,
  options: AgentMeshCallReadOptions = {},
): AgentMeshCallRecord {
  return readRuntimeCallRecord(resolveCallDirectory(callIdOrDir, options.cwd));
}

export function listCallAdoptionEvents(
  callIdOrDir: string,
  options: AgentMeshCallReadOptions = {},
): AgentMeshCallAdoptionEvent[] {
  return readRuntimeCallAdoptionEvents(resolveCallDirectory(callIdOrDir, options.cwd));
}

export function resolveCallDirectory(callIdOrDir: string, cwd = process.cwd()): string {
  const value = callIdOrDir.trim();
  if (!value) {
    throw new Error("call id cannot be empty");
  }
  if (path.isAbsolute(value)) {
    if (!existsSync(path.join(value, "call.json"))) {
      throw new Error(`call not found: ${callIdOrDir}`);
    }
    return value;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`invalid call id: ${callIdOrDir}`);
  }
  const callsDir = path.resolve(cwd, RUNTIME_CALLS_RELATIVE_DIR);
  const callDir = path.resolve(callsDir, value);
  const relative = path.relative(callsDir, callDir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`invalid call id: ${callIdOrDir}`);
  }
  if (!existsSync(path.join(callDir, "call.json"))) {
    throw new Error(`call not found: ${callIdOrDir}`);
  }
  return callDir;
}

export function resolveRunDirectory(runIdOrDir: string, cwd = process.cwd()): string {
  if (!runIdOrDir || runIdOrDir.trim().length === 0) {
    throw new Error("run id cannot be empty");
  }
  return resolveRuntimeRunDirectory(runIdOrDir, cwd);
}

function resolveRuntimeRunDirectory(runIdOrDir: string, cwd = process.cwd()): string {
  const directPath = path.resolve(cwd, runIdOrDir);
  if (isDirectory(directPath)) {
    return directPath;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(runIdOrDir) || runIdOrDir === "." || runIdOrDir === "..") {
    throw new Error(`invalid run id: ${runIdOrDir}`);
  }
  return path.resolve(cwd, ".agentmesh", "runs", runIdOrDir);
}

function loadStatus(runDir: string): Record<string, unknown> {
  const payload = readJsonObject(path.join(runDir, STATUS_FILE), STATUS_FILE);
  if (payload.schema_version !== CURRENT_PACKET_SCHEMA_VERSION) {
    throw new Error(`unsupported packet schema version: ${String(payload.schema_version)}`);
  }
  return payload;
}

function isUnsupportedPacketSchemaVersionError(error: unknown): boolean {
  return error instanceof Error && /^unsupported packet schema version: /.test(error.message);
}

function loadEvents(runDir: string): PacketEvent[] {
  const eventsPath = path.join(runDir, EVENTS_FILE);
  if (!isFile(eventsPath)) {
    return [];
  }
  return readFileSync(eventsPath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as PacketEvent;
      } catch {
        throw new Error(`${EVENTS_FILE}:${index + 1} invalid JSON`);
      }
    });
}

function loadArtifacts(runDir: string): Record<string, Record<string, unknown>> {
  const manifestPath = path.join(runDir, ARTIFACTS_FILE);
  if (!isFile(manifestPath)) {
    return {};
  }
  const payload = parseTomlDocument(readFileSync(manifestPath, "utf-8"), ARTIFACTS_FILE, `invalid ${ARTIFACTS_FILE}`);
  if (payload.schema_version !== CURRENT_SCHEMA_VERSION) {
    throw new Error(`${ARTIFACTS_FILE}.schema_version must be ${CURRENT_SCHEMA_VERSION}`);
  }
  return isRecord(payload.artifacts) ? recordMap(payload.artifacts) : {};
}

function resolveArtifactPath(runDir: string, artifactPath: string): { path: string; insideRunDir: boolean } {
  const resolvedPath = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(runDir, artifactPath);
  const relative = path.relative(runDir, resolvedPath);
  return {
    path: resolvedPath,
    insideRunDir: relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)),
  };
}

function workspaceCompatibilityDiagnostics(
  workspace: string,
  options: { entrypoint?: string; runtimeVersion?: string } = {},
): WorkspaceCompatibilityDiagnostics {
  const compatibilityPath = path.join(path.resolve(workspace), WORKSPACE_COMPATIBILITY_RELATIVE_PATH);
  const base = {
    current_runtime_version: options.runtimeVersion ?? "0.1.2",
    current_entrypoint: options.entrypoint ?? "cli",
    compatibility_path: compatibilityPath,
  };
  if (!existsSync(compatibilityPath)) {
    return {
      ...base,
      decision: "read_write",
      metadata_state: "missing_legacy",
      metadata: null,
      reasons: [
        "compatibility metadata is missing; treating workspace as legacy readable until the next successful mutation backfills it",
      ],
    };
  }
  try {
    const metadata = readJsonObject(compatibilityPath, WORKSPACE_COMPATIBILITY_RELATIVE_PATH);
    if (numberValue(metadata.schema_version) !== undefined && numberValue(metadata.schema_version)! > WORKSPACE_COMPATIBILITY_SCHEMA_VERSION) {
      return {
        ...base,
        decision: "read_only",
        metadata_state: "newer_schema",
        metadata,
        reasons: [
          `compatibility metadata schema_version ${metadata.schema_version} is newer than supported version ${WORKSPACE_COMPATIBILITY_SCHEMA_VERSION}`,
        ],
      };
    }
    if (metadata.packet_schema_version !== CURRENT_PACKET_SCHEMA_VERSION) {
      return {
        ...base,
        decision: "refused",
        metadata_state: "ok",
        metadata,
        reasons: [`packet_schema_version ${String(metadata.packet_schema_version)} is not supported`],
      };
    }
    if (
      typeof metadata.min_read_runtime_version === "string" &&
      semverGreaterThan(metadata.min_read_runtime_version, base.current_runtime_version)
    ) {
      return {
        ...base,
        decision: "refused",
        metadata_state: "ok",
        metadata,
        reasons: [
          `min_read_runtime_version ${metadata.min_read_runtime_version} is newer than current runtime ${base.current_runtime_version}`,
        ],
      };
    }
    if (
      typeof metadata.min_write_runtime_version === "string" &&
      semverGreaterThan(metadata.min_write_runtime_version, base.current_runtime_version)
    ) {
      return {
        ...base,
        decision: "read_only",
        metadata_state: "ok",
        metadata,
        reasons: [
          `min_write_runtime_version ${metadata.min_write_runtime_version} is newer than current runtime ${base.current_runtime_version}`,
        ],
      };
    }
    return { ...base, decision: "read_write", metadata_state: "ok", metadata, reasons: [] };
  } catch (error) {
    return {
      ...base,
      decision: "refused",
      metadata_state: "invalid",
      metadata: null,
      reasons: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function listRuntimeCallRecords(workspace: string): DirectCallRecord[] {
  const callsDir = path.join(workspace, RUNTIME_CALLS_RELATIVE_DIR);
  if (!isDirectory(callsDir)) {
    return [];
  }
  return readdirSync(callsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(callsDir, entry.name))
    .filter((callDir) => isFile(path.join(callDir, "call.json")))
    .map((callDir) => readRuntimeCallRecord(callDir))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function readRuntimeCallRecord(callDir: string): DirectCallRecord {
  const record = readJsonObject(path.join(callDir, "call.json"), "call.json") as unknown as DirectCallRecord;
  if (record.schema_version > CALL_RECORD_SCHEMA_VERSION) {
    return {
      ...record,
      read_only: true,
      schema_warning: `call record schema_version ${record.schema_version} is newer than supported version ${CALL_RECORD_SCHEMA_VERSION}`,
    };
  }
  if (record.status === "running" && isStale(record.heartbeat_at)) {
    return { ...record, status: "stale" };
  }
  return record;
}

function readRuntimeCallAdoptionEvents(callDir: string): CallAdoptionEvent[] {
  const eventsPath = path.join(callDir, "adoption.jsonl");
  if (!isFile(eventsPath)) {
    return [];
  }
  return readFileSync(eventsPath, "utf-8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CallAdoptionEvent);
}

function agentSummary(
  id: string,
  payload: Record<string, unknown>,
  source?: ConfigSourceRef,
): AgentMeshAgentSummary {
  const adapter = normalizeRuntimeAdapterId(stringValue(payload.adapter) ?? "command");
  const defaults = lookupRuntimeAdapter(adapter);
  return {
    id,
    label: stringValue(payload.label) ?? defaults.label,
    adapter,
    command: stringValue(payload.command) ?? defaults.command,
    args: stringArray(payload.args, defaults.args),
    env: stringArray(payload.env),
    capabilities: stringArray(payload.capabilities),
    verification_status: "configured",
    disabled: payload.disabled === true,
    status: payload.disabled === true ? "disabled" : "enabled",
    ...(stringValue(payload.model) ? { model: stringValue(payload.model) } : {}),
    ...(stringValue(payload.reasoning_effort)
      ? { reasoning_effort: stringValue(payload.reasoning_effort) }
      : {}),
    ...(stringValue(payload.prompt_file_arg)
      ? { prompt_file_arg: stringValue(payload.prompt_file_arg) }
      : {}),
    ...(stringValue(payload.prompt_arg) ? { prompt_arg: stringValue(payload.prompt_arg) } : {}),
    ...(stringValue(payload.output_file_arg)
      ? { output_file_arg: stringValue(payload.output_file_arg) }
      : {}),
    ...(payload.stdin === true ? { stdin: true } : {}),
    ...(source ? { source_layer: source.source, source_path: source.path } : {}),
  };
}

function workflowSummary(
  workflow: Workflow,
  latestRun: AgentMeshRunSummary | undefined,
): AgentMeshWorkflowSummary {
  return {
    workflowId: workflow.workflowId,
    name: workflow.name,
    source: workflow.source,
    stages: [...workflow.stages],
    ...workflowFileTimestamps(workflow.path),
    ...(workflow.recipeSource ? { recipeSource: workflow.recipeSource } : {}),
    ...(workflow.path ? { path: workflow.path } : {}),
    ...(latestRun
      ? {
          latest_run: {
            run_id: latestRun.run_id,
            status: latestRun.status,
            ...(latestRun.updated_at ? { updated_at: latestRun.updated_at } : {}),
            ...(latestRun.latest_event ? { latest_event: latestRun.latest_event } : {}),
            ...(latestRun.latest_event_timestamp
              ? { latest_event_timestamp: latestRun.latest_event_timestamp }
              : {}),
          },
        }
      : {}),
  };
}

function workflowFileTimestamps(workflowPath: string | undefined): {
  created_at?: string;
  updated_at?: string;
} {
  if (!workflowPath) {
    return {};
  }
  const stats = statSync(workflowPath);
  return {
    created_at: stats.birthtime.toISOString(),
    updated_at: stats.mtime.toISOString(),
  };
}

function latestRunByWorkflow(options: AgentMeshReadOptions): Map<string, AgentMeshRunSummary> {
  const latest = new Map<string, AgentMeshRunSummary>();
  for (const run of readRunSummaries(options.cwd, 1)) {
    if (!run.workflow || latest.has(run.workflow)) {
      continue;
    }
    latest.set(run.workflow, run);
  }
  return latest;
}

function readRunSummaries(cwd = process.cwd(), eventTail: number): AgentMeshRunSummary[] {
  const runsDir = path.resolve(cwd, RUNS_RELATIVE_DIR);
  if (!isDirectory(runsDir)) {
    return [];
  }
  const runs: AgentMeshRunSummary[] = [];
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = path.join(runsDir, entry.name);
    if (!isFile(path.join(runDir, STATUS_FILE))) {
      continue;
    }
    try {
      runs.push(runSummary(runDir, eventTail));
    } catch (error) {
      if (isUnsupportedPacketSchemaVersionError(error)) {
        continue;
      }
      throw error;
    }
  }
  return runs.sort(compareRuns);
}

function runSummary(runDir: string, eventTail: number): AgentMeshRunSummary {
  const status = loadStatus(runDir) as Record<string, unknown>;
  const events = readEventTail(runDir, eventTail);
  const latestEvent = events.at(-1) as Record<string, unknown> | undefined;
  const stages = stringArray(status.stages);
  const stageNodes = stageNodeSummaries(status.stage_nodes);
  const orderedStageIds = stageNodes.length > 0 ? stageNodes.map((node) => node.id) : stages;
  return {
    run_id: stringValue(status.run_id) ?? path.basename(runDir),
    run_dir: runDir,
    ...(stringValue(status.created_at) ? { created_at: stringValue(status.created_at) } : {}),
    ...(stringValue(status.updated_at) ? { updated_at: stringValue(status.updated_at) } : {}),
    status: stringValue(status.status) ?? "unknown",
    ...(stringValue(status.workflow) ? { workflow: stringValue(status.workflow) } : {}),
    stages,
    ...(stageNodes.length > 0 ? { stage_nodes: stageNodes } : {}),
    completed_stages: stringArray(status.completed_stages),
    stage_timing: stageTimingSummaries(status),
    ...stageExecutionFacts(status),
    ...(numberValue(status.context_bytes) !== undefined
      ? { context_bytes: numberValue(status.context_bytes) }
      : {}),
    ...(isRecord(status.prompt_bytes)
      ? { prompt_bytes: promptByteMetrics(status.prompt_bytes) }
      : {}),
    ...currentStage(status, orderedStageIds),
    ...(isRecord(status.resolved_context_policy)
      ? { resolved_context_policy: status.resolved_context_policy }
      : {}),
    ...(isRecord(status.resolved_execution_policy)
      ? { resolved_execution_policy: status.resolved_execution_policy }
      : {}),
    ...(stringValue(latestEvent?.event) ? { latest_event: stringValue(latestEvent?.event) } : {}),
    ...(stringValue(latestEvent?.timestamp)
      ? { latest_event_timestamp: stringValue(latestEvent?.timestamp) }
      : {}),
  };
}

function stageNodeSummaries(value: unknown): AgentMeshStageNodeSummary[] {
  return Array.isArray(value)
    ? value
        .filter((node): node is Record<string, unknown> => isRecord(node))
        .map((node) => {
          const id = stringValue(node.id);
          const type = stringValue(node.type);
          const occurrence = numberValue(node.occurrence);
          return id && type && occurrence !== undefined ? { id, type, occurrence } : undefined;
        })
        .filter((node): node is AgentMeshStageNodeSummary => node !== undefined)
    : [];
}

function stageExecutionFacts(status: Record<string, unknown>): Partial<AgentMeshRunSummary> {
  return {
    ...recordIfPresent("stage_assignments", stringArrayRecord(status.stage_assignments)),
    ...recordIfPresent("stage_invocations", recordArrayMap(status.stage_invocations)),
    ...recordIfPresent("stage_failure_policies", recordMap(status.stage_failure_policies)),
    ...recordIfPresent("stage_fallbacks", recordMap(status.stage_fallbacks)),
    ...recordIfPresent("stage_attempts", recordArrayMap(status.stage_attempts)),
    ...recordIfPresent("assignment_provenance", unknownRecord(status.assignment_provenance)),
    ...recordIfPresent("fallback_provenance", unknownRecord(status.fallback_provenance)),
    ...recordIfPresent("timeout_provenance", unknownRecord(status.timeout_provenance)),
  };
}

function recordIfPresent<T extends Record<string, unknown>>(
  key: keyof AgentMeshRunSummary,
  value: T,
): Partial<AgentMeshRunSummary> {
  return Object.keys(value).length > 0 ? { [key]: value } : {};
}

function stringArrayRecord(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    return {};
  }
  const output: Record<string, string[]> = {};
  for (const [key, items] of Object.entries(value)) {
    output[key] = stringArray(items);
  }
  return output;
}

function recordArrayMap(value: unknown): Record<string, Array<Record<string, unknown>>> {
  if (!isRecord(value)) {
    return {};
  }
  const output: Record<string, Array<Record<string, unknown>>> = {};
  for (const [key, items] of Object.entries(value)) {
    output[key] = Array.isArray(items)
      ? items.filter((item): item is Record<string, unknown> => isRecord(item))
      : [];
  }
  return output;
}

function recordMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(value)) {
    return {};
  }
  const output: Record<string, Record<string, unknown>> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isRecord(item)) {
      output[key] = item;
    }
  }
  return output;
}

function unknownRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function promptByteMetrics(value: Record<string, unknown>): Record<string, AgentMeshPromptByteMetric> {
  const output: Record<string, AgentMeshPromptByteMetric> = {};
  for (const [name, metric] of Object.entries(value)) {
    if (!isRecord(metric)) {
      continue;
    }
    const pathValue = stringValue(metric.path);
    const bytes = numberValue(metric.bytes);
    const stage = stringValue(metric.stage);
    if (!pathValue || bytes === undefined || !stage) {
      continue;
    }
    output[name] = {
      path: pathValue,
      bytes,
      stage,
      ...(stringValue(metric.agent) ? { agent: stringValue(metric.agent) } : {}),
      ...(stringValue(metric.kind) ? { kind: stringValue(metric.kind) } : {}),
    };
  }
  return output;
}

function currentStage(
  status: Record<string, unknown>,
  stages: string[],
): { current_stage?: string } {
  const explicit = stringValue(status.current_stage);
  if (explicit) {
    return { current_stage: explicit };
  }
  const completed = new Set(stringArray(status.completed_stages));
  const current = stages.find((stage) => !completed.has(stage));
  return current ? { current_stage: current } : {};
}

function stageTimingSummaries(status: Record<string, unknown>): AgentMeshStageTimingSummary[] {
  if (!isRecord(status.stage_timing)) {
    return [];
  }
  const order = stageOrder(status);
  const stageTiming = status.stage_timing;
  const ordered = order.length > 0 ? order : Object.keys(stageTiming).sort();
  return ordered
    .map((stage) => stageTimingSummary(stage, stageTiming))
    .filter((item): item is AgentMeshStageTimingSummary => item !== undefined);
}

function stageOrder(status: Record<string, unknown>): string[] {
  if (Array.isArray(status.stage_nodes)) {
    return status.stage_nodes
      .filter((node): node is Record<string, unknown> => isRecord(node))
      .map((node) => stringValue(node.id))
      .filter((stage): stage is string => stage !== undefined);
  }
  return stringArray(status.stages);
}

function stageTimingSummary(
  stage: string,
  stageTiming: Record<string, unknown>,
): AgentMeshStageTimingSummary | undefined {
  const timing = stageTiming[stage];
  if (!isRecord(timing)) {
    return undefined;
  }
  return {
    stage,
    ...(stringValue(timing.started_at) ? { started_at: stringValue(timing.started_at) } : {}),
    ...(stringValue(timing.completed_at) ? { completed_at: stringValue(timing.completed_at) } : {}),
    ...(stringValue(timing.failed_at) ? { failed_at: stringValue(timing.failed_at) } : {}),
    ...(numberValue(timing.duration_ms) !== undefined ? { duration_ms: numberValue(timing.duration_ms) } : {}),
    attempt_count: numberValue(timing.attempt_count) ?? 0,
    ...(timing.exit_code === null || numberValue(timing.exit_code) !== undefined
      ? { exit_code: timing.exit_code === null ? null : numberValue(timing.exit_code) }
      : {}),
  };
}

function readEventTail(runDir: string, tail: number): PacketEvent[] {
  const events = readAllEvents(runDir);
  return tail <= 0 ? events : events.slice(-tail);
}

function readEventWindow(
  runDir: string,
  options: { offset?: number; limit: number },
): { events: PacketEvent[]; page: AgentMeshEventPage } {
  const events = readAllEvents(runDir);
  const total = events.length;
  const limit = normalizePageSize(options.limit, DEFAULT_EVENT_TAIL, MAX_EVENT_PAGE_SIZE);
  const latestOffset = Math.max(0, total - limit);
  const requestedOffset = options.offset ?? latestOffset;
  const offset = clampInteger(requestedOffset, 0, latestOffset);
  return {
    events: events.slice(offset, offset + limit),
    page: { offset, limit, total },
  };
}

function readAllEvents(runDir: string): PacketEvent[] {
  if (!isFile(path.join(runDir, EVENTS_FILE))) {
    return [];
  }
  return loadEvents(runDir);
}

function readReviewReleaseView(
  runDir: string,
  status: Record<string, unknown>,
  previewBytes: number,
  agentLabels: Map<string, string>,
): AgentMeshReviewReleaseView {
  const findings = readOptionalPacketText(runDir, "findings.md", previewBytes);
  const releaseSummary = readOptionalPacketText(runDir, "release-summary.md", previewBytes);
  const handoff = readOptionalPacketText(runDir, "handoff.md", previewBytes);
  const releaseSummaryContent = releaseSummary?.content ?? "";
  const releaseVerdict = releaseVerdictView(status.release_verdict);
  const fallbackResidualRisk = [
    ...markdownSectionItems(handoff?.content ?? "", "Not Verified"),
    ...markdownSectionItems(handoff?.content ?? "", "Remaining Risk"),
  ];
  const residualRisk = markdownSectionItems(releaseSummaryContent, "Residual Risk Signals");
  const rawReviews = mergeRawReviews(
    readRawReviewViews(runDir, previewBytes, agentLabels),
    embeddedRawReviewViews(findings?.content ?? "", agentLabels),
  );

  return {
    ...(releaseVerdict ? { release_verdict: releaseVerdict } : {}),
    findings: {
      present: findings !== undefined,
      accepted: markdownSectionItems(findings?.content ?? "", "Accepted"),
      rejected: markdownSectionItems(findings?.content ?? "", "Rejected"),
      needs_decision: markdownSectionItems(findings?.content ?? "", "Needs Decision"),
    },
    raw_reviews: rawReviews,
    release_summary: {
      present: releaseSummary !== undefined,
      path: "release-summary.md",
      truncated: releaseSummary?.truncated ?? false,
      sections: RELEASE_SUMMARY_HEADINGS.map((heading) => {
        const content = markdownSectionContent(releaseSummaryContent, heading);
        return {
          heading,
          content,
          items: markdownItems(content),
        };
      }).filter((section) => section.content.length > 0),
    },
    skipped_checks: markdownSectionItems(releaseSummaryContent, "Skipped Or Missing Evidence"),
    residual_risk: residualRisk.length > 0 ? residualRisk : fallbackResidualRisk,
  };
}

function mergeRawReviews(
  primary: AgentMeshRawReviewView[],
  fallback: AgentMeshRawReviewView[],
): AgentMeshRawReviewView[] {
  const seen = new Set(primary.map((review) => review.reviewer));
  return [
    ...primary,
    ...fallback.filter((review) => {
      if (seen.has(review.reviewer)) {
        return false;
      }
      seen.add(review.reviewer);
      return true;
    }),
  ];
}

function readRawReviewViews(
  runDir: string,
  previewBytes: number,
  agentLabels: Map<string, string>,
): AgentMeshRawReviewView[] {
  const reviewsDir = path.join(runDir, "reviews");
  if (!isDirectory(reviewsDir)) {
    return [];
  }
  return readdirSync(reviewsDir)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort()
    .map((fileName) => {
      const relativePath = `reviews/${fileName}`;
      const review = readOptionalPacketText(runDir, relativePath, previewBytes);
      const reviewer = path.basename(fileName, ".md");
      return {
        reviewer,
        ...rawReviewLabel(reviewer, agentLabels),
        path: relativePath,
        content: review?.content ?? "",
        truncated: review?.truncated ?? false,
      };
    });
}

function embeddedRawReviewViews(
  findings: string,
  agentLabels: Map<string, string>,
): AgentMeshRawReviewView[] {
  const rawReviewSection = markdownSectionContent(findings, "Raw Review Outputs");
  if (!rawReviewSection) {
    return [];
  }
  const reviews: AgentMeshRawReviewView[] = [];
  let reviewer = "";
  let lines: string[] = [];
  for (const line of rawReviewSection.split(/\r?\n/)) {
    if (line.startsWith("### ")) {
      if (reviewer) {
        reviews.push(embeddedRawReviewView(reviewer, lines, agentLabels));
      }
      reviewer = line.slice(4).trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  if (reviewer) {
    reviews.push(embeddedRawReviewView(reviewer, lines, agentLabels));
  }
  return reviews;
}

function embeddedRawReviewView(
  reviewer: string,
  lines: string[],
  agentLabels: Map<string, string>,
): AgentMeshRawReviewView {
  const safeReviewer = reviewer.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "agent";
  return {
    reviewer,
    ...rawReviewLabel(reviewer, agentLabels),
    path: `findings.md#raw-review-outputs/${safeReviewer}`,
    content: lines.join("\n").trim(),
    truncated: false,
  };
}

function rawReviewLabel(
  reviewer: string,
  agentLabels: Map<string, string>,
): Pick<AgentMeshRawReviewView, "reviewer_label"> {
  const label = agentLabels.get(reviewer);
  return label && label !== reviewer ? { reviewer_label: label } : {};
}

function releaseVerdictView(value: unknown): AgentMeshReleaseVerdictView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    value: typeof value.value === "string" ? value.value : null,
    diagnostic: typeof value.diagnostic === "string" ? value.diagnostic : null,
  };
}

function readOptionalPacketText(
  runDir: string,
  packetPath: string,
  limit: number,
): { content: string; truncated: boolean } | undefined {
  const resolved = resolveArtifactPath(runDir, packetPath);
  if (!resolved.insideRunDir) {
    throw new Error(`artifact path escapes run directory: ${packetPath}`);
  }
  if (!existsSync(resolved.path)) {
    return undefined;
  }
  const bytes = readFileSync(resolved.path);
  const truncated = bytes.length > limit;
  return {
    content: bytes.subarray(0, limit).toString("utf-8"),
    truncated,
  };
}

function markdownSectionItems(content: string, heading: string): string[] {
  return markdownItems(markdownSectionContent(content, heading));
}

function markdownItems(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

function markdownSectionContent(content: string, heading: string): string {
  const target = `## ${heading}`.toLocaleLowerCase();
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLocaleLowerCase() === target);
  if (start === -1) {
    return "";
  }
  const sectionLines: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines.join("\n").trim();
}

function compareRuns(left: AgentMeshRunSummary, right: AgentMeshRunSummary): number {
  const leftTime = left.latest_event_timestamp ?? left.updated_at ?? left.created_at ?? "";
  const rightTime = right.latest_event_timestamp ?? right.updated_at ?? right.created_at ?? "";
  if (leftTime !== rightTime) {
    return rightTime.localeCompare(leftTime);
  }
  return left.run_id.localeCompare(right.run_id);
}

function normalizePage(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    return 1;
  }
  return value;
}

function normalizePageSize(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    return fallback;
  }
  return Math.min(value, max);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min) {
    return min;
  }
  return Math.min(value, max);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function readJsonObject(filePath: string, label: string): Record<string, unknown> {
  if (!isFile(filePath)) {
    throw new Error(`${label} not found`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    throw new Error(`${label} invalid JSON`);
  }
  if (!isRecord(payload)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return payload;
}

function parseTomlDocument(
  content: string,
  label: string,
  errorPrefix = "invalid TOML",
): Record<string, unknown> {
  try {
    const payload = parse(content);
    if (!isRecord(payload)) {
      throw new Error("document root must be a table");
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(`${errorPrefix} ${label}: ${error.message}`);
    }
    throw new Error(`${errorPrefix} ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isStale(heartbeatAt: string | null): boolean {
  if (!heartbeatAt) {
    return true;
  }
  const timestamp = Date.parse(heartbeatAt);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > STALE_RUNNING_MS;
}

function semverGreaterThan(left: string, right: string): boolean {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index] - rightParts[index];
    if (diff > 0) {
      return true;
    }
    if (diff < 0) {
      return false;
    }
  }
  return false;
}

function semverParts(value: string): [number, number, number] {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
