import { existsSync, renameSync } from "node:fs";
import path from "node:path";

export function releaseTarballName(version) {
  return `agentmesh-${version}.tgz`;
}

export function updaterAssetNames(version) {
  const archive = `AgentMesh_${version}_aarch64.app.tar.gz`;
  return { archive, signature: `${archive}.sig` };
}

export function createUpdaterMetadata({ version, signature, pubDate, repo, notes }) {
  const { archive } = updaterAssetNames(version);
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      "darwin-aarch64": {
        signature: signature.trim(),
        url: `https://github.com/${repo}/releases/download/v${version}/${archive}`,
      },
    },
  };
}

export function normalizePackedTarballAsset({ distDir, npmPackOutput, version }) {
  const packed = parseNpmPackOutput(npmPackOutput);
  const releaseName = releaseTarballName(version);
  if (packed.filename !== releaseName) {
    const source = path.join(distDir, packed.filename);
    const target = path.join(distDir, releaseName);
    if (!existsSync(source)) {
      throw new Error(`npm pack reported ${packed.filename}, but ${source} was not written.`);
    }
    renameSync(source, target);
  }
  return releaseName;
}

function parseNpmPackOutput(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`Unable to parse npm pack --json output: ${error instanceof Error ? error.message : String(error)}`);
  }
  const first = Array.isArray(parsed) ? parsed[0] : undefined;
  if (!first || typeof first.filename !== "string" || first.filename.trim().length === 0) {
    throw new Error("npm pack --json did not report a tarball filename.");
  }
  return { filename: first.filename };
}
