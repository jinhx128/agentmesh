import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BUILTIN_WORKFLOW_IDS,
  CURRENT_PACKET_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  STAGE_TYPES,
  StageFailurePolicySchema,
  type StageFailurePolicy,
  type StageNode,
  type StageType,
  WORKFLOW_RECIPE_SCHEMA_VERSION,
  deriveStageNodes,
} from "@agentmesh/core";
import { parseTomlDocument } from "../toml.js";

const USER_WORKFLOW_DIR = path.join(".config", "agentmesh", "workflows");
export const REVIEW_GATE_RECIPE_SOURCE = "docs/workflows/review-gate.toml";
const GENERATED_WORKFLOW_ID_PATTERN = /^w-[0-9a-f]{8}$/;
const LEGACY_TEMPORARY_WORKFLOW_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const MAX_WORKFLOW_ID_GENERATION_ATTEMPTS = 64;
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
const FAILURE_POLICY_FIELDS = new Set(["stage_types", "nodes"]);
const FAILURE_POLICY_OBJECT_FIELDS = new Set(["mode", "max_fallback_agents"]);
const CANONICAL_STAGE_ARTIFACT: Record<StageType, string> = {
  plan: "plan.md",
  execute: "handoff.md",
  verify: "verification.md",
  review: "findings.md",
  decide: "decision.md",
};

export type WorkflowSource = "builtin" | "user" | "temporary";
export type WorkflowIdGenerator = () => string;

export interface WorkflowRegistryDirectory {
  source: "user";
  path: string;
}

export interface Workflow {
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
  failurePolicy: WorkflowFailurePolicyConfig;
  source: WorkflowSource;
  recipeSource?: string;
  path?: string;
}

export interface WorkflowFailurePolicyConfig {
  stage_types: Partial<Record<StageType, StageFailurePolicy>>;
  nodes: Record<string, StageFailurePolicy>;
}

export const BUILTIN_WORKFLOWS: readonly Workflow[] = [
  defineWorkflow({
    workflowId: BUILTIN_WORKFLOW_IDS.BUG_FIX,
    name: "Bug Fix",
    stages: ["plan", "execute", "review", "decide"],
    description:
      "Reproduce or characterize a defect, make the smallest safe change, review the patch, and record the final decision.",
    whenToUse: [
      "A failing behavior, regression, flaky path, or production issue needs a code change.",
      "The run needs a clear root cause, verification command, and handoff trail.",
    ],
    packetArtifacts: [
      "request.md",
      "plan.md",
      "handoff.md",
      "reviews/<reviewer>.md",
      "findings.md",
      "decision.md",
    ],
    qualityGates: [
      "The plan names reproduction evidence or explains why reproduction is unavailable.",
      "The executor records changed files, verification, and unverified risk in handoff.md.",
      "The decider accepts or rejects review findings before completion.",
    ],
    source: "builtin",
    ...workflowVersionMetadata(),
  }),
  defineWorkflow({
    workflowId: BUILTIN_WORKFLOW_IDS.IMPLEMENTATION_PLAN,
    name: "Implementation Plan",
    stages: ["plan", "decide"],
    description:
      "Turn a request into a scoped implementation plan before any agent starts changing files.",
    whenToUse: [
      "The task is multi-step, cross-file, risky, or needs role assignment before execution.",
      "A different tool or person may execute the work later from the run packet.",
    ],
    packetArtifacts: ["request.md", "assignment.toml", "plan.md", "decision.md"],
    qualityGates: [
      "The plan states goals, scope, non-goals, risks, verification, and handoff criteria.",
      "The decision records whether the plan is approved, revised, or blocked.",
    ],
    source: "builtin",
    ...workflowVersionMetadata(),
  }),
  defineWorkflow({
    workflowId: BUILTIN_WORKFLOW_IDS.REVIEW_GATE,
    name: "Review Gate",
    stages: ["review", "decide"],
    description:
      "Collect code or plan reviews from one or more read-only reviewers, then have a decider merge, verify, and classify findings.",
    whenToUse: [
      "A code diff, plan, or deliverable needs reviewer evidence before a decision.",
      "Multiple reviewers should be preserved as evidence without treating model agreement as truth.",
    ],
    packetArtifacts: [
      "request.md",
      "assignment.toml",
      "reviews/<reviewer>.md",
      "findings.md",
      "decision.md",
    ],
    qualityGates: [
      "Reviewer outputs are read-only inputs until the decider checks them against facts.",
      "findings.md groups items as accepted, rejected, or needs decision.",
      "A Must Fix gate only applies to findings the decider has accepted.",
    ],
    source: "builtin",
    recipeSource: REVIEW_GATE_RECIPE_SOURCE,
    ...workflowVersionMetadata(),
  }),
  defineWorkflow({
    workflowId: BUILTIN_WORKFLOW_IDS.GUIDED_DELIVERY,
    name: "Guided Delivery",
    stages: ["plan", "execute", "review", "decide"],
    description:
      "Deliver a user-requested artifact through planned work, execution, general review, and user-gated decision synthesis.",
    whenToUse: [
      "A feature, document, configuration, SQL change, prompt, release artifact, or other deliverable needs planned execution and one or more reviewers.",
      "The final decision should return to the entry agent and, optionally, the user.",
    ],
    packetArtifacts: [
      "request.md",
      "plan.md",
      "handoff.md",
      "reviews/<reviewer>.md",
      "findings.md",
      "decision.md",
    ],
    qualityGates: [
      "The plan identifies the deliverable, scope, non-goals, risks, and verification.",
      "Review is artifact-neutral; reviewers inspect the delivered artifact, not only code.",
      "With --user-gate, the decider summarizes options and waits for explicit user decision.",
    ],
    source: "builtin",
    ...workflowVersionMetadata(),
  }),
  defineWorkflow({
    workflowId: BUILTIN_WORKFLOW_IDS.VERIFIED_DELIVERY,
    name: "Verified Delivery",
    stages: ["plan", "execute", "verify", "review", "decide"],
    description:
      "Deliver a change with explicit verification evidence captured before review and final decision.",
    whenToUse: [
      "A feature, fix, migration, or release artifact needs durable test, build, or smoke evidence before reviewers inspect it.",
      "The team wants verification recorded as its own packet artifact instead of buried in handoff or decision notes.",
    ],
    packetArtifacts: [
      "request.md",
      "plan.md",
      "handoff.md",
      "verification.md",
      "reviews/<reviewer>.md",
      "findings.md",
      "decision.md",
    ],
    qualityGates: [
      "The verifier records commands, skipped checks, failures, and residual risk in verification.md.",
      "Review consumes verification evidence instead of substituting for it.",
      "The decider accepts or rejects review findings before completion.",
    ],
    source: "builtin",
    ...workflowVersionMetadata(),
  }),
  defineWorkflow({
    workflowId: BUILTIN_WORKFLOW_IDS.HANDOFF,
    name: "Handoff",
    stages: ["plan", "execute", "decide"],
    description:
      "Package current state so another agent, CLI, or human can continue without guessing.",
    whenToUse: [
      "The executor changes between tools or sessions.",
      "A run pauses after partial progress and must be resumed later.",
    ],
    packetArtifacts: [
      "request.md",
      "assignment.toml",
      "handoff.md",
      "events.jsonl",
      "artifacts.toml",
    ],
    qualityGates: [
      "handoff.md records current state, file scope, verified items, unverified items, and risk.",
      "The next executor can resume from packet files without private chat history.",
    ],
    source: "builtin",
    ...workflowVersionMetadata(),
  }),
  defineWorkflow({
    workflowId: BUILTIN_WORKFLOW_IDS.RELEASE_CHECK,
    name: "Release Check",
    stages: ["review", "decide"],
    description:
      "Run a final readiness review over tests, docs, run packet evidence, and known risk.",
    whenToUse: [
      "A change is ready to merge, publish, or hand to another maintainer.",
      "The team wants a concise release decision instead of another implementation pass.",
    ],
    packetArtifacts: [
      "request.md",
      "status.json",
      "events.jsonl",
      "artifacts.toml",
      "release-summary.md",
      "findings.md",
      "decision.md",
    ],
    qualityGates: [
      "The decision lists verified commands, skipped checks, open risks, and release verdict.",
      "Known blockers stay visible instead of being hidden behind an LGTM.",
    ],
    source: "builtin",
    ...workflowVersionMetadata(),
  }),
  defineWorkflow({
    workflowId: BUILTIN_WORKFLOW_IDS.RESEARCH_SPIKE,
    name: "Research Spike",
    stages: ["plan", "execute", "decide"],
    description:
      "Explore an uncertain integration, API, library, or architecture question and record a bounded recommendation.",
    whenToUse: [
      "The next implementation step depends on external docs, tool behavior, or a technical choice.",
      "The desired output is evidence and a decision, not a production patch.",
    ],
    packetArtifacts: ["request.md", "plan.md", "handoff.md", "decision.md"],
    qualityGates: [
      "The plan defines the question, evidence sources, timebox, and non-goals.",
      "The decision separates facts, assumptions, recommendation, and follow-up work.",
    ],
    source: "builtin",
    ...workflowVersionMetadata(),
  }),
];

export function workflowSearchDirs(
  _cwd = process.cwd(),
  _configPath?: string,
): WorkflowRegistryDirectory[] {
  const dirs: WorkflowRegistryDirectory[] = [{ source: "user", path: path.join(os.homedir(), USER_WORKFLOW_DIR) }];
  return dedupeWorkflowDirs(dirs);
}

export function workflowRegistryDirForWrite(
  _cwd = process.cwd(),
  _configPath?: string,
): string {
  return workflowRegistryDirsForWrite().at(-1)?.path
    ?? path.join(os.homedir(), USER_WORKFLOW_DIR);
}

export function workflowRegistryDirsForWrite(): WorkflowRegistryDirectory[] {
  return [{ source: "user", path: path.join(os.homedir(), USER_WORKFLOW_DIR) }];
}

export function findRegistryWorkflow(
  workflowId: string,
  _cwd = process.cwd(),
  _configPath?: string,
): Workflow | undefined {
  const workflows = loadRegistryWorkflows(
    workflowRegistryDirsForWrite(),
  ).filter((workflow) => workflow.workflowId === workflowId);
  if (workflows.length > 1) {
    throw new Error(`multiple user workflows found with id: ${workflowId}`);
  }
  return workflows[0];
}

export function generateWorkflowRegistrationId(
  existingWorkflowIds: Iterable<string>,
  generator: WorkflowIdGenerator = defaultWorkflowIdGenerator,
): string {
  const existing = new Set(existingWorkflowIds);
  for (let attempt = 0; attempt < MAX_WORKFLOW_ID_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generator();
    if (!GENERATED_WORKFLOW_ID_PATTERN.test(candidate)) {
      throw new Error(`generated workflow id must match w-xxxxxxxx: ${candidate}`);
    }
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`could not generate a unique workflow id after ${MAX_WORKFLOW_ID_GENERATION_ATTEMPTS} attempts`);
}

export function listWorkflows(workflowDirs = workflowSearchDirs()): Workflow[] {
  const seenIds = new Set(BUILTIN_WORKFLOWS.map((workflow) => workflow.workflowId));
  const workflows = [...BUILTIN_WORKFLOWS];
  for (const workflow of loadRegistryWorkflows(workflowDirs)) {
    if (seenIds.has(workflow.workflowId)) {
      throw new Error(`duplicate workflow id '${workflow.workflowId}' in ${workflow.path}`);
    }
    workflows.push(workflow);
    seenIds.add(workflow.workflowId);
  }
  return workflows.sort(compareWorkflows);
}

export function getWorkflow(
  workflowId: string,
  workflowDirs = workflowSearchDirs(),
): Workflow {
  const workflows = listWorkflows(workflowDirs);
  const workflow = workflows.find((item) => item.workflowId === workflowId);
  if (!workflow) {
    const known = workflows.map((item) => item.workflowId).join(", ");
    throw new Error(`unknown workflow: ${workflowId}; known workflows: ${known}`);
  }
  return workflow;
}

export function loadWorkflowFile(
  workflowPath: string,
  cwd = process.cwd(),
  options: { workflowId?: string } = {},
): Workflow {
  const resolvedPath = path.isAbsolute(workflowPath)
    ? path.resolve(workflowPath)
    : path.resolve(cwd, workflowPath);
  return loadWorkflowToml(resolvedPath, "temporary", options.workflowId);
}

export function formatWorkflow(workflow: Workflow): string {
  const requiredFlags = workflow.stages.map((stage) => `--${stage}`).join(", ");
  const lines = [
    `# ${workflow.name}`,
    "",
    `ID: ${workflow.workflowId}`,
    `Source: ${workflow.source}`,
    `Stages: ${workflow.stages.join(", ")}`,
    `Required role flags: ${requiredFlags}`,
    "",
    "Agent requirements:",
    "",
    "- Any registered AgentMesh agent with the required stage capability.",
    "- Workflows do not require Codex; Claude/Antigravity/OpenCode-only teams can use the same workflow.",
    "",
    "Description:",
    workflow.description,
    "",
  ];
  if (workflow.path) {
    lines.push("Workflow file:", workflow.path, "");
  }
  if (workflow.recipeSource) {
    lines.push("Recipe source:", workflow.recipeSource, "");
  }
  lines.push(
    "Version metadata:",
    "",
    `- schema_version: ${workflow.schemaVersion}`,
    `- workflow_recipe_version: ${workflow.workflowRecipeVersion}`,
    `- compatible_packet_schema_versions: ${workflow.compatiblePacketSchemaVersions.join(", ")}`,
    "",
  );
  lines.push(...formatBullets("When to use", workflow.whenToUse));
  lines.push(...formatBullets("Packet artifacts", workflow.packetArtifacts));
  lines.push(...formatBullets("Quality gates", workflow.qualityGates));
  return `${lines.join("\n").trimEnd()}\n`;
}

function loadRegistryWorkflows(workflowDirs: WorkflowRegistryDirectory[]): Workflow[] {
  return workflowDirs.flatMap((directory) =>
    iterWorkflowFiles(directory.path).map((workflowPath) =>
      loadWorkflowToml(workflowPath, directory.source),
    ),
  );
}

function iterWorkflowFiles(directory: string): string[] {
  if (!isDirectory(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".toml"))
    .sort()
    .map((entry) => path.join(directory, entry));
}

function loadWorkflowToml(
  workflowPath: string,
  source: Exclude<WorkflowSource, "builtin">,
  workflowIdOverride?: string,
): Workflow {
  const payload = parseTomlRoot(
    readFileSync(workflowPath, { encoding: "utf-8" }),
    workflowPath,
  );
  const schemaVersion = supportedVersion(payload, "schema_version", CURRENT_SCHEMA_VERSION, workflowPath);
  const workflowRecipeVersion = supportedVersion(
    payload,
    "workflow_recipe_version",
    WORKFLOW_RECIPE_SCHEMA_VERSION,
    workflowPath,
  );
  const compatiblePacketSchemaVersions = compatiblePacketSchemas(payload, workflowPath);
  const workflowId = validateWorkflowId(
    workflowIdOverride ?? workflowIdFromPath(workflowPath),
    workflowPath,
    source,
  );
  const stages = workflowStages(payload, workflowPath);
  const stageNodes = deriveStageNodes(stages);
  const packetArtifacts = nonEmptyStringList(payload, "packet_artifacts", workflowPath);
  validatePacketArtifactCoverage(packetArtifacts, stages, workflowPath);
  const failurePolicy = failurePolicyConfig(payload, stageNodes, workflowPath);
  return defineWorkflow({
    workflowId,
    name: optionalString(payload, "name") ?? titleFromId(workflowId),
    schemaVersion,
    workflowRecipeVersion,
    compatiblePacketSchemaVersions,
    stages,
    description: requireString(payload, "description", workflowPath),
    whenToUse: nonEmptyStringList(payload, "when_to_use", workflowPath),
    packetArtifacts,
    qualityGates: nonEmptyStringList(payload, "quality_gates", workflowPath),
    failurePolicy,
    source,
    recipeSource: optionalString(payload, "recipe_source"),
    path: workflowPath,
  });
}

function defineWorkflow(
  workflow: Omit<Workflow, "stageNodes" | "failurePolicy"> & {
    failurePolicy?: WorkflowFailurePolicyConfig;
  },
): Workflow {
  const { failurePolicy = emptyFailurePolicy(), ...rest } = workflow;
  return {
    ...rest,
    failurePolicy,
    stageNodes: deriveStageNodes(rest.stages),
  };
}

function emptyFailurePolicy(): WorkflowFailurePolicyConfig {
  return { stage_types: {}, nodes: {} };
}

function workflowVersionMetadata(): Pick<
  Workflow,
  "schemaVersion" | "workflowRecipeVersion" | "compatiblePacketSchemaVersions"
> {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    workflowRecipeVersion: WORKFLOW_RECIPE_SCHEMA_VERSION,
    compatiblePacketSchemaVersions: [CURRENT_PACKET_SCHEMA_VERSION],
  };
}

function supportedVersion<Expected extends number>(
  payload: Record<string, unknown>,
  key: string,
  expected: Expected,
  workflowPath: string,
): Expected {
  if (payload[key] !== expected) {
    throw new Error(`workflow ${workflowPath}: ${key} must be ${expected}`);
  }
  return expected;
}

function compatiblePacketSchemas(
  payload: Record<string, unknown>,
  workflowPath: string,
): (typeof CURRENT_PACKET_SCHEMA_VERSION)[] {
  const versions = integerList(payload, "compatible_packet_schema_versions", workflowPath);
  if (versions.length !== 1 || versions[0] !== CURRENT_PACKET_SCHEMA_VERSION) {
    throw new Error(
      `workflow ${workflowPath}: compatible_packet_schema_versions must equal [${CURRENT_PACKET_SCHEMA_VERSION}]`,
    );
  }
  return [CURRENT_PACKET_SCHEMA_VERSION];
}

function parseTomlRoot(content: string, label: string): Record<string, unknown> {
  const payload = parseTomlDocument(content, label, "invalid workflow TOML");
  for (const [key, value] of Object.entries(payload)) {
    if (!WORKFLOW_TOP_LEVEL_FIELDS.has(key)) {
      throw new Error(`invalid workflow TOML ${label}: unknown top-level field: ${key}`);
    }
    if (isRecord(value) && key !== "failure_policy") {
      throw new Error(`invalid workflow TOML ${label}: sections are not supported: ${key}`);
    }
  }
  return payload;
}

function validateWorkflowId(
  workflowId: string,
  workflowPath: string,
  _source: Exclude<WorkflowSource, "builtin">,
): string {
  if (!LEGACY_TEMPORARY_WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new Error(
      `workflow ${workflowPath}: id must start with a letter and contain only letters, numbers, underscore, or dash`,
    );
  }
  return workflowId;
}

function workflowIdFromPath(workflowPath: string): string {
  return path.basename(workflowPath, ".toml");
}

function defaultWorkflowIdGenerator(): string {
  return `w-${randomBytes(4).toString("hex")}`;
}

function workflowStages(
  payload: Record<string, unknown>,
  workflowPath: string,
): string[] {
  if (!Object.hasOwn(payload, "stages")) {
    throw new Error(`workflow ${workflowPath}: stages must be present and be a list of strings`);
  }
  const stages = stringList(payload, "stages", workflowPath);
  try {
    deriveStageNodes(stages);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`workflow ${workflowPath}: ${message}`);
  }
  return stages;
}

function validatePacketArtifactCoverage(
  packetArtifacts: string[],
  stages: string[],
  workflowPath: string,
): void {
  const artifacts = new Set(packetArtifacts);
  const requiredStageTypes = new Set(stages as StageType[]);
  for (const stageType of requiredStageTypes) {
    const artifact = CANONICAL_STAGE_ARTIFACT[stageType];
    if (!artifacts.has(artifact)) {
      throw new Error(
        `workflow ${workflowPath}: packet_artifacts missing canonical artifact ${artifact} for ${stageType}`,
      );
    }
  }
}

function failurePolicyConfig(
  payload: Record<string, unknown>,
  stageNodes: StageNode[],
  workflowPath: string,
): WorkflowFailurePolicyConfig {
  const policy = payload.failure_policy;
  if (policy === undefined) {
    return emptyFailurePolicy();
  }
  if (!isRecord(policy)) {
    throw new Error(`workflow ${workflowPath}: failure_policy must be a table`);
  }
  for (const key of Object.keys(policy)) {
    if (!FAILURE_POLICY_FIELDS.has(key)) {
      throw new Error(
        `workflow ${workflowPath}: unknown failure_policy field '${key}'; expected stage_types or nodes`,
      );
    }
  }
  return {
    stage_types: failurePolicyStageTypes(policy.stage_types, workflowPath),
    nodes: failurePolicyNodes(policy.nodes, stageNodes, workflowPath),
  };
}

function failurePolicyStageTypes(
  value: unknown,
  workflowPath: string,
): Partial<Record<StageType, StageFailurePolicy>> {
  if (value === undefined) {
    return {};
  }
  const policies = policyTable(value, `workflow ${workflowPath}: failure_policy.stage_types`);
  const output: Partial<Record<StageType, StageFailurePolicy>> = {};
  for (const [stageType, policy] of Object.entries(policies)) {
    if (!STAGE_TYPES.includes(stageType as StageType)) {
      throw new Error(
        `workflow ${workflowPath}: unknown failure_policy stage type '${stageType}'; valid stage types: ${STAGE_TYPES.join(", ")}`,
      );
    }
    output[stageType as StageType] = failurePolicyObject(
      policy,
      `workflow ${workflowPath}: failure_policy.stage_types.${stageType}`,
    );
  }
  return output;
}

function failurePolicyNodes(
  value: unknown,
  stageNodes: StageNode[],
  workflowPath: string,
): Record<string, StageFailurePolicy> {
  if (value === undefined) {
    return {};
  }
  const validNodeIds = stageNodes.map((node) => node.id);
  const validNodeIdSet = new Set(validNodeIds);
  const policies = policyTable(value, `workflow ${workflowPath}: failure_policy.nodes`);
  const output: Record<string, StageFailurePolicy> = {};
  for (const [nodeId, policy] of Object.entries(policies)) {
    if (!validNodeIdSet.has(nodeId)) {
      throw new Error(
        `workflow ${workflowPath}: unknown failure_policy node id '${nodeId}'; valid node ids: ${validNodeIds.join(", ")}`,
      );
    }
    output[nodeId] = failurePolicyObject(policy, `workflow ${workflowPath}: failure_policy.nodes.${nodeId}`);
  }
  return output;
}

function policyTable(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table`);
  }
  return value;
}

function failurePolicyObject(value: unknown, label: string): StageFailurePolicy {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a table`);
  }
  for (const key of Object.keys(value)) {
    if (!FAILURE_POLICY_OBJECT_FIELDS.has(key)) {
      const fieldLabel = label.replace(/^workflow [^:]+: /, "");
      throw new Error(`${label}: unknown ${fieldLabel} field: ${key}`);
    }
  }
  const parsed = StageFailurePolicySchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? `.${issue.path.join(".")}` : "";
    const message = issue?.message ?? "invalid failure policy";
    throw new Error(`${label}${path} ${message}`);
  }
  return parsed.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function requireString(
  payload: Record<string, unknown>,
  key: string,
  workflowPath: string,
): string {
  const value = optionalString(payload, key);
  if (!value) {
    throw new Error(`workflow ${workflowPath}: ${key} must be a non-empty string`);
  }
  return value;
}

function stringList(
  payload: Record<string, unknown>,
  key: string,
  workflowPath: string,
): string[] {
  const value = payload[key] ?? [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.trim().length === 0)
  ) {
    throw new Error(`workflow ${workflowPath}: ${key} must be a list of strings`);
  }
  return value.map((item) => item.trim());
}

function nonEmptyStringList(
  payload: Record<string, unknown>,
  key: string,
  workflowPath: string,
): string[] {
  const values = stringList(payload, key, workflowPath);
  if (values.length === 0) {
    throw new Error(`workflow ${workflowPath}: ${key} must be a non-empty list of strings`);
  }
  return values;
}

function integerList(
  payload: Record<string, unknown>,
  key: string,
  workflowPath: string,
): number[] {
  const value = payload[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => !Number.isInteger(item))
  ) {
    throw new Error(`workflow ${workflowPath}: ${key} must be a non-empty list of integers`);
  }
  return value as number[];
}

function titleFromId(workflowId: string): string {
  return workflowId.replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, (char) =>
    char.toUpperCase(),
  );
}

function compareWorkflows(left: Workflow, right: Workflow): number {
  const sourceOrder: Record<WorkflowSource, number> = {
    builtin: 0,
    user: 1,
    temporary: 2,
  };
  return (
    sourceOrder[left.source] - sourceOrder[right.source] ||
    left.workflowId.localeCompare(right.workflowId)
  );
}

function formatBullets(heading: string, values: string[]): string[] {
  return [heading, "", ...values.map((value) => `- ${value}`), ""];
}

function isDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function dedupeWorkflowDirs(dirs: WorkflowRegistryDirectory[]): WorkflowRegistryDirectory[] {
  const seen = new Set<string>();
  const deduped: WorkflowRegistryDirectory[] = [];
  for (const directory of dirs) {
    const resolved = path.resolve(directory.path);
    if (!seen.has(resolved)) {
      seen.add(resolved);
      deduped.push({ ...directory, path: resolved });
    }
  }
  return deduped;
}
