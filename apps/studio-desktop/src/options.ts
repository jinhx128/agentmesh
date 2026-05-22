import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface StudioDesktopOptions {
  host: "127.0.0.1";
  port: number;
  workspace: string;
  assetDir: string;
}

export interface StudioDesktopDefaults {
  cwd?: string;
  assetDir?: string;
}

export function parseStudioDesktopArgs(
  args: string[],
  defaults: StudioDesktopDefaults = {},
): StudioDesktopOptions {
  const cwd = path.resolve(defaults.cwd ?? process.cwd());
  const workspace = resolveWorkspace(optionValue(args, "--workspace") ?? cwd, cwd);
  return {
    host: "127.0.0.1",
    port: parsePort(optionValue(args, "--port") ?? "0"),
    workspace,
    assetDir: resolveAssetDir(
      optionValue(args, "--asset-dir") ?? defaults.assetDir ?? defaultBundledStudioAssetDir(),
      cwd,
    ),
  };
}

function resolveWorkspace(value: string, cwd: string): string {
  const workspace = path.resolve(cwd, value);
  if (!existsSync(workspace) || !statSync(workspace).isDirectory()) {
    throw new Error(`invalid --workspace: ${value}`);
  }
  return workspace;
}

function resolveAssetDir(value: string, cwd: string): string {
  const assetDir = path.resolve(cwd, value);
  if (!existsSync(assetDir) || !statSync(assetDir).isDirectory()) {
    throw new Error(`invalid --asset-dir: ${value}`);
  }
  return assetDir;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`invalid --port: ${value}`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid --port: ${value}`);
  }
  return port;
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

export function defaultBundledStudioAssetDir(): string {
  return fileURLToPath(
    new URL(["..", "..", "studio-web", "frontend", ""].join("/"), import.meta.url),
  );
}
