import { createHash } from "node:crypto";

import {
  type CapabilityProfileConfig,
  type ConfigSourceRef,
  type LoadedAgentmeshConfig,
} from "../config.js";
import { normalizeAgents, type AgentConfig } from "../adapters.js";

export interface ResolvedReviewProfile {
  profile: string;
  agent_ids: string[];
}

export interface ResolvedReviewReleasePolicy {
  source_layers: ConfigSourceRef[];
  policy_hash: string;
  required_review_profiles: string[];
  resolved_reviewers: ResolvedReviewProfile[];
  profile_resolution_warnings?: string[];
  required_evidence: string[];
  needs_decision_risks: string[];
  skipped_gates: string[];
  missing_evidence: string[];
}

interface ProfileResolution {
  profile: string;
  agent_ids: string[];
  warnings: string[];
}

export interface ReleasePolicyEvidenceInventory {
  diff: boolean;
  verification: boolean;
  reviewOutputs: boolean;
  classifiedFindings: boolean;
}

export function resolveReviewReleasePolicyForWorkflow(
  workflowId: string,
  loadedConfig: LoadedAgentmeshConfig | undefined,
): ResolvedReviewReleasePolicy | undefined {
  if (!loadedConfig) {
    return undefined;
  }
  const reviewPolicy = loadedConfig.config.review_policy[workflowId];
  const releasePolicy = loadedConfig.config.release_policy[workflowId];
  if (!reviewPolicy && !releasePolicy) {
    return undefined;
  }
  const agents = normalizeAgents(loadedConfig.config, loadedConfig.agentSources);
  const requiredReviewProfiles = reviewPolicy?.required_review_profiles ?? [];
  const profileResolutions = requiredReviewProfiles.map((profile) =>
    reviewerIdsForProfile(profile, agents, loadedConfig),
  );
  const resolvedReviewers = profileResolutions.map(({ profile, agent_ids }) => ({
    profile,
    agent_ids,
  }));
  const profileResolutionWarnings = profileResolutions.flatMap((resolution) =>
    resolution.warnings,
  );
  for (const resolved of resolvedReviewers) {
    if (resolved.agent_ids.length === 0) {
      throw new Error(
        `review_policy.${workflowId} required profile has no matching reviewer agent: ${resolved.profile}`,
      );
    }
  }
  const requiredEvidence = releasePolicy?.required_evidence ?? [];
  const needsDecisionRisks = releasePolicy?.needs_decision_risks ?? [];
  const sourceLayers = uniqueSourceLayers([
    ...(loadedConfig.reviewPolicySources[workflowId] ?? []),
    ...(loadedConfig.releasePolicySources[workflowId] ?? []),
  ]);
  const base = {
    source_layers: sourceLayers,
    required_review_profiles: requiredReviewProfiles,
    resolved_reviewers: resolvedReviewers,
    profile_resolution_warnings: profileResolutionWarnings,
    required_evidence: requiredEvidence,
    needs_decision_risks: needsDecisionRisks,
  };
  return {
    ...base,
    policy_hash: `sha256:${createHash("sha256").update(JSON.stringify(base)).digest("hex")}`,
    skipped_gates: [],
    missing_evidence: [],
  };
}

export function reviewAgentIdsFromPolicy(
  policy: ResolvedReviewReleasePolicy | undefined,
): string[] {
  if (!policy) {
    return [];
  }
  return uniqueStrings(policy.resolved_reviewers.flatMap((profile) => profile.agent_ids));
}

export function applyReleasePolicyEvidence(
  policy: ResolvedReviewReleasePolicy,
  inventory: ReleasePolicyEvidenceInventory,
): ResolvedReviewReleasePolicy {
  const missingEvidence = policy.required_evidence.filter(
    (item) => !evidencePresent(item, inventory),
  );
  return {
    ...policy,
    missing_evidence: missingEvidence,
    skipped_gates: missingEvidence.map((item) => `required evidence missing: ${item}`),
  };
}

function reviewerIdsForProfile(
  profile: string,
  agents: Record<string, AgentConfig>,
  loadedConfig: LoadedAgentmeshConfig,
): ProfileResolution {
  const definition = loadedConfig.config.capability_profiles[profile];
  if (definition) {
    return reviewerIdsForDefinedProfile(
      profile,
      definition,
      agents,
      loadedConfig.config.capability_profile_preferences[profile]?.agents,
    );
  }
  const agent_ids = Object.values(agents)
    .filter((agent) => agent.capabilities.includes("review"))
    .filter((agent) => agent.capabilities.includes(profile))
    .map((agent) => agent.id)
    .sort((left, right) => left.localeCompare(right));
  return { profile, agent_ids, warnings: [] };
}

function reviewerIdsForDefinedProfile(
  profile: string,
  definition: CapabilityProfileConfig,
  agents: Record<string, AgentConfig>,
  preferredAgents: string[] | undefined,
): ProfileResolution {
  const candidates = Object.values(agents)
    .filter((agent) => agentSatisfiesProfile(agent, definition))
    .map((agent) => agent.id)
    .sort((left, right) => left.localeCompare(right));
  if (preferredAgents && preferredAgents.length > 0) {
    for (const agentId of preferredAgents) {
      if (!agents[agentId]) {
        throw new Error(`capability_profile_preferences.${profile} references unknown agent: ${agentId}`);
      }
      if (!candidates.includes(agentId)) {
        throw new Error(`capability_profile_preferences.${profile} agent does not satisfy profile: ${agentId}`);
      }
    }
    if (preferredAgents.length < definition.min_count) {
      throw new Error(`capability_profile_preferences.${profile} selects ${preferredAgents.length} agent(s), but min_count is ${definition.min_count}`);
    }
    return { profile, agent_ids: [...preferredAgents], warnings: [] };
  }
  if (candidates.length < definition.min_count) {
    throw new Error(`capability_profiles.${profile} has ${candidates.length} matching agent(s), but min_count is ${definition.min_count}`);
  }
  if (candidates.length === definition.min_count) {
    return {
      profile,
      agent_ids: candidates,
      warnings: [
        `capability_profiles.${profile} has no preference; auto-selected matching agents: ${candidates.join(", ")}`,
      ],
    };
  }
  throw new Error(`capability_profiles.${profile} is ambiguous; candidates: ${candidates.join(", ")}`);
}

function agentSatisfiesProfile(agent: AgentConfig, definition: CapabilityProfileConfig): boolean {
  return (
    agent.capabilities.includes(definition.stage) &&
    definition.required_capabilities.every((capability) => agent.capabilities.includes(capability))
  );
}

function evidencePresent(
  evidence: string,
  inventory: ReleasePolicyEvidenceInventory,
): boolean {
  const normalized = evidence.trim().toLocaleLowerCase();
  if (["diff", "code-diff", "scoped-diff"].includes(normalized)) {
    return inventory.diff;
  }
  if (["tests", "test", "verification", "diff-check"].includes(normalized)) {
    return inventory.verification;
  }
  if (["review", "reviews", "review-output", "review-outputs"].includes(normalized)) {
    return inventory.reviewOutputs;
  }
  if (["findings", "classified-findings"].includes(normalized)) {
    return inventory.classifiedFindings;
  }
  return false;
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
