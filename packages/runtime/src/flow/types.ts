import type { McpResourceSpec } from "../mcp/resource.js";
import type {
  StageFailurePolicy,
  StageType,
} from "@agentmesh/core";
import type {
  ConfigProvenance,
  ContextPolicyConfig,
  DefaultStageAgentsConfig,
  FallbackConfig,
  FallbackStageTypeConfig,
} from "../config.js";
import type { ResolvedReviewReleasePolicy } from "../review/policy.js";
import type { ResolvedExecutionPolicy } from "./execution-policy.js";

export interface RuntimeTimingInput {
  config_load_ms?: number;
  mcp_connect_ms?: number;
  mcp_cache_hits?: number;
  mcp_cache_misses?: number;
  total_ms?: number;
}

export interface FlowRunInput {
  plan: string | null;
  execute: string | null;
  review: string[];
  decide: string | null;
  stageAssignments?: Record<string, string[]>;
  task: string;
  runId: string;
  userGate?: boolean;
  workflow?: string;
  workflowSource?: Record<string, unknown>;
  workflowCompatibility?: WorkflowCompatibilityInput;
  preset?: string;
  presetSource?: Record<string, unknown>;
  presetDefaultStageAgents?: DefaultStageAgentsConfig;
  globalDefaultStageAgents?: DefaultStageAgentsConfig;
  workflowFailurePolicy?: FailurePolicyConfig;
  presetFailurePolicy?: FailurePolicyConfig;
  presetFallback?: FallbackRoutingConfig;
  globalFallback?: FallbackConfig;
  agentTimeoutSeconds?: Record<string, number>;
  timeoutSeconds?: number;
  agentCapabilities?: Record<string, string[]>;
  stages?: string[];
  contextFiles?: string[];
  diffFile?: string;
  verificationFile?: string;
  scopes?: string[];
  mcpResources?: McpResourceSpec[];
  mcpServers?: Record<string, Record<string, unknown>>;
  contextPolicy?: ContextPolicyConfig;
  reviewReleasePolicy?: ResolvedReviewReleasePolicy;
  executionPolicy?: ResolvedExecutionPolicy;
  configProvenance?: ConfigProvenance;
  runtimeTiming?: RuntimeTimingInput;
  includeSpec?: boolean;
  excludeCorrections?: string[];
}

export interface FailurePolicyConfig {
  stage_types: Partial<Record<StageType, StageFailurePolicy>>;
  nodes: Record<string, StageFailurePolicy>;
}

export interface FallbackNodeConfig extends FallbackStageTypeConfig {
  inherit_stage_type?: boolean;
}

export interface FallbackRoutingConfig extends FallbackConfig {
  nodes?: Record<string, FallbackNodeConfig>;
}

export interface WorkflowCompatibilityInput {
  source: string;
  schemaVersion: number;
  workflowRecipeVersion: number;
  compatiblePacketSchemaVersions: number[];
}

export interface DispatchOptions {
  configPath?: string;
  entrypoint?: string;
  timeoutSecs?: number;
}

export interface DispatchResult {
  runDir: string;
  dispatched: string[];
  awaitingCurrent?: string;
}
