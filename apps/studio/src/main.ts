import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStudioArgs } from "@agentmesh/app-server/src/args.js";
import { startStudioServer } from "@agentmesh/app-server/src/server.js";

const { host, port } = parseStudioArgs(process.argv.slice(2));
const assetDir = resolveDefaultStudioAssetDir();
const started = await startStudioServer({
  host,
  port,
  cwd: process.cwd(),
  assetDir,
  allowUnauthenticatedBootstrap: true,
});

console.log(`AgentMesh Studio: ${started.url}`);

function resolveDefaultStudioAssetDir(): string {
  const assetDir = process.env.AGENTMESH_STUDIO_ASSET_DIR
    ? path.resolve(process.env.AGENTMESH_STUDIO_ASSET_DIR)
    : fileURLToPath(new URL(["..", "..", "studio-web", "frontend", ""].join("/"), import.meta.url));
  const indexPath = path.join(assetDir, "index.html");
  try {
    if (statSync(indexPath).isFile()) {
      return assetDir;
    }
  } catch {
    // Fall through to the explicit build hint below.
  }
  throw new Error(
    `Studio frontend assets were not found at ${assetDir}. Run npm run build:studio-frontend before starting Studio.`,
  );
}
