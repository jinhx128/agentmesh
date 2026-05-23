import { arch } from "node:os";

import { currentRuntimeVersion } from "../packet/compatibility.js";

export const AGENTMESH_UPDATE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_AGENTMESH_RELEASE_URL =
  "https://api.github.com/repos/jinhx128/agentmesh/releases/latest";
const DEFAULT_AGENTMESH_WEB_RELEASE_URL =
  "https://github.com/jinhx128/agentmesh/releases/latest";

export type AgentMeshUpdateStatus =
  | "current"
  | "update_available"
  | "manual_update_available"
  | "asset_missing";

export interface AgentMeshUpdateTargetReport {
  status: AgentMeshUpdateStatus;
  asset_name?: string;
  asset_url?: string;
  install_command?: string[];
  reason?: string;
}

export interface AgentMeshUpdateReport {
  schema_version: typeof AGENTMESH_UPDATE_SCHEMA_VERSION;
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
  checked_at: string;
  cli: AgentMeshUpdateTargetReport;
  desktop: AgentMeshUpdateTargetReport;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleasePayload {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export interface CheckAgentMeshUpdateOptions {
  currentVersion?: string;
  releaseUrl?: string;
  webReleaseUrl?: string;
}

export async function checkAgentMeshUpdate(
  options: CheckAgentMeshUpdateOptions = {},
): Promise<AgentMeshUpdateReport> {
  const currentVersion = options.currentVersion ?? currentRuntimeVersion();
  const releaseUrl = options.releaseUrl ?? process.env.AGENTMESH_UPDATE_RELEASE_URL ?? DEFAULT_AGENTMESH_RELEASE_URL;
  const webReleaseUrl = options.webReleaseUrl ??
    process.env.AGENTMESH_UPDATE_WEB_RELEASE_URL ??
    webReleaseUrlForApiReleaseUrl(releaseUrl);
  const release = await fetchRelease(releaseUrl, webReleaseUrl);
  return buildAgentMeshUpdateReport({
    currentVersion,
    release,
    checkedAt: new Date().toISOString(),
  });
}

export function buildAgentMeshUpdateReport(input: {
  currentVersion: string;
  release: ReleasePayload;
  checkedAt: string;
}): AgentMeshUpdateReport {
  const latestVersion = normalizeReleaseVersion(input.release.tag_name);
  const updateAvailable = semverGreaterThan(latestVersion, input.currentVersion);
  const cliAsset = findCliAsset(input.release.assets, latestVersion);
  const desktopAsset = findDesktopAsset(input.release.assets, latestVersion);

  return {
    schema_version: AGENTMESH_UPDATE_SCHEMA_VERSION,
    current_version: input.currentVersion,
    latest_version: latestVersion,
    update_available: updateAvailable,
    release_url: input.release.html_url,
    checked_at: input.checkedAt,
    cli: buildCliTarget(updateAvailable, cliAsset, latestVersion),
    desktop: buildDesktopTarget(updateAvailable, desktopAsset, latestVersion),
  };
}

export function cliInstallCommand(assetUrl: string): string[] {
  return ["npm", "install", "-g", assetUrl];
}

function buildCliTarget(
  updateAvailable: boolean,
  asset: ReleaseAsset | undefined,
  latestVersion: string,
): AgentMeshUpdateTargetReport {
  if (!updateAvailable) {
    return { status: "current" };
  }
  if (!asset) {
    return {
      status: "asset_missing",
      reason: `Release v${latestVersion} does not include an agentmesh-${latestVersion}.tgz CLI asset.`,
    };
  }
  return {
    status: "update_available",
    asset_name: asset.name,
    asset_url: asset.browser_download_url,
    install_command: cliInstallCommand(asset.browser_download_url),
  };
}

function buildDesktopTarget(
  updateAvailable: boolean,
  asset: ReleaseAsset | undefined,
  latestVersion: string,
): AgentMeshUpdateTargetReport {
  if (!updateAvailable) {
    return { status: "current" };
  }
  if (!asset) {
    return {
      status: "asset_missing",
      reason: `Release v${latestVersion} does not include a macOS Desktop DMG asset.`,
    };
  }
  return {
    status: "manual_update_available",
    asset_name: asset.name,
    asset_url: asset.browser_download_url,
    reason: "Desktop auto-update is not enabled for this release channel; download and install the DMG manually.",
  };
}

async function fetchRelease(releaseUrl: string, webReleaseUrl: string | undefined): Promise<ReleasePayload> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json, application/json",
    "user-agent": "agentmesh-update-check",
  };
  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (githubToken && githubToken.trim() !== "") {
    headers.authorization = `Bearer ${githubToken.trim()}`;
  }
  const response = await fetch(releaseUrl, {
    headers,
  });
  if (!response.ok) {
    const message = `update check failed: ${response.status} ${response.statusText}`;
    if (webReleaseUrl && isRateLimited(response)) {
      try {
        return await fetchReleaseFromWebPage(webReleaseUrl);
      } catch (error) {
        throw new Error(`${message}; release page fallback failed: ${errorMessage(error)}`);
      }
    }
    throw new Error(message);
  }
  return parseReleasePayload(await response.json(), releaseUrl);
}

async function fetchReleaseFromWebPage(webReleaseUrl: string): Promise<ReleasePayload> {
  const response = await fetch(webReleaseUrl, {
    headers: {
      "user-agent": "agentmesh-update-check",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`release page check failed: ${response.status} ${response.statusText}`);
  }
  const releasePageUrl = response.url && response.url.trim() !== "" ? response.url : webReleaseUrl;
  const tagName = releaseTagFromPageUrl(releasePageUrl);
  const latestVersion = normalizeReleaseVersion(tagName);
  return {
    tag_name: tagName,
    html_url: releasePageUrl,
    assets: inferredReleaseAssets(releasePageUrl, tagName, latestVersion),
  };
}

function parseReleasePayload(value: unknown, releaseUrl: string): ReleasePayload {
  if (!isRecord(value)) {
    throw new Error(`update release response from ${releaseUrl} must be an object`);
  }
  const tagName = stringField(value, "tag_name", releaseUrl);
  const htmlUrl = stringField(value, "html_url", releaseUrl);
  const rawAssets = value.assets;
  if (!Array.isArray(rawAssets)) {
    throw new Error(`update release response from ${releaseUrl} must include assets`);
  }
  const assets = rawAssets
    .filter(isRecord)
    .map((asset) => ({
      name: stringField(asset, "name", releaseUrl),
      browser_download_url: stringField(asset, "browser_download_url", releaseUrl),
    }));
  return {
    tag_name: tagName,
    html_url: htmlUrl,
    assets,
  };
}

function findCliAsset(
  assets: ReleaseAsset[],
  latestVersion: string,
): ReleaseAsset | undefined {
  return assets.find((asset) => asset.name === `agentmesh-${latestVersion}.tgz`) ??
    assets.find((asset) => /^agentmesh-\d+\.\d+\.\d+.*\.tgz$/.test(asset.name));
}

function findDesktopAsset(
  assets: ReleaseAsset[],
  latestVersion: string,
): ReleaseAsset | undefined {
  const platformArch = desktopAssetArch();
  return assets.find((asset) => asset.name === `AgentMesh_${latestVersion}_${platformArch}.dmg`) ??
    assets.find((asset) => asset.name === `AgentMesh_${latestVersion}_aarch64.dmg`) ??
    assets.find((asset) => /^AgentMesh_\d+\.\d+\.\d+.*\.dmg$/.test(asset.name));
}

function desktopAssetArch(): string {
  return arch() === "arm64" ? "aarch64" : arch();
}

function isRateLimited(response: Response): boolean {
  return response.status === 429 ||
    (response.status === 403 &&
      (response.statusText.toLowerCase().includes("rate") ||
        response.headers.get("x-ratelimit-remaining") === "0"));
}

function releaseTagFromPageUrl(releasePageUrl: string): string {
  const url = new URL(releasePageUrl);
  const match = /\/releases\/tag\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) {
    throw new Error(`release page ${releasePageUrl} did not resolve to a tag URL`);
  }
  return decodeURIComponent(match[1]);
}

function inferredReleaseAssets(
  releasePageUrl: string,
  tagName: string,
  latestVersion: string,
): ReleaseAsset[] {
  const releasePage = new URL(releasePageUrl);
  const downloadBasePath = releasePage.pathname.replace(
    /\/releases\/tag\/[^/]+\/?$/,
    `/releases/download/${encodeURIComponent(tagName)}`,
  );
  const downloadBase = new URL(`${downloadBasePath.replace(/\/$/, "")}/`, releasePage.origin);
  const desktopArchs = Array.from(new Set([desktopAssetArch(), "aarch64"]));
  return [
    assetFromBase(downloadBase, `agentmesh-${latestVersion}.tgz`),
    ...desktopArchs.map((assetArch) => assetFromBase(downloadBase, `AgentMesh_${latestVersion}_${assetArch}.dmg`)),
  ];
}

function assetFromBase(downloadBase: URL, name: string): ReleaseAsset {
  return {
    name,
    browser_download_url: new URL(name, downloadBase).toString(),
  };
}

function webReleaseUrlForApiReleaseUrl(releaseUrl: string): string | undefined {
  if (releaseUrl === DEFAULT_AGENTMESH_RELEASE_URL) {
    return DEFAULT_AGENTMESH_WEB_RELEASE_URL;
  }
  try {
    const url = new URL(releaseUrl);
    const match = /^\/repos\/([^/]+)\/([^/]+)\/releases\/latest$/.exec(url.pathname);
    if (url.hostname === "api.github.com" && match) {
      return `https://github.com/${match[1]}/${match[2]}/releases/latest`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeReleaseVersion(tagName: string): string {
  return tagName.trim().replace(/^v/i, "");
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
    return [0, 0, 0];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function stringField(
  record: Record<string, unknown>,
  key: string,
  releaseUrl: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`update release response from ${releaseUrl} has invalid ${key}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
