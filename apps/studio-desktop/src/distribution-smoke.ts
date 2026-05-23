import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { studioDesktopSidecarPaths } from "./sidecar-bundle.js";

export type DistributionSmokeMode = "dev" | "signed" | "metadata";

export interface DistributionSmokeOptions {
  cwd?: string;
  mode: DistributionSmokeMode;
  env?: Record<string, string | undefined>;
  dryRun?: boolean;
}

export interface DistributionSmokeSummary {
  ok: boolean;
  mode: DistributionSmokeMode;
  dryRun: boolean;
  issues: string[];
  warnings: string[];
  missingEnvironment: string[];
  app: {
    productName: string;
    identifier: string;
    targets: string[];
    targetArchitectures: string[];
    iconPaths: string[];
    minimumSystemVersion: string;
  };
  shell: {
    decision: string;
    sidecarPackaging: string;
    webviewSmoke: string;
    electronFallbackThreshold: string;
    frontendDist: string;
    bootstrapPage: string;
  };
  updates: {
    channels: Record<string, { endpoint: string; metadataPath: string }>;
    metadata: UpdateMetadata;
  };
  runtime: {
    appManaged: boolean;
    entrypoint: string;
    npmCliSharedInstall: boolean;
  };
  sidecar: {
    externalBin: string;
    targetTriple: string;
    launcherPath: string;
    nodePath: string;
    nodeModulesPath: string;
    entrypointRelative: string;
    usesBundledNode: boolean;
  };
}

interface DistributionManifest {
  schema_version: number;
  app: {
    product_name: string;
    bundle_identifier: string;
    targets: string[];
    target_architectures: string[];
    icon_paths: string[];
    minimum_system_version: string;
  };
  shell_spike: {
    decision: string;
    sidecar_packaging: string;
    webview_smoke: string;
    electron_fallback_threshold: string;
  };
  signing: {
    environment: string[];
    secret_policy: string;
  };
  updates: {
    channels: Record<string, { endpoint: string; metadata_path: string }>;
    artifacts: string[];
  };
  runtime: {
    app_managed: boolean;
    entrypoint: string;
    npm_cli_shared_install: boolean;
  };
  agent_integrations?: {
    command_line_tool?: string;
    skill_install?: string;
    skill_targets?: string[];
  };
}

interface TauriConfig {
  productName?: string;
  identifier?: string;
  build?: {
    frontendDist?: string;
  };
  app?: {
    windows?: Array<{
      label?: string;
      url?: string;
    }>;
  };
  bundle?: {
    targets?: string[];
    icon?: string[];
    createUpdaterArtifacts?: boolean;
    externalBin?: string[];
    resources?: Record<string, string> | string[];
    macOS?: {
      minimumSystemVersion?: string;
      entitlements?: string;
      infoPlist?: string;
    };
  };
  plugins?: {
    updater?: {
      active?: boolean;
      endpoints?: string[];
      pubkey?: string;
    };
  };
}

interface PackageJson {
  scripts?: Record<string, string>;
}

interface UpdateMetadata {
  version: string;
  notes?: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}

const manifestPath = "apps/studio-desktop/distribution/macos.json";
const tauriConfigPath = "apps/studio-desktop/src-tauri/tauri.conf.json";
const tauriInfoPlistPath = "apps/studio-desktop/src-tauri/Info.plist";
const packageJsonPath = "package.json";
const updaterPubkeyPlaceholder = "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY";

export function validateStudioDesktopDistribution(
  options: DistributionSmokeOptions,
): DistributionSmokeSummary {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const issues: string[] = [];
  const warnings: string[] = [];
  const manifest = readJsonFile<DistributionManifest>(cwd, manifestPath, issues);
  const tauriConfig = readJsonFile<TauriConfig>(cwd, tauriConfigPath, issues);
  const packageJson = readJsonFile<PackageJson>(cwd, packageJsonPath, issues);

  const metadataPath = manifest?.updates.channels.stable?.metadata_path
    ?? "apps/studio-desktop/distribution/latest.stable.darwin-aarch64.example.json";
  const updateMetadata = readJsonFile<UpdateMetadata>(cwd, metadataPath, issues);

  const app = {
    productName: manifest?.app.product_name ?? "",
    identifier: manifest?.app.bundle_identifier ?? "",
    targets: manifest?.app.targets ?? [],
    targetArchitectures: manifest?.app.target_architectures ?? [],
    iconPaths: manifest?.app.icon_paths ?? [],
    minimumSystemVersion: manifest?.app.minimum_system_version ?? "",
  };
  const shell = {
    decision: manifest?.shell_spike?.decision ?? "",
    sidecarPackaging: manifest?.shell_spike?.sidecar_packaging ?? "",
    webviewSmoke: manifest?.shell_spike?.webview_smoke ?? "",
    electronFallbackThreshold: manifest?.shell_spike?.electron_fallback_threshold ?? "",
    frontendDist: tauriConfig?.build?.frontendDist ?? "",
    bootstrapPage: tauriConfig?.app?.windows?.find((window) => window.label === "main")?.url ?? "",
  };
  const updates = {
    channels: normalizeChannels(manifest?.updates.channels),
    metadata: updateMetadata ?? {
      version: "",
      pub_date: "",
      platforms: {},
    },
  };
  const runtime = {
    appManaged: manifest?.runtime.app_managed ?? false,
    entrypoint: manifest?.runtime.entrypoint ?? "",
    npmCliSharedInstall: manifest?.runtime.npm_cli_shared_install ?? true,
  };
  const sidecarPaths = studioDesktopSidecarPaths({ cwd });
  const sidecar = {
    externalBin: sidecarPaths.externalBin,
    targetTriple: sidecarPaths.targetTriple,
    launcherPath: path.relative(cwd, sidecarPaths.launcherPath),
    nodePath: path.relative(cwd, sidecarPaths.nodePath),
    nodeModulesPath: path.relative(cwd, sidecarPaths.nodeModulesPath),
    entrypointRelative: sidecarPaths.entrypointRelative,
    usesBundledNode: true,
  };

  if (manifest?.schema_version !== 1) {
    issues.push(`${manifestPath} must declare schema_version 1`);
  }
  requireEqual(issues, "Tauri productName", tauriConfig?.productName, app.productName);
  requireEqual(issues, "Tauri identifier", tauriConfig?.identifier, app.identifier);
  requireArrayIncludes(issues, "Tauri bundle.targets", tauriConfig?.bundle?.targets, "dmg");
  requireArrayIncludes(issues, "desktop target_architectures", app.targetArchitectures, "darwin-aarch64");
  requireEqual(issues, "desktop shell decision", shell.decision, "continue-tauri");
  requireTextIncludes(issues, "desktop sidecar packaging", shell.sidecarPackaging, "externalBin");
  requireTextIncludes(issues, "desktop webview smoke", shell.webviewSmoke, "WKWebView");
  requireTextIncludes(
    issues,
    "desktop Electron fallback threshold",
    shell.electronFallbackThreshold,
    "verified blocker",
  );
  requireEqual(issues, "Tauri build.frontendDist", shell.frontendDist, "../shell");
  requireEqual(issues, "Tauri main window URL", shell.bootstrapPage, "index.html");
  requireFile(issues, cwd, "apps/studio-desktop/shell/index.html");
  requireArrayIncludes(
    issues,
    "Tauri bundle.externalBin",
    tauriConfig?.bundle?.externalBin,
    sidecar.externalBin,
  );
  for (const resource of [
    "dist-node/apps/studio-desktop/sidecar",
    "dist-node/apps/studio-desktop/src",
    "dist-node/apps/studio-web/frontend",
    "dist-node/packages/app-server",
    "dist-node/packages/cli",
    "dist-node/packages/core",
    "dist-node/packages/runtime",
    "dist-node/packages/sdk",
    "dist-node/packages/skills",
    "dist-node/apps/studio-desktop/runtime-node_modules",
    "package.json",
    "packages/skills/agentmesh-skill",
  ]) {
    requireResourceIncludes(issues, "Tauri bundle.resources", tauriConfig?.bundle?.resources, tauriResourceSource(resource));
  }
  rejectResourceIncludes(issues, "Tauri bundle.resources", tauriConfig?.bundle?.resources, tauriResourceSource("dist-node"));
  validateAgentIntegrations(issues, manifest);
  validateSidecarBundle(issues, cwd, sidecar);
  requireEqual(
    issues,
    "Tauri bundle.createUpdaterArtifacts",
    tauriConfig?.bundle?.createUpdaterArtifacts,
    true,
  );
  requireEqual(
    issues,
    "Tauri macOS minimumSystemVersion",
    tauriConfig?.bundle?.macOS?.minimumSystemVersion,
    app.minimumSystemVersion,
  );
  requireFile(issues, cwd, path.join("apps/studio-desktop/src-tauri", tauriConfig?.bundle?.macOS?.entitlements ?? ""));
  requireEqual(
    issues,
    "Tauri macOS infoPlist",
    tauriConfig?.bundle?.macOS?.infoPlist,
    "Info.plist",
  );
  requireFile(issues, cwd, path.join("apps/studio-desktop/src-tauri", tauriConfig?.bundle?.macOS?.infoPlist ?? ""));
  validateMacOsPrivacyUsageDescriptions(issues, cwd, tauriConfig?.bundle?.macOS?.infoPlist ?? tauriInfoPlistPath);

  for (const iconPath of app.iconPaths) {
    requireFile(issues, cwd, iconPath);
    requireArrayIncludes(
      issues,
      "Tauri bundle.icon",
      tauriConfig?.bundle?.icon,
      path.relative("apps/studio-desktop/src-tauri", iconPath),
    );
  }

  requireEqual(issues, "updater active", tauriConfig?.plugins?.updater?.active, true);
  requireArrayIncludes(
    issues,
    "updater stable endpoint",
    tauriConfig?.plugins?.updater?.endpoints,
    updates.channels.stable?.endpoint ?? "",
  );
  validateMetadata(issues, updates.metadata);
  validatePackageScripts(issues, packageJson?.scripts);
  validateRuntime(issues, cwd, runtime);

  const signingEnvironment = manifest?.signing.environment ?? [];
  const missingEnvironment = signingEnvironment.filter((name) => !options.env?.[name]);
  const signedIssues = signedDistributionIssues({
    missingEnvironment,
    pubkey: tauriConfig?.plugins?.updater?.pubkey,
  });
  if (options.mode === "signed") {
    if (options.dryRun) {
      warnings.push(...signedIssues);
    } else {
      issues.push(...signedIssues);
    }
  }
  if (manifest?.signing.secret_policy !== "env-only") {
    issues.push("signing secret_policy must be env-only");
  }

  return {
    ok: issues.length === 0,
    mode: options.mode,
    dryRun: options.dryRun ?? false,
    issues,
    warnings,
    missingEnvironment,
    app,
    shell,
    updates,
    runtime,
    sidecar,
  };
}

function readJsonFile<T>(cwd: string, relativePath: string, issues: string[]): T | undefined {
  const absolutePath = path.join(cwd, relativePath);
  if (!existsSync(absolutePath)) {
    issues.push(`missing ${relativePath}`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf-8")) as T;
  } catch (error) {
    issues.push(`invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function normalizeChannels(
  channels: DistributionManifest["updates"]["channels"] | undefined,
): Record<string, { endpoint: string; metadataPath: string }> {
  const normalized: Record<string, { endpoint: string; metadataPath: string }> = {};
  for (const [name, channel] of Object.entries(channels ?? {})) {
    normalized[name] = {
      endpoint: channel.endpoint,
      metadataPath: channel.metadata_path,
    };
  }
  return normalized;
}

function requireEqual(
  issues: string[],
  label: string,
  actual: unknown,
  expected: unknown,
): void {
  if (actual !== expected) {
    issues.push(`${label} must be ${String(expected)}`);
  }
}

function requireArrayIncludes(
  issues: string[],
  label: string,
  values: string[] | undefined,
  expected: string,
): void {
  if (!expected || !values?.includes(expected)) {
    issues.push(`${label} must include ${expected}`);
  }
}

function requireTextIncludes(
  issues: string[],
  label: string,
  value: string | undefined,
  expected: string,
): void {
  if (!value?.includes(expected)) {
    issues.push(`${label} must include ${expected}`);
  }
}

function requireFile(issues: string[], cwd: string, relativePath: string): void {
  if (!relativePath || !existsSync(path.join(cwd, relativePath))) {
    issues.push(`missing ${relativePath}`);
  }
}

function requireFileTextIncludes(
  issues: string[],
  cwd: string,
  relativePath: string,
  expected: string,
): void {
  const absolutePath = path.join(cwd, relativePath);
  if (!existsSync(absolutePath)) {
    issues.push(`missing ${relativePath}`);
    return;
  }
  const content = readFileSync(absolutePath, "utf-8");
  if (!content.includes(expected)) {
    issues.push(`${relativePath} must include ${expected}`);
  }
}

function validateMacOsPrivacyUsageDescriptions(
  issues: string[],
  cwd: string,
  infoPlistPath: string,
): void {
  const relativePath = infoPlistPath.includes("/")
    ? infoPlistPath
    : path.join("apps/studio-desktop/src-tauri", infoPlistPath);
  for (const key of [
    "NSDocumentsFolderUsageDescription",
    "NSDesktopFolderUsageDescription",
    "NSDownloadsFolderUsageDescription",
    "NSNetworkVolumesUsageDescription",
    "NSRemovableVolumesUsageDescription",
    "NSFileProviderDomainUsageDescription",
  ]) {
    requireFileTextIncludes(issues, cwd, relativePath, `<key>${key}</key>`);
  }
}

function requireResourceIncludes(
  issues: string[],
  label: string,
  resources: Record<string, string> | string[] | undefined,
  expected: string,
): void {
  if (Array.isArray(resources)) {
    if (!resources.includes(expected)) {
      issues.push(`${label} must include ${expected}`);
    }
    return;
  }
  if (!resources || !(expected in resources)) {
    issues.push(`${label} must include ${expected}`);
  }
}

function rejectResourceIncludes(
  issues: string[],
  label: string,
  resources: Record<string, string> | string[] | undefined,
  rejected: string,
): void {
  if (Array.isArray(resources)) {
    if (resources.includes(rejected)) {
      issues.push(`${label} must not include ${rejected}`);
    }
    return;
  }
  if (resources && rejected in resources) {
    issues.push(`${label} must not include ${rejected}`);
  }
}

function tauriResourceSource(relativePath: string): string {
  return `../../../${relativePath}`;
}

function validateSidecarBundle(
  issues: string[],
  cwd: string,
  sidecar: DistributionSmokeSummary["sidecar"],
): void {
  requireFile(issues, cwd, sidecar.launcherPath);
  requireFile(issues, cwd, sidecar.nodePath);
  requireFile(issues, cwd, path.join(sidecar.nodeModulesPath, "zod/package.json"));
  requireFile(issues, cwd, path.join(sidecar.nodeModulesPath, "smol-toml/package.json"));
  requireFile(issues, cwd, path.join(sidecar.nodeModulesPath, "@modelcontextprotocol/sdk/package.json"));
  if (sidecar.entrypointRelative !== "../src/main.js") {
    issues.push("desktop sidecar launcher must use the relative desktop host entrypoint");
  }
  const launcherPath = path.join(cwd, sidecar.launcherPath);
  const launcher = existsSync(launcherPath) ? readFileSync(launcherPath, "utf-8") : "";
  if (!launcher.includes('"$SELF_DIR/node"')) {
    issues.push("desktop sidecar launcher must execute bundled Node");
  }
  if (!launcher.includes('"$SELF_DIR/../src/main.js"')) {
    issues.push("desktop sidecar launcher must use the bundled desktop host entrypoint");
  }
  if (/env node|pnpm|npx|agentmesh /.test(launcher)) {
    issues.push("desktop sidecar launcher must not rely on PATH-visible Node or agentmesh");
  }
  const typescriptSources = sourceTypeScriptFiles(path.join(cwd, sidecar.nodeModulesPath));
  if (typescriptSources.length > 0) {
    issues.push(`desktop sidecar runtime dependencies must not include TypeScript sources: ${
      typescriptSources.slice(0, 3).map((filePath) => path.relative(cwd, filePath)).join(", ")
    }`);
  }
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

function isTypeScriptSourceFile(filePath: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/.test(filePath) && !/\.d\.ts$/.test(filePath);
}

function validateMetadata(issues: string[], metadata: UpdateMetadata): void {
  const platform = metadata.platforms["darwin-aarch64"];
  if (!metadata.version) {
    issues.push("update metadata must include version");
  }
  if (!metadata.pub_date) {
    issues.push("update metadata must include pub_date");
  }
  if (!platform?.url.endsWith(".app.tar.gz")) {
    issues.push("darwin-aarch64 update URL must point to an app archive");
  }
  if (!platform?.signature) {
    issues.push("darwin-aarch64 update metadata must include signature");
  }
}

function validatePackageScripts(issues: string[], scripts: Record<string, string> | undefined): void {
  const requiredScripts = [
    "studio-desktop:package:dev",
    "studio-desktop:package:signed",
    "studio-desktop:update:metadata",
  ];
  for (const script of requiredScripts) {
    if (!scripts?.[script]?.includes("distribution-smoke.js")) {
      issues.push(`package.json scripts.${script} must run distribution-smoke.js`);
    }
  }
  for (const script of [
    "studio-desktop:package:dev",
    "studio-desktop:package:signed",
    "studio-desktop:update:metadata",
  ]) {
    if (!scripts?.[script]?.includes("sidecar-bundle.js")) {
      issues.push(`package.json scripts.${script} must verify sidecar-bundle.js`);
    }
  }
}

function validateRuntime(
  issues: string[],
  cwd: string,
  runtime: DistributionSmokeSummary["runtime"],
): void {
  if (!runtime.appManaged) {
    issues.push("desktop runtime must be app-managed");
  }
  if (runtime.npmCliSharedInstall) {
    issues.push("desktop runtime must not share the npm/global CLI install");
  }
  requireFile(issues, cwd, runtime.entrypoint);
}

function validateAgentIntegrations(
  issues: string[],
  manifest: DistributionManifest | undefined,
): void {
  const integrations = manifest?.agent_integrations;
  requireTextIncludes(
    issues,
    "desktop command-line tool integration",
    integrations?.command_line_tool,
    "user-confirmed PATH wrapper",
  );
  requireTextIncludes(
    issues,
    "desktop skill integration",
    integrations?.skill_install,
    "user-selected targets",
  );
  for (const target of ["codex", "cursor", "antigravity", "opencode", "copilot", "claude"]) {
    requireArrayIncludes(issues, "desktop skill_targets", integrations?.skill_targets, target);
  }
}

function signedDistributionIssues(options: {
  missingEnvironment: string[];
  pubkey: string | undefined;
}): string[] {
  const issues: string[] = [];
  if (options.missingEnvironment.length > 0) {
    issues.push(`missing signing/notarization environment: ${options.missingEnvironment.join(", ")}`);
  }
  if (!options.pubkey || options.pubkey === updaterPubkeyPlaceholder) {
    issues.push("updater pubkey must be replaced before signed distribution");
  }
  return issues;
}

function parseCliOptions(args: string[]): DistributionSmokeOptions {
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex === -1 ? "dev" : args[modeIndex + 1];
  if (mode !== "dev" && mode !== "signed" && mode !== "metadata") {
    throw new Error(`invalid --mode: ${mode ?? ""}`);
  }
  return {
    mode,
    dryRun: args.includes("--dry-run"),
  };
}

function isDirectExecution(): boolean {
  return process.argv[1] !== undefined
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const summary = validateStudioDesktopDistribution(options);
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
