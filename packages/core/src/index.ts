import { z } from "zod";

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_SCHEMA_VERSIONS = [CURRENT_SCHEMA_VERSION] as const;
export const CURRENT_PACKET_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
export const SUPPORTED_PACKET_SCHEMA_VERSIONS = [CURRENT_PACKET_SCHEMA_VERSION] as const;
export const WORKFLOW_RECIPE_SCHEMA_VERSION = 1 as const;
export const BUILTIN_WORKFLOW_IDS = {
  BUG_FIX: "w-7db15660",
  IMPLEMENTATION_PLAN: "w-4963ede2",
  REVIEW_GATE: "w-9d94d0db",
  GUIDED_DELIVERY: "w-f43236a0",
  VERIFIED_DELIVERY: "w-1ab330ed",
  HANDOFF: "w-a31711c6",
  RELEASE_CHECK: "w-67ef1b1f",
  RESEARCH_SPIKE: "w-218be11e",
} as const;
export type BuiltinWorkflowId =
  (typeof BUILTIN_WORKFLOW_IDS)[keyof typeof BUILTIN_WORKFLOW_IDS];

export function assertSupportedSchemaVersion(
  version: unknown,
  label: string,
): (typeof SUPPORTED_SCHEMA_VERSIONS)[number] {
  if (!Number.isInteger(version)) {
    throw new Error(`${label}.schema_version must be an integer`);
  }
  if (typeof version !== "number") {
    throw new Error(`${label}.schema_version must be an integer`);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `${label}.schema_version ${version} is newer than supported version ${CURRENT_SCHEMA_VERSION}`,
    );
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(version as never)) {
    throw new Error(`${label}.schema_version ${version} is not supported`);
  }
  return version as (typeof SUPPORTED_SCHEMA_VERSIONS)[number];
}

export function assertSupportedPacketSchemaVersion(
  version: unknown,
  label: string,
): (typeof SUPPORTED_PACKET_SCHEMA_VERSIONS)[number] {
  if (!Number.isInteger(version) || typeof version !== "number") {
    throw new Error(`${label}.schema_version must be an integer`);
  }
  if (!SUPPORTED_PACKET_SCHEMA_VERSIONS.includes(version as never)) {
    throw new Error(`unsupported packet schema version: ${version}`);
  }
  return version as (typeof SUPPORTED_PACKET_SCHEMA_VERSIONS)[number];
}

export const SchemaVersionSchema = z.literal(CURRENT_SCHEMA_VERSION);
export const PacketSchemaVersionSchema = z.literal(CURRENT_PACKET_SCHEMA_VERSION);

const NonEmptyStringSchema = z.string().min(1);

export const STAGE_TYPES = ["plan", "execute", "verify", "review", "decide"] as const;
export const StageTypeSchema = z.enum(STAGE_TYPES);
export type StageType = z.infer<typeof StageTypeSchema>;

export const MAX_WORKFLOW_STAGE_NODES = 15;
export const MAX_FANOUT_AGENTS = 6;
export const MAX_FALLBACK_AGENTS = 3;
export const MAX_FALLBACK_ATTEMPTS_PER_AGENT = 2;
export const DEFAULT_INVOCATION_TIMEOUT_SECONDS = 900;
export const MIN_INVOCATION_TIMEOUT_SECONDS = 30;
export const MAX_INVOCATION_TIMEOUT_SECONDS = 3600;

export const StageNodeSchema = z
  .object({
    id: NonEmptyStringSchema,
    type: StageTypeSchema,
    occurrence: z.number().int().positive(),
  })
  .superRefine((node, ctx) => {
    const expectedId =
      node.occurrence === 1 ? node.type : `${node.type}_${node.occurrence}`;
    if (node.id !== expectedId) {
      ctx.addIssue({
        code: "custom",
        message: `stage node id must be ${expectedId} for ${node.type} occurrence ${node.occurrence}`,
        path: ["id"],
      });
    }
  });
export type StageNode = z.infer<typeof StageNodeSchema>;

export function deriveStageNodes(stages: readonly string[]): StageNode[] {
  if (stages.length < 1) {
    throw new Error("workflow must contain at least 1 stage node");
  }
  if (stages.length > MAX_WORKFLOW_STAGE_NODES) {
    throw new Error(`workflow must contain at most ${MAX_WORKFLOW_STAGE_NODES} stage nodes`);
  }

  const counts = new Map<StageType, number>();
  return stages.map((stage, index) => {
    if (/_\d+$/.test(stage)) {
      throw new Error(`stage type '${stage}' must not include an occurrence suffix`);
    }
    const parsed = StageTypeSchema.safeParse(stage);
    if (!parsed.success) {
      const allowed = STAGE_TYPES.join(", ");
      throw new Error(`unsupported stage type '${stage}'; allowed: ${allowed}`);
    }
    const type = parsed.data;
    if (type === "decide") {
      if (index === 0) {
        throw new Error("decide must not be the first stage node");
      }
      if (stages[index - 1] === "decide") {
        throw new Error("decide must not immediately follow decide");
      }
    }
    const occurrence = (counts.get(type) ?? 0) + 1;
    counts.set(type, occurrence);
    return {
      id: occurrence === 1 ? type : `${type}_${occurrence}`,
      type,
      occurrence,
    };
  });
}

export function stageNodesForStatus(status: {
  stages: readonly string[];
  stage_nodes?: readonly StageNode[];
}): StageNode[] {
  if (status.stage_nodes) {
    return status.stage_nodes.map((node) => StageNodeSchema.parse(node));
  }
  return deriveStageNodes(status.stages);
}

export const STAGE_STATES = [
  "planned",
  "running",
  "completed",
  "failed",
  "skipped",
  "needs_decision",
  "handoff_ready",
] as const;

export const StageStateSchema = z.enum(STAGE_STATES);
export type StageState = z.infer<typeof StageStateSchema>;

export const ReleaseVerdictSchema = z.enum([
  "ready",
  "not_ready",
  "needs_decision",
]);
export type ReleaseVerdict = z.infer<typeof ReleaseVerdictSchema>;

export const ReleaseVerdictRecordSchema = z
  .object({
    value: ReleaseVerdictSchema.nullable().optional(),
    diagnostic: z.string().nullable().optional(),
  })
  .passthrough();
export type ReleaseVerdictRecord = z.infer<typeof ReleaseVerdictRecordSchema>;

export const ReleaseGateResultSchema = z
  .object({
    schema_version: SchemaVersionSchema,
    verdict: ReleaseVerdictSchema,
    decision_file: NonEmptyStringSchema.optional(),
    release_summary_file: NonEmptyStringSchema.optional(),
    diagnostic: z.string().nullable().optional(),
  })
  .passthrough();
export type ReleaseGateResult = z.infer<typeof ReleaseGateResultSchema>;

const NonNegativeIntegerSchema = z.number().int().nonnegative();
const InvocationTimeoutSecondsSchema = z
  .number()
  .int()
  .min(MIN_INVOCATION_TIMEOUT_SECONDS)
  .max(MAX_INVOCATION_TIMEOUT_SECONDS);

export const RuntimeTimingSchema = z
  .object({
    config_load_ms: NonNegativeIntegerSchema.optional(),
    mcp_connect_ms: NonNegativeIntegerSchema.optional(),
    mcp_cache_hits: NonNegativeIntegerSchema.optional(),
    mcp_cache_misses: NonNegativeIntegerSchema.optional(),
    adapter_spawn_ms: NonNegativeIntegerSchema.optional(),
    first_output_ms: NonNegativeIntegerSchema.optional(),
    agent_total_ms: NonNegativeIntegerSchema.optional(),
    total_ms: NonNegativeIntegerSchema.optional(),
  })
  .passthrough();
export type RuntimeTiming = z.infer<typeof RuntimeTimingSchema>;

export const PromptByteMetricSchema = z
  .object({
    path: NonEmptyStringSchema,
    bytes: NonNegativeIntegerSchema,
    stage: NonEmptyStringSchema,
    agent: NonEmptyStringSchema.optional(),
    kind: z.enum(["stage", "synthesis"]).optional(),
  })
  .passthrough();
export type PromptByteMetric = z.infer<typeof PromptByteMetricSchema>;

export const InvocationTimingSchema = z
  .object({
    started_at: NonEmptyStringSchema.optional(),
    completed_at: NonEmptyStringSchema.optional(),
    failed_at: NonEmptyStringSchema.optional(),
    duration_ms: NonNegativeIntegerSchema.optional(),
    attempt_count: NonNegativeIntegerSchema,
    exit_code: z.number().int().nullable().optional(),
    config_load_ms: NonNegativeIntegerSchema.optional(),
    mcp_connect_ms: NonNegativeIntegerSchema.optional(),
    adapter_spawn_ms: NonNegativeIntegerSchema.optional(),
    first_output_ms: NonNegativeIntegerSchema.optional(),
    agent_total_ms: NonNegativeIntegerSchema.optional(),
    total_ms: NonNegativeIntegerSchema.optional(),
  })
  .passthrough();
export type InvocationTiming = z.infer<typeof InvocationTimingSchema>;

export const StageInvocationSchema = z
  .object({
    lane_id: NonEmptyStringSchema,
    kind: z.enum(["primary", "synthesis", "current"]),
    agent: NonEmptyStringSchema,
    timeout_seconds: InvocationTimeoutSecondsSchema.nullable(),
  })
  .passthrough();
export type StageInvocation = z.infer<typeof StageInvocationSchema>;

export const StageFailurePolicySchema = z
  .object({
    mode: z.enum(["allow", "required", "terminal"]),
    max_fallback_agents: z.number().int().min(1).max(MAX_FALLBACK_AGENTS).optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.mode === "terminal" && policy.max_fallback_agents !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "terminal failure policy must not set max_fallback_agents",
        path: ["max_fallback_agents"],
      });
    }
  });
export type StageFailurePolicy = z.infer<typeof StageFailurePolicySchema>;

export const StageFallbackCandidateSchema = z
  .object({
    agent: NonEmptyStringSchema,
    timeout_seconds: InvocationTimeoutSecondsSchema,
  })
  .passthrough();
export type StageFallbackCandidate = z.infer<typeof StageFallbackCandidateSchema>;

export const StageFallbackSchema = z
  .object({
    agents: z.array(StageFallbackCandidateSchema),
    max_attempts_per_agent: z.number().int().min(1).max(MAX_FALLBACK_ATTEMPTS_PER_AGENT).optional(),
  })
  .passthrough();
export type StageFallback = z.infer<typeof StageFallbackSchema>;

export const StageAttemptSchema = z
  .object({
    lane_id: NonEmptyStringSchema,
    primary_agent: NonEmptyStringSchema,
    requested_agent: NonEmptyStringSchema,
    actual_agent: NonEmptyStringSchema,
    fallback_from: NonEmptyStringSchema.optional(),
    lane_attempt: z.number().int().positive(),
    attempt: z.number().int().positive(),
    timeout_seconds: InvocationTimeoutSecondsSchema.nullable(),
    status: z.enum(["completed", "failed", "timed_out"]),
    started_at: NonEmptyStringSchema.optional(),
    completed_at: NonEmptyStringSchema.optional(),
    error: z.string().optional(),
    error_kind: z.string().optional(),
  })
  .passthrough();
export type StageAttempt = z.infer<typeof StageAttemptSchema>;

export const PacketStatusSchema = z
  .object({
    schema_version: PacketSchemaVersionSchema,
    run_id: NonEmptyStringSchema,
    created_at: NonEmptyStringSchema,
    updated_at: NonEmptyStringSchema,
    status: NonEmptyStringSchema,
    stage_assignments: z.record(z.string(), z.array(NonEmptyStringSchema)),
    stage_invocations: z.record(z.string(), z.array(StageInvocationSchema)),
    stage_failure_policies: z.record(z.string(), StageFailurePolicySchema),
    stage_fallbacks: z.record(z.string(), StageFallbackSchema),
    stage_attempts: z.record(z.string(), z.array(StageAttemptSchema)),
    assignment_provenance: z.record(z.string(), z.unknown()),
    fallback_provenance: z.record(z.string(), z.unknown()),
    timeout_provenance: z.record(z.string(), z.unknown()),
    stages: z.array(NonEmptyStringSchema),
    stage_nodes: z.array(StageNodeSchema),
    completed_stages: z.array(NonEmptyStringSchema),
    failed_stage: NonEmptyStringSchema.optional(),
    stage_state: z.record(z.string(), StageStateSchema).optional(),
    stage_timing: z.record(z.string(), InvocationTimingSchema),
    agent_timing: z.record(z.string(), z.record(z.string(), InvocationTimingSchema)),
    runtime_timing: RuntimeTimingSchema.optional(),
    context_bytes: NonNegativeIntegerSchema.optional(),
    prompt_bytes: z.record(z.string(), PromptByteMetricSchema).optional(),
    user_gate: z.boolean(),
    release_verdict: ReleaseVerdictRecordSchema.optional(),
  })
  .passthrough()
  .superRefine((status, ctx) => {
    validateStageNodeSequence(status.stages, status.stage_nodes, ctx);
    const validStageIds = new Set(status.stage_nodes.map((node) => node.id));
    for (const completedStage of status.completed_stages) {
      if (!validStageIds.has(completedStage)) {
        ctx.addIssue({
          code: "custom",
          message: `completed_stages contains unknown stage: ${completedStage}`,
          path: ["completed_stages"],
        });
      }
    }
    if (status.failed_stage && !validStageIds.has(status.failed_stage)) {
      ctx.addIssue({
        code: "custom",
        message: `failed_stage contains unknown stage: ${status.failed_stage}`,
        path: ["failed_stage"],
      });
    }
    for (const stageId of Object.keys(status.stage_state ?? {})) {
      if (!validStageIds.has(stageId)) {
        ctx.addIssue({
          code: "custom",
          message: `stage_state contains unknown stage: ${stageId}`,
          path: ["stage_state", stageId],
        });
      }
    }
    validateExactStageRecordKeys("stage_assignments", status.stage_assignments, validStageIds, ctx);
    validateExactStageRecordKeys("stage_invocations", status.stage_invocations, validStageIds, ctx);
    validateExactStageRecordKeys(
      "stage_failure_policies",
      status.stage_failure_policies,
      validStageIds,
      ctx,
    );
    validateExactStageRecordKeys("stage_fallbacks", status.stage_fallbacks, validStageIds, ctx);
    validateExactStageRecordKeys("stage_attempts", status.stage_attempts, validStageIds, ctx);
    validateExactStageRecordKeys(
      "assignment_provenance",
      status.assignment_provenance,
      validStageIds,
      ctx,
    );
    validateExactStageRecordKeys(
      "fallback_provenance",
      status.fallback_provenance,
      validStageIds,
      ctx,
    );
    validateExactStageRecordKeys(
      "timeout_provenance",
      status.timeout_provenance,
      validStageIds,
      ctx,
    );
    validateExactStageTimingKeys(status.stage_timing, validStageIds, ctx);
    for (const stageId of Object.keys(status.agent_timing)) {
      if (!validStageIds.has(stageId)) {
        ctx.addIssue({
          code: "custom",
          message: `agent_timing contains unknown stage: ${stageId}`,
          path: ["agent_timing", stageId],
        });
      }
    }
  });
export type PacketStatus = z.infer<typeof PacketStatusSchema>;

function validateExactStageRecordKeys(
  label: string,
  record: Record<string, unknown>,
  validStageIds: Set<string>,
  ctx: z.RefinementCtx,
): void {
  for (const stageId of validStageIds) {
    if (!(stageId in record)) {
      ctx.addIssue({
        code: "custom",
        message: `${label} missing stage: ${stageId}`,
        path: [label, stageId],
      });
    }
  }
  for (const stageId of Object.keys(record)) {
    if (!validStageIds.has(stageId)) {
      ctx.addIssue({
        code: "custom",
        message: `${label} contains unknown stage: ${stageId}`,
        path: [label, stageId],
      });
    }
  }
}

function validateExactStageTimingKeys(
  stageTiming: Record<string, unknown>,
  validStageIds: Set<string>,
  ctx: z.RefinementCtx,
): void {
  for (const stageId of validStageIds) {
    if (!(stageId in stageTiming)) {
      ctx.addIssue({
        code: "custom",
        message: `stage_timing missing stage: ${stageId}`,
        path: ["stage_timing", stageId],
      });
    }
  }
  for (const stageId of Object.keys(stageTiming)) {
    if (!validStageIds.has(stageId)) {
      ctx.addIssue({
        code: "custom",
        message: `stage_timing contains unknown stage: ${stageId}`,
        path: ["stage_timing", stageId],
      });
    }
  }
}

function validateStageNodeSequence(
  stages: readonly string[],
  stageNodes: readonly StageNode[],
  ctx: z.RefinementCtx,
): void {
  let expectedNodes: StageNode[];
  try {
    expectedNodes = deriveStageNodes(stages);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
      path: ["stages"],
    });
    return;
  }
  const seenIds = new Set<string>();
  for (const node of stageNodes) {
    if (seenIds.has(node.id)) {
      ctx.addIssue({
        code: "custom",
        message: `stage_nodes contains duplicate id: ${node.id}`,
        path: ["stage_nodes"],
      });
    }
    seenIds.add(node.id);
  }
  if (!stageNodeListsEqual(stageNodes, expectedNodes)) {
    ctx.addIssue({
      code: "custom",
      message: "stage_nodes must match the deterministic nodes derived from stages",
      path: ["stage_nodes"],
    });
  }
}

function stageNodeListsEqual(
  left: readonly StageNode[],
  right: readonly StageNode[],
): boolean {
  return left.length === right.length && left.every((node, index) => {
    const expected = right[index];
    return (
      expected !== undefined
      && node.id === expected.id
      && node.type === expected.type
      && node.occurrence === expected.occurrence
    );
  });
}

export const PacketEventSchema = z
  .object({
    schema_version: SchemaVersionSchema,
    timestamp: NonEmptyStringSchema,
    event: NonEmptyStringSchema,
  })
  .passthrough();
export type PacketEvent = z.infer<typeof PacketEventSchema>;

export const PacketArtifactSchema = z
  .object({
    path: NonEmptyStringSchema,
    kind: NonEmptyStringSchema,
    stage: NonEmptyStringSchema,
    agent: NonEmptyStringSchema.optional(),
  })
  .passthrough();
export type PacketArtifact = z.infer<typeof PacketArtifactSchema>;

export const PacketArtifactManifestSchema = z
  .object({
    schema_version: SchemaVersionSchema,
    artifacts: z.record(z.string(), PacketArtifactSchema),
  })
  .passthrough();
export type PacketArtifactManifest = z.infer<typeof PacketArtifactManifestSchema>;

export const CONTEXT_SOURCE_TYPES = [
  "file",
  "diff_file",
  "verification_file",
  "scoped_git_diff",
  "mcp_resource",
  "project_spec",
  "project_correction",
] as const;
export const ContextSourceTypeSchema = z.enum(CONTEXT_SOURCE_TYPES);
export type ContextSourceType = z.infer<typeof ContextSourceTypeSchema>;

export const ContextFreshnessSchema = z.enum(["fresh", "stale", "unknown"]);
export type ContextFreshness = z.infer<typeof ContextFreshnessSchema>;

export const ContextValidationStateSchema = z.enum(["ok", "failed", "skipped"]);
export type ContextValidationState = z.infer<typeof ContextValidationStateSchema>;

export const ContextRedactionStateSchema = z.enum(["none", "redacted", "unknown"]);
export type ContextRedactionState = z.infer<typeof ContextRedactionStateSchema>;

export const McpFailureClassificationSchema = z.enum([
  "server_start_failed",
  "initialize_failed",
  "resource_not_found",
  "non_text_resource",
  "resource_too_large",
  "timeout",
  "invalid_json_rpc",
  "unknown",
]);
export type McpFailureClassification = z.infer<
  typeof McpFailureClassificationSchema
>;

export const ContextProvenanceSchema = z
  .object({
    schema_version: SchemaVersionSchema,
    source_type: ContextSourceTypeSchema,
    source: NonEmptyStringSchema,
    source_path: z.string().optional(),
    source_uri: z.string().optional(),
    source_command: z.string().optional(),
    capture_timestamp: NonEmptyStringSchema,
    freshness: ContextFreshnessSchema,
    owner: NonEmptyStringSchema,
    validation_state: ContextValidationStateSchema,
    ingestion_error: z.string().nullable().optional(),
    redaction_state: ContextRedactionStateSchema,
  })
  .passthrough();
export type ContextProvenance = z.infer<typeof ContextProvenanceSchema>;

export const ProjectSpecIdentitySchema = z
  .object({
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema.optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type ProjectSpecIdentity = z.infer<typeof ProjectSpecIdentitySchema>;

export const ProjectSpecCommandSchema = z
  .object({
    id: NonEmptyStringSchema,
    command: NonEmptyStringSchema,
    description: z.string().optional(),
    cwd: z.string().optional(),
  })
  .passthrough();
export type ProjectSpecCommand = z.infer<typeof ProjectSpecCommandSchema>;

export const ProjectSpecConstraintSchema = z
  .object({
    id: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    scope: z.string().optional(),
    owner: NonEmptyStringSchema.optional(),
  })
  .passthrough();
export type ProjectSpecConstraint = z.infer<typeof ProjectSpecConstraintSchema>;

export const ProjectSpecRiskStatusSchema = z.enum([
  "active",
  "accepted",
  "mitigated",
]);
export type ProjectSpecRiskStatus = z.infer<typeof ProjectSpecRiskStatusSchema>;

export const ProjectSpecRiskSchema = z
  .object({
    id: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    status: ProjectSpecRiskStatusSchema,
    mitigation: z.string().optional(),
    owner: NonEmptyStringSchema.optional(),
  })
  .passthrough();
export type ProjectSpecRisk = z.infer<typeof ProjectSpecRiskSchema>;

export const ProjectSpecFreshnessSchema = z
  .object({
    updated_at: NonEmptyStringSchema,
    freshness: ContextFreshnessSchema,
    max_age_days: z.number().int().positive().optional(),
  })
  .passthrough();
export type ProjectSpecFreshness = z.infer<typeof ProjectSpecFreshnessSchema>;

export const ProjectSpecOwnerSchema = z
  .object({
    owner: NonEmptyStringSchema,
    contact: z.string().optional(),
  })
  .passthrough();
export type ProjectSpecOwner = z.infer<typeof ProjectSpecOwnerSchema>;

export const ProjectSpecValidationSchema = z
  .object({
    validation_state: ContextValidationStateSchema,
    checked_at: z.string().optional(),
    command: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type ProjectSpecValidation = z.infer<typeof ProjectSpecValidationSchema>;

export const ProjectSpecSchema = z
  .object({
    schema_version: SchemaVersionSchema,
    project: ProjectSpecIdentitySchema,
    key_commands: z.array(ProjectSpecCommandSchema).min(1),
    constraints: z.array(ProjectSpecConstraintSchema),
    risks: z.array(ProjectSpecRiskSchema),
    freshness: ProjectSpecFreshnessSchema,
    owner: ProjectSpecOwnerSchema,
    validation: ProjectSpecValidationSchema,
  })
  .passthrough();
export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;

export const CORRECTION_STATUSES = ["active", "superseded"] as const;
export const CorrectionStatusSchema = z.enum(CORRECTION_STATUSES);
export type CorrectionStatus = z.infer<typeof CorrectionStatusSchema>;

export const CorrectionRecordSchema = z
  .object({
    schema_version: SchemaVersionSchema,
    id: NonEmptyStringSchema,
    scope: NonEmptyStringSchema,
    statement: NonEmptyStringSchema,
    source: NonEmptyStringSchema,
    created_at: NonEmptyStringSchema,
    supersedes: z.array(NonEmptyStringSchema),
    status: CorrectionStatusSchema,
    owner: NonEmptyStringSchema,
  })
  .passthrough();
export type CorrectionRecord = z.infer<typeof CorrectionRecordSchema>;

export const WorkflowSchema = z
  .object({
    schema_version: SchemaVersionSchema,
    workflow_recipe_version: z.literal(WORKFLOW_RECIPE_SCHEMA_VERSION),
    compatible_packet_schema_versions: z
      .array(z.number().int())
      .min(1)
      .refine(
        (versions) => versions.length === 1 && versions[0] === CURRENT_PACKET_SCHEMA_VERSION,
        {
          message: `compatible_packet_schema_versions must equal [${CURRENT_PACKET_SCHEMA_VERSION}]`,
        },
      ),
    name: NonEmptyStringSchema.optional(),
    stages: z.array(NonEmptyStringSchema).min(1),
    user_gate: z.boolean().optional(),
  })
  .passthrough()
  .superRefine((workflow, ctx) => {
    if (Object.hasOwn(workflow, "id")) {
      ctx.addIssue({
        code: "custom",
        message: "workflow id is internally managed and must not be present",
        path: ["id"],
      });
    }
  });
export type Workflow = z.infer<typeof WorkflowSchema>;

export const REVIEWER_EXPECTED_OUTPUT_FORMAT = "agentmesh-review-markdown-v1" as const;
export const ReviewerAvailabilityStateSchema = z.enum([
  "available",
  "unavailable",
  "unknown",
]);
export type ReviewerAvailabilityState = z.infer<
  typeof ReviewerAvailabilityStateSchema
>;

export const ReviewerAvailabilityRecordSchema = z
  .object({
    state: ReviewerAvailabilityStateSchema,
    reason: z.string().optional(),
    checked_at: z.string().optional(),
  })
  .passthrough();
export type ReviewerAvailabilityRecord = z.infer<
  typeof ReviewerAvailabilityRecordSchema
>;

export const ReviewerRegistryEntrySchema = z
  .object({
    schema_version: SchemaVersionSchema,
    id: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    adapter_target: NonEmptyStringSchema,
    expected_output_format: z.literal(REVIEWER_EXPECTED_OUTPUT_FORMAT),
    availability: ReviewerAvailabilityRecordSchema,
    source_layer: z.string().optional(),
    source_path: z.string().optional(),
  })
  .passthrough();
export type ReviewerRegistryEntry = z.infer<typeof ReviewerRegistryEntrySchema>;

export const ReviewerRegistrySchema = z
  .object({
    schema_version: SchemaVersionSchema,
    expected_output_format: z.literal(REVIEWER_EXPECTED_OUTPUT_FORMAT),
    reviewers: z.array(ReviewerRegistryEntrySchema),
  })
  .passthrough();
export type ReviewerRegistry = z.infer<typeof ReviewerRegistrySchema>;

export const AdapterFailureClassificationSchema = z.enum([
  "unknown",
  "command_not_found",
  "auth_required",
  "timeout",
  "non_interactive_unsupported",
  "invalid_output",
  "cancelled",
  "rate_limited",
  "permission_denied",
  "configuration_error",
]);
export type AdapterFailureClassification = z.infer<
  typeof AdapterFailureClassificationSchema
>;

export const AdapterFailureSchema = z
  .object({
    classification: AdapterFailureClassificationSchema,
    message: NonEmptyStringSchema,
    retryable: z.boolean(),
  })
  .passthrough();
export type AdapterFailure = z.infer<typeof AdapterFailureSchema>;

export const AdapterCapabilityMetadataSchema = z
  .object({
    roles: z.array(NonEmptyStringSchema).default([]),
    stages: z.array(NonEmptyStringSchema).default([]),
    supports_non_interactive: z.boolean().optional(),
  })
  .passthrough();
export type AdapterCapabilityMetadata = z.infer<
  typeof AdapterCapabilityMetadataSchema
>;

export const AdapterInvocationInputSchema = z
  .object({
    schema_version: SchemaVersionSchema,
    adapter_id: NonEmptyStringSchema,
    stage: NonEmptyStringSchema,
    role: NonEmptyStringSchema,
    packet_dir: NonEmptyStringSchema,
    prompt_file: NonEmptyStringSchema,
    output_file: NonEmptyStringSchema,
    non_interactive: z.boolean().optional(),
    env: z.record(z.string(), z.string()).optional(),
    capabilities: AdapterCapabilityMetadataSchema.optional(),
  })
  .passthrough();
export type AdapterInvocationInput = z.infer<typeof AdapterInvocationInputSchema>;

export const AdapterInvocationStatusSchema = z.enum([
  "completed",
  "failed",
  "skipped",
  "needs_decision",
]);
export type AdapterInvocationStatus = z.infer<
  typeof AdapterInvocationStatusSchema
>;

export const AdapterInvocationOutputSchema = z
  .object({
    schema_version: SchemaVersionSchema,
    status: AdapterInvocationStatusSchema,
    exit_code: z.number().int().nullable().optional(),
    output_file: NonEmptyStringSchema.optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    failure: AdapterFailureSchema.optional(),
  })
  .passthrough();
export type AdapterInvocationOutput = z.infer<
  typeof AdapterInvocationOutputSchema
>;
