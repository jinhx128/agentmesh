import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";

import { startStudioServer } from "@agentmesh/app-server/src/server.js";
import { defaultBundledStudioAssetDir } from "./options.js";

export interface StartStudioDesktopHostOptions {
  host?: "127.0.0.1";
  port: number;
  workspace: string;
  assetDir?: string;
  token?: string;
}

export interface StartedStudioDesktopHost {
  server: Server;
  serverUrl: string;
  webviewUrl: string;
  token: string;
  workspace: string;
  assetDir: string;
  stop: () => Promise<void>;
}

export interface StudioDesktopLaunchEvent {
  schema_version: 1;
  event: "agentmesh_studio_ready";
  server_url: string;
  webview_url: string;
  workspace: string;
}

export async function startStudioDesktopHost(
  options: StartStudioDesktopHostOptions,
): Promise<StartedStudioDesktopHost> {
  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? generateLaunchToken();
  const assetDir = options.assetDir ?? defaultBundledStudioAssetDir();
  let started: Awaited<ReturnType<typeof startStudioServer>>;
  try {
    started = await startStudioServer({
      host,
      port: options.port,
      cwd: options.workspace,
      authToken: token,
      assetDir,
      entrypoint: "desktop",
      integrations: {
        commandLineTool: desktopCommandLineToolSource(),
      },
    });
  } catch (error) {
    throw new Error(
      `Unable to start AgentMesh App Server on ${host}:${options.port}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  return {
    server: started.server,
    serverUrl: started.url,
    webviewUrl: `${started.url}/`,
    token,
    workspace: options.workspace,
    assetDir,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        if (!started.server.listening) {
          resolve();
          return;
        }
        started.server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

export async function restartStudioDesktopHost(
  current: StartedStudioDesktopHost,
  options: StartStudioDesktopHostOptions,
): Promise<StartedStudioDesktopHost> {
  await current.stop();
  return startStudioDesktopHost(options);
}

export function redactStudioUrlForLog(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/g, "$1<redacted>");
}

export function serializeStudioDesktopLaunchEvent(started: StartedStudioDesktopHost): string {
  const event: StudioDesktopLaunchEvent = {
    schema_version: 1,
    event: "agentmesh_studio_ready",
    server_url: started.serverUrl,
    webview_url: started.webviewUrl,
    workspace: started.workspace,
  };
  return JSON.stringify(event);
}

function generateLaunchToken(): string {
  return randomBytes(32).toString("base64url");
}

function desktopCommandLineToolSource(): {
  nodePath: string;
  cliPath: string;
  channel: "desktop";
} {
  return {
    nodePath: process.execPath,
    cliPath: fileURLToPath(
      new URL(["..", "..", "..", "packages", "cli", "src", "cli.js"].join("/"), import.meta.url),
    ),
    channel: "desktop",
  };
}
