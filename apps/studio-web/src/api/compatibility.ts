import type { StudioApiClient } from "./client.js";

export type StudioCompatibilityDecision = "read_write" | "read_only" | "refused";
export type StudioCompatibilityMetadataState = "ok" | "missing_legacy" | "newer_schema" | "invalid";

export interface StudioCompatibilityMetadata {
  schema_version: number;
  packet_schema_version: number;
  min_read_runtime_version: string;
  min_write_runtime_version: string;
  last_writer_runtime_version: string;
  last_writer_entrypoint: string;
  updated_at: string;
}

export interface StudioCompatibilityDiagnostics {
  decision: StudioCompatibilityDecision;
  metadata_state: StudioCompatibilityMetadataState;
  current_runtime_version: string;
  current_entrypoint: string;
  compatibility_path: string;
  metadata: StudioCompatibilityMetadata | null;
  reasons: string[];
}

export function loadStudioCompatibility(
  client: StudioApiClient,
): Promise<StudioCompatibilityDiagnostics> {
  return client.getJson<StudioCompatibilityDiagnostics>("/api/compatibility");
}
