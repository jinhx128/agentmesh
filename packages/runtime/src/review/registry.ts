import {
  CURRENT_SCHEMA_VERSION,
  REVIEWER_EXPECTED_OUTPUT_FORMAT,
  type ReviewerAvailabilityRecord,
  type ReviewerRegistry,
  type ReviewerRegistryEntry,
} from "@agentmesh/core";
import { loadAgentsWithSources, type AgentConfig } from "../adapters.js";

export function buildReviewerRegistry(configPath?: string): ReviewerRegistry {
  const agents = Object.values(loadAgentsWithSources(configPath));
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    expected_output_format: REVIEWER_EXPECTED_OUTPUT_FORMAT,
    reviewers: agents.map(reviewerEntryFromAgent).sort(compareReviewers),
  };
}

function reviewerEntryFromAgent(agent: AgentConfig): ReviewerRegistryEntry {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    id: agent.id,
    label: agent.label,
    adapter_target: agent.adapter,
    expected_output_format: REVIEWER_EXPECTED_OUTPUT_FORMAT,
    availability: reviewerAvailability(agent),
    capability_profiles: reviewCapabilityProfiles(agent),
    ...(agent.source_layer ? { source_layer: agent.source_layer } : {}),
    ...(agent.source_path ? { source_path: agent.source_path } : {}),
  };
}

function reviewCapabilityProfiles(agent: AgentConfig): string[] {
  return agent.capabilities.filter(
    (capability) => capability === "review" || capability.startsWith("reviewer."),
  );
}

function reviewerAvailability(agent: AgentConfig): ReviewerAvailabilityRecord {
  if (agent.capabilities.length === 0 || agent.capabilities.includes("review")) {
    return {
      state: "available",
      reason: "agent has review capability",
    };
  }
  return {
    state: "unavailable",
    reason: "agent lacks review capability",
  };
}

function compareReviewers(left: ReviewerRegistryEntry, right: ReviewerRegistryEntry): number {
  const availabilityOrder = { available: 0, unknown: 1, unavailable: 2 };
  return (
    availabilityOrder[left.availability.state] -
      availabilityOrder[right.availability.state] ||
    left.id.localeCompare(right.id)
  );
}
