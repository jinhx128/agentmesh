import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export interface StudioDesktopSidecarPaths {
  targetTriple: string;
  sidecarDir: string;
  externalBin: string;
  launcherPath: string;
  nodePath: string;
  nodeModulesPath: string;
  entrypointPath: string;
  frontendIndexPath: string;
  entrypointRelative: string;
}

export interface StudioDesktopSidecarBundleSummary extends StudioDesktopSidecarPaths {
  usesBundledNode: boolean;
  bundledNodeLibraryCount: number;
  bundledRuntimeDependencyCount: number;
}

const sidecarBaseRelative = "dist-node/apps/studio-desktop/sidecar/agentmesh-studio-sidecar";
const externalBin = `../../../${sidecarBaseRelative}`;
const entrypointRelative = "../src/main.js";

export function studioDesktopSidecarPaths(options: {
  cwd?: string;
  targetTriple?: string;
} = {}): StudioDesktopSidecarPaths {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const targetTriple = options.targetTriple ?? defaultTauriTargetTriple();
  const launcherPath = path.join(cwd, `${sidecarBaseRelative}-${targetTriple}`);
  const sidecarDir = path.dirname(launcherPath);
  return {
    targetTriple,
    sidecarDir,
    externalBin,
    launcherPath,
    nodePath: path.join(sidecarDir, "node"),
    nodeModulesPath: path.join(cwd, "dist-node/apps/studio-desktop/runtime-node_modules"),
    entrypointPath: path.join(cwd, "dist-node/apps/studio-desktop/src/main.js"),
    frontendIndexPath: path.join(cwd, "dist-node/apps/studio-web/frontend/index.html"),
    entrypointRelative,
  };
}

export function bundleStudioDesktopSidecar(options: {
  cwd?: string;
  targetTriple?: string;
  nodePath?: string;
} = {}): StudioDesktopSidecarBundleSummary {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const paths = studioDesktopSidecarPaths({ ...options, cwd });
  const sourceNode = path.resolve(options.nodePath ?? process.execPath);
  requireFile(paths.entrypointPath, "desktop sidecar entrypoint");
  requireFile(paths.frontendIndexPath, "built Studio frontend");
  requireFile(sourceNode, "Node runtime");

  mkdirSync(paths.sidecarDir, { recursive: true });
  copyFileSync(sourceNode, paths.nodePath);
  chmodSync(paths.nodePath, 0o755);
  const bundledNodeLibraryCount = bundleMacOsNodeLibraries(sourceNode, paths.sidecarDir);
  writeFileSync(paths.launcherPath, launcherScript(), { mode: 0o755 });
  chmodSync(paths.launcherPath, 0o755);
  const bundledRuntimeDependencyCount = bundleRuntimeNodeModules(cwd, paths.nodeModulesPath);

  return {
    ...paths,
    usesBundledNode: true,
    bundledNodeLibraryCount,
    bundledRuntimeDependencyCount,
  };
}

export function defaultTauriTargetTriple(
  platform = process.platform,
  arch = process.arch,
): string {
  if (platform === "darwin" && arch === "arm64") {
    return "aarch64-apple-darwin";
  }
  if (platform === "darwin" && arch === "x64") {
    return "x86_64-apple-darwin";
  }
  throw new Error(`unsupported desktop sidecar target: ${platform}/${arch}`);
}

function launcherScript(): string {
  return [
    "#!/bin/sh",
    "set -eu",
    "SELF_DIR=${0%/*}",
    "if [ \"$SELF_DIR\" = \"$0\" ]; then",
    "  SELF_DIR=.",
    "fi",
    "SELF_DIR=$(CDPATH= cd -- \"$SELF_DIR\" && pwd -P)",
    "PACKAGED_APP_DIR=\"$SELF_DIR/../Resources/dist-node/apps/studio-desktop\"",
    "if [ -d \"$PACKAGED_APP_DIR\" ]; then",
    "  PACKAGED_APP_DIR=$(CDPATH= cd -- \"$PACKAGED_APP_DIR\" && pwd -P)",
    "fi",
    "PACKAGED_SIDECAR_DIR=\"$PACKAGED_APP_DIR/sidecar\"",
    "PACKAGED_ENTRYPOINT=\"$PACKAGED_APP_DIR/src/main.js\"",
    "if [ -x \"$PACKAGED_SIDECAR_DIR/node\" ] && [ -f \"$PACKAGED_ENTRYPOINT\" ]; then",
    "  exec \"$PACKAGED_SIDECAR_DIR/node\" \"$PACKAGED_ENTRYPOINT\" \"$@\"",
    "fi",
    `exec "$SELF_DIR/node" "$SELF_DIR/${entrypointRelative}" "$@"`,
    "",
  ].join("\n");
}

function requireFile(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`missing ${label}: ${filePath}`);
  }
}

function bundleMacOsNodeLibraries(sourceNode: string, sidecarDir: string): number {
  if (process.platform !== "darwin") {
    return 0;
  }
  const sourceNodeDir = path.dirname(sourceNode);
  const candidateDirs = [
    path.join(sourceNodeDir, "..", "lib"),
    sourceNodeDir,
  ];
  const copied = new Set<string>();
  for (const candidateDir of candidateDirs) {
    let entries: string[];
    try {
      entries = readdirSync(candidateDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/^libnode(?:\.[^.]+)*\.dylib$/.test(entry)) {
        continue;
      }
      if (copied.has(entry)) {
        continue;
      }
      const targetPath = path.join(sidecarDir, entry);
      rmSync(targetPath, { force: true });
      copyFileSync(path.join(candidateDir, entry), targetPath);
      copied.add(entry);
    }
  }
  return copied.size;
}

function bundleRuntimeNodeModules(cwd: string, targetNodeModulesPath: string): number {
  const lockPath = path.join(cwd, "package-lock.json");
  requireFile(lockPath, "package-lock.json");
  requireFile(path.join(cwd, "node_modules"), "root node_modules");
  const lock = JSON.parse(readFileSync(lockPath, { encoding: "utf-8" })) as {
    packages?: Record<string, { dev?: boolean; link?: boolean }>;
  };
  const packageEntries = Object.entries(lock.packages ?? {})
    .filter(([packagePath, info]) => (
      packagePath.startsWith("node_modules/")
      && info.dev !== true
      && info.link !== true
    ))
    .map(([packagePath]) => packagePath)
    .sort();
  rmSync(targetNodeModulesPath, { recursive: true, force: true });
  mkdirSync(targetNodeModulesPath, { recursive: true });
  let copied = 0;
  for (const packagePath of packageEntries) {
    const sourcePath = path.join(cwd, packagePath);
    if (!existsSync(sourcePath)) {
      continue;
    }
    cpSync(sourcePath, path.join(targetNodeModulesPath, packagePath.slice("node_modules/".length)), {
      recursive: true,
      errorOnExist: false,
      filter: (source) => !isTypeScriptSourceFile(source),
      force: true,
    });
    copied += 1;
  }
  const copiedTypeScriptSources = sourceTypeScriptFiles(targetNodeModulesPath);
  if (copiedTypeScriptSources.length > 0) {
    throw new Error(`sidecar runtime dependencies include TypeScript sources: ${copiedTypeScriptSources[0]}`);
  }
  return copied;
}

function isTypeScriptSourceFile(filePath: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/.test(filePath) && !/\.d\.ts$/.test(filePath);
}

function sourceTypeScriptFiles(entryPath: string): string[] {
  let stats;
  try {
    stats = statSync(entryPath);
  } catch {
    return [];
  }
  if (stats.isFile()) {
    return isTypeScriptSourceFile(entryPath) ? [entryPath] : [];
  }
  if (!stats.isDirectory()) {
    return [];
  }
  return readdirSync(entryPath).flatMap((entry) => sourceTypeScriptFiles(path.join(entryPath, entry)));
}

function parseCliOptions(args: string[]): { targetTriple?: string } {
  const targetIndex = args.indexOf("--target-triple");
  return {
    targetTriple: targetIndex === -1 ? undefined : args[targetIndex + 1],
  };
}

function isDirectExecution(): boolean {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
}

if (isDirectExecution()) {
  try {
    const summary = bundleStudioDesktopSidecar(parseCliOptions(process.argv.slice(2)));
    if (process.argv.includes("--verify")) {
      const launcher = readFileSync(summary.launcherPath, { encoding: "utf-8" });
      if (!launcher.includes('"$SELF_DIR/node"')) {
        throw new Error("sidecar launcher must execute bundled Node");
      }
    }
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
