import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStudioArgs } from "@agentmesh/app-server/src/args.js";
import { startStudioServer } from "@agentmesh/app-server/src/server.js";

export async function studio(args: string[], configPath?: string): Promise<number> {
  const { host, port } = parseStudioArgs(args);
  const workspace = path.resolve(optionValue(args, "--workspace") ?? process.cwd());
  const resolvedConfigPath = configPath ? path.resolve(configPath) : undefined;
  const assetDir = resolveDefaultStudioAssetDir();
  const started = await startStudioServer({
    host,
    port,
    cwd: workspace,
    assetDir,
    allowUnauthenticatedBootstrap: true,
    ...(resolvedConfigPath ? { configPath: resolvedConfigPath } : {}),
  });

  console.log(`AgentMesh: ${started.url}`);
  if (args.includes("--no-open")) {
    console.log("Browser open disabled (--no-open).");
  } else {
    openBrowser(started.url);
  }
  console.log("Press Ctrl+C to stop.");

  await waitForShutdown(started.server);
  return 0;
}

function resolveDefaultStudioAssetDir(): string {
  const assetDir = process.env.AGENTMESH_STUDIO_ASSET_DIR
    ? path.resolve(process.env.AGENTMESH_STUDIO_ASSET_DIR)
    : fileURLToPath(
        new URL(["..", "..", "..", "..", "apps", "studio-web", "frontend", ""].join("/"), import.meta.url),
      );
  const indexPath = path.join(assetDir, "index.html");
  try {
    if (statSync(indexPath).isFile()) {
      return assetDir;
    }
  } catch {
    // Fall through to the explicit build hint below.
  }
  throw new Error(
    `AgentMesh frontend assets were not found at ${assetDir}. Run npm run build:studio-frontend before starting agentmesh studio.`,
  );
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`missing value for ${name}`);
  }
  return value;
}

function openBrowser(url: string): void {
  const command = browserCommand(url);
  const child = spawn(command[0], command.slice(1), {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    console.error(`Could not open browser automatically. Open this URL manually: ${url}`);
    console.error(error.message);
  });
  child.unref();
}

function browserCommand(url: string): string[] {
  const override = process.env.AGENTMESH_STUDIO_OPEN_COMMAND;
  if (override && override.trim().length > 0) {
    return [override, url];
  }
  if (process.platform === "darwin") {
    return ["open", url];
  }
  if (process.platform === "win32") {
    return ["cmd", "/c", "start", "", url];
  }
  return ["xdg-open", url];
}

function waitForShutdown(server: Server): Promise<void> {
  return new Promise((resolve) => {
    let closing = false;
    const close = () => {
      if (closing) {
        return;
      }
      closing = true;
      server.close(() => {
        resolve();
      });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}
