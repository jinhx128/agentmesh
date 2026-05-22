import {
  getWorkspaceCompatibility,
  getRun,
  listRuns,
  readArtifactPreview,
  resolveRunDirectory,
  type AgentMeshArtifactPreview,
  type AgentMeshArtifactSummary,
  type AgentMeshEventPage,
  type AgentMeshMarkdownSectionView,
  type AgentMeshRawReviewView,
  type AgentMeshReleaseVerdictView,
  type AgentMeshReviewReleaseView,
  type AgentMeshRunDetail,
  type AgentMeshRunReadOptions,
  type AgentMeshRunSummary,
  type AgentMeshStageTimingSummary,
  type AgentMeshWorkspaceCompatibility,
} from "@agentmesh/sdk";
import {
  workspaceCompatibilityDiagnostics,
  type WorkspaceCompatibilityDiagnostics,
} from "@agentmesh/runtime/src/packet/compatibility.js";

export type StudioRunSummary = AgentMeshRunSummary;
export type StudioStageTimingSummary = AgentMeshStageTimingSummary;
export type StudioArtifactSummary = AgentMeshArtifactSummary;
export type StudioRunDetail = AgentMeshRunDetail;
export type StudioEventPage = AgentMeshEventPage;
export type StudioArtifactPreview = AgentMeshArtifactPreview;
export type StudioReleaseVerdictView = AgentMeshReleaseVerdictView;
export type StudioReviewReleaseView = AgentMeshReviewReleaseView;
export type StudioRawReviewView = AgentMeshRawReviewView;
export type StudioMarkdownSectionView = AgentMeshMarkdownSectionView;
export interface StudioReadOptions extends AgentMeshRunReadOptions {
  entrypoint?: string;
}
export type StudioWorkspaceCompatibility = AgentMeshWorkspaceCompatibility | WorkspaceCompatibilityDiagnostics;

export function readStudioCompatibility(
  options: StudioReadOptions = {},
): StudioWorkspaceCompatibility {
  return options.entrypoint
    ? workspaceCompatibilityDiagnostics(options.cwd ?? process.cwd(), { entrypoint: options.entrypoint })
    : getWorkspaceCompatibility({ cwd: options.cwd });
}

export function listStudioRuns(options: StudioReadOptions = {}): StudioRunSummary[] {
  return listRuns({
    cwd: options.cwd,
    eventTail: options.eventTail ?? 1,
    page: 1,
    pageSize: Number.MAX_SAFE_INTEGER,
  }).runs;
}

export function readStudioRun(
  runIdOrDir: string,
  options: StudioReadOptions = {},
): StudioRunDetail {
  return getRun(runIdOrDir, options);
}

export function readStudioArtifactPreview(
  runIdOrDir: string,
  artifactName: string,
  options: StudioReadOptions = {},
): StudioArtifactPreview {
  return readArtifactPreview(runIdOrDir, artifactName, options);
}

export function resolveStudioRunDirectory(runIdOrDir: string, cwd = process.cwd()): string {
  return resolveRunDirectory(runIdOrDir, cwd);
}
