import type { StudioApiClient } from "./client.js";

export type StudioUpdateTargetStatus =
  | "current"
  | "update_available"
  | "manual_update_available"
  | "asset_missing";

export interface StudioUpdateTargetReport {
  status: StudioUpdateTargetStatus;
  asset_name?: string;
  asset_url?: string;
  install_command?: string[];
  reason?: string;
}

export interface StudioUpdateReport {
  schema_version: 1;
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
  checked_at: string;
  cli: StudioUpdateTargetReport;
  desktop: StudioUpdateTargetReport;
}

export function loadStudioUpdate(client: StudioApiClient): Promise<StudioUpdateReport> {
  return client.getJson<StudioUpdateReport>("/api/v1/update/check");
}
