import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface ReleaseAssetHelpers {
  normalizePackedTarballAsset: (options: {
    distDir: string;
    npmPackOutput: string;
    version: string;
  }) => string;
  updaterAssetNames: (version: string) => { archive: string; signature: string };
  createUpdaterMetadata: (options: {
    version: string;
    signature: string;
    pubDate: string;
    repo: string;
    notes: string;
  }) => {
    version: string;
    notes: string;
    pub_date: string;
    platforms: Record<string, { signature: string; url: string }>;
  };
}

async function loadHelpers(): Promise<ReleaseAssetHelpers> {
  return await import(pathToFileURL(path.join(process.cwd(), "scripts", "github-release-assets.mjs")).href);
}

test("GitHub release tarball asset drops npm scope from filenames", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "agentmesh-release-assets-"));
  test.after(() => rmSync(tempDir, { recursive: true, force: true }));
  writeFileSync(path.join(tempDir, "jinhx128-agentmesh-0.1.8.tgz"), "tarball");

  const { normalizePackedTarballAsset } = await loadHelpers();
  const releaseName = normalizePackedTarballAsset({
    distDir: tempDir,
    npmPackOutput: JSON.stringify([{ filename: "jinhx128-agentmesh-0.1.8.tgz" }]),
    version: "0.1.8",
  });

  assert.equal(releaseName, "agentmesh-0.1.8.tgz");
  assert.equal(existsSync(path.join(tempDir, "agentmesh-0.1.8.tgz")), true);
  assert.equal(existsSync(path.join(tempDir, "jinhx128-agentmesh-0.1.8.tgz")), false);
  assert.equal(readFileSync(path.join(tempDir, "agentmesh-0.1.8.tgz"), "utf-8"), "tarball");
});

test("GitHub release updater metadata binds the versioned archive and signature", async () => {
  const { updaterAssetNames, createUpdaterMetadata } = await loadHelpers();
  assert.deepEqual(updaterAssetNames("0.1.11"), {
    archive: "AgentMesh_0.1.11_aarch64.app.tar.gz",
    signature: "AgentMesh_0.1.11_aarch64.app.tar.gz.sig",
  });

  const metadata = createUpdaterMetadata({
    version: "0.1.11",
    signature: "signature-value\n",
    pubDate: "2026-07-15T12:00:00.000Z",
    repo: "jinhx128/agentmesh",
    notes: "Updater enabled",
  });
  assert.deepEqual(metadata, {
    version: "0.1.11",
    notes: "Updater enabled",
    pub_date: "2026-07-15T12:00:00.000Z",
    platforms: {
      "darwin-aarch64": {
        signature: "signature-value",
        url: "https://github.com/jinhx128/agentmesh/releases/download/v0.1.11/AgentMesh_0.1.11_aarch64.app.tar.gz",
      },
    },
  });
});
