import { createHash } from "node:crypto";

import {
  type ConfigSourceRef,
  type ExecutionPolicyConfig,
  type LoadedAgentmeshConfig,
  type RunDefaultsConfig,
} from "../config.js";
import type { PacketStatus } from "../packet/io.js";

export interface ResolvedExecutionPolicy
  extends RunDefaultsConfig,
    ExecutionPolicyConfig {
  source_layers: ConfigSourceRef[];
  policy_hash: string;
}

export function resolveExecutionPolicyForRun(
  loadedConfig: LoadedAgentmeshConfig | undefined,
): ResolvedExecutionPolicy | undefined {
  if (!loadedConfig) {
    return undefined;
  }
  const defaults = loadedConfig.config.run_defaults;
  const policy = loadedConfig.config.execution_policy;
  if (Object.keys(defaults).length === 0 && Object.keys(policy).length === 0) {
    return undefined;
  }
  const resolved = clampDefaultsToPolicy({ ...defaults, ...policy });
  const sourceLayers = uniqueSourceLayers([
    ...loadedConfig.runDefaultsSources,
    ...loadedConfig.executionPolicySources,
  ]);
  const base = {
    source_layers: sourceLayers,
    ...resolved,
  };
  return {
    ...base,
    policy_hash: `sha256:${createHash("sha256").update(JSON.stringify(base)).digest("hex")}`,
  };
}

export function executionPolicyFromStatus(
  status: PacketStatus,
): ResolvedExecutionPolicy | undefined {
  const value = (status as Record<string, unknown>).resolved_execution_policy;
  return isResolvedExecutionPolicy(value) ? value : undefined;
}

export function assertAutoDispatchAllowed(status: PacketStatus): void {
  const policy = executionPolicyFromStatus(status);
  if (policy?.allow_auto_dispatch === false) {
    throw new Error("execution_policy allow_auto_dispatch is false for this run");
  }
}

export function fanoutConcurrencyLimit(status: PacketStatus): number | undefined {
  const policy = executionPolicyFromStatus(status);
  return policy?.max_fanout_concurrency;
}

export function adapterTimeoutSecsForDispatch(
  status: PacketStatus,
  requestedTimeoutSecs?: number,
): number | undefined {
  const policy = executionPolicyFromStatus(status);
  const max = policy?.max_adapter_timeout_secs;
  if (requestedTimeoutSecs !== undefined) {
    if (max !== undefined && requestedTimeoutSecs > max) {
      throw new Error(
        `execution_policy max_adapter_timeout_secs exceeded: ${requestedTimeoutSecs} > ${max}`,
      );
    }
    return requestedTimeoutSecs;
  }
  return policy?.adapter_timeout_secs;
}

export function assertRetryAllowed(status: PacketStatus, stage: string): void {
  const policy = executionPolicyFromStatus(status);
  const maxRetryAttempts = policy?.max_retry_attempts;
  if (maxRetryAttempts === undefined) {
    return;
  }
  const attemptCount = status.stage_timing[stage]?.attempt_count ?? 0;
  const completedRetries = Math.max(0, attemptCount - 1);
  if (completedRetries >= maxRetryAttempts) {
    throw new Error(
      `execution_policy max_retry_attempts exceeded for stage ${stage}: ${completedRetries} >= ${maxRetryAttempts}`,
    );
  }
}

function clampDefaultsToPolicy(
  input: RunDefaultsConfig & ExecutionPolicyConfig,
): RunDefaultsConfig & ExecutionPolicyConfig {
  return {
    ...input,
    ...(input.dispatch_timeout_secs !== undefined && input.max_dispatch_timeout_secs !== undefined
      ? { dispatch_timeout_secs: Math.min(input.dispatch_timeout_secs, input.max_dispatch_timeout_secs) }
      : {}),
    ...(input.adapter_timeout_secs !== undefined && input.max_adapter_timeout_secs !== undefined
      ? { adapter_timeout_secs: Math.min(input.adapter_timeout_secs, input.max_adapter_timeout_secs) }
      : {}),
    ...(input.retry_attempts !== undefined && input.max_retry_attempts !== undefined
      ? { retry_attempts: Math.min(input.retry_attempts, input.max_retry_attempts) }
      : {}),
  };
}

function isResolvedExecutionPolicy(value: unknown): value is ResolvedExecutionPolicy {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSourceLayers(sources: ConfigSourceRef[]): ConfigSourceRef[] {
  const output: ConfigSourceRef[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const key = `${source.source}\0${source.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(source);
  }
  return output;
}
