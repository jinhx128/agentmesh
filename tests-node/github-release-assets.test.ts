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
}

async function loadHelpers(): Promise<ReleaseAssetHelpers> {
  return await import(pathToFileURL(path.join(process.cwd(), "scripts", "github-release-assets.mjs")).href);
}

test("GitHub release tarball asset drops npm scope from filenames", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "agentmesh-release-assets-"));
  test.after(() => rmSync(tempDir, { recursive: true, force: true }));
  writeFileSync(path.join(tempDir, "jinhx128-agentmesh-0.1.5.tgz"), "tarball");

  const { normalizePackedTarballAsset } = await loadHelpers();
  const releaseName = normalizePackedTarballAsset({
    distDir: tempDir,
    npmPackOutput: JSON.stringify([{ filename: "jinhx128-agentmesh-0.1.5.tgz" }]),
    version: "0.1.5",
  });

  assert.equal(releaseName, "agentmesh-0.1.5.tgz");
  assert.equal(existsSync(path.join(tempDir, "agentmesh-0.1.5.tgz")), true);
  assert.equal(existsSync(path.join(tempDir, "jinhx128-agentmesh-0.1.5.tgz")), false);
  assert.equal(readFileSync(path.join(tempDir, "agentmesh-0.1.5.tgz"), "utf-8"), "tarball");
});
