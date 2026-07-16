import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bundleStudioDesktopSidecar } from "../apps/studio-desktop/src/sidecar-bundle.js";
import {
  validateStudioDesktopDistribution,
  type DistributionSmokeSummary,
} from "../apps/studio-desktop/src/distribution-smoke.js";
import { currentPacketStatus } from "./helpers/current-packet-status.js";

const root = process.cwd();

test("canonical AgentMesh icon uses the approved Converge design", () => {
  const svg = readFileSync(
    path.join(root, "apps", "studio-desktop", "src-tauri", "icons", "agentmesh.svg"),
    "utf-8",
  );

  for (const fragment of [
    '<rect x="32" y="32" width="960" height="960" rx="232" fill="#F4F5F2"',
    'd="M512 488L272 272" stroke="#4AB7A6" stroke-width="112"',
    'd="M536 496L752 280" stroke="#FFB23E" stroke-width="112"',
    'd="M528 536L752 752" stroke="#F07258" stroke-width="112"',
    'd="M488 536L272 752" stroke="#5A84D6" stroke-width="112"',
    '<circle cx="512" cy="512" r="144" fill="#222925"',
    '<circle cx="512" cy="512" r="56" fill="#F7F8F4"',
  ]) {
    assert.ok(svg.includes(fragment), `missing approved icon fragment: ${fragment}`);
  }
  assert.doesNotMatch(svg, /#141414|<linearGradient|<filter|<text/);
});

test("studio desktop distribution wires the macOS DMG app identity and icons", () => {
  bundleStudioDesktopSidecar({ cwd: root });
  const summary = validateStudioDesktopDistribution({
    cwd: root,
    mode: "dev",
    env: {},
  });

  assert.equal(summary.ok, true);
  assert.deepEqual(summary.warnings, []);
  assert.equal(summary.app.productName, "AgentMesh");
  assert.equal(summary.app.identifier, "dev.agentmesh.studio");
  assert.deepEqual(summary.app.targets, ["app", "dmg"]);
  assert.deepEqual(summary.app.targetArchitectures, ["darwin-aarch64"]);
  assert.deepEqual(summary.app.iconPaths, [
    "apps/studio-desktop/src-tauri/icons/32x32.png",
    "apps/studio-desktop/src-tauri/icons/128x128.png",
    "apps/studio-desktop/src-tauri/icons/128x128@2x.png",
    "apps/studio-desktop/src-tauri/icons/icon.icns",
    "apps/studio-desktop/src-tauri/icons/icon.ico",
  ]);
  assert.equal(summary.shell.decision, "continue-tauri");
  assert.match(summary.shell.sidecarPackaging, /externalBin/);
  assert.match(summary.shell.webviewSmoke, /P3\.1/);
  assert.match(summary.shell.webviewSmoke, /P3\.2/);
  assert.match(summary.shell.webviewSmoke, /launch-token fallback/);
  assert.match(summary.shell.electronFallbackThreshold, /verified blocker/);
  assert.equal(summary.shell.frontendDist, "../shell");
  assert.equal(summary.shell.bootstrapPage, "index.html");
  const tauriConfig = JSON.parse(
    readFileSync(path.join(root, "apps", "studio-desktop", "src-tauri", "tauri.conf.json"), {
      encoding: "utf-8",
    }),
  ) as { bundle?: { macOS?: { infoPlist?: string }; resources?: Record<string, string> } };
  assert.equal(tauriConfig.bundle?.macOS?.infoPlist, "Info.plist");
  assert.match(
    readFileSync(path.join(root, "apps", "studio-desktop", "src-tauri", "Info.plist"), {
      encoding: "utf-8",
    }),
    /NSDocumentsFolderUsageDescription/,
  );
  assert.deepEqual(Object.keys(tauriConfig.bundle?.resources ?? {}).sort(), [
    "../../../dist-node/apps/studio-desktop/runtime-node_modules",
    "../../../dist-node/apps/studio-desktop/sidecar",
    "../../../dist-node/apps/studio-desktop/src",
    "../../../dist-node/apps/studio-web/frontend",
    "../../../dist-node/packages/app-server",
    "../../../dist-node/packages/cli",
    "../../../dist-node/packages/core",
    "../../../dist-node/packages/runtime",
    "../../../dist-node/packages/sdk",
    "../../../dist-node/packages/skills",
    "../../../package.json",
    "../../../packages/skills/agentmesh-skill",
  ]);
  assert.equal(Object.keys(tauriConfig.bundle?.resources ?? {}).includes("../../../dist-node"), false);
});

test("signed distribution smoke is gated by signing, notarization, and updater secrets", () => {
  bundleStudioDesktopSidecar({ cwd: root });
  const blocked = validateStudioDesktopDistribution({
    cwd: root,
    mode: "signed",
    env: {},
  });

  assert.equal(blocked.ok, false);
  assert.match(blocked.issues.join("\n"), /APPLE_SIGNING_IDENTITY/);
  assert.match(blocked.issues.join("\n"), /APPLE_ID/);
  assert.match(blocked.issues.join("\n"), /TAURI_SIGNING_PRIVATE_KEY/);
  assert.doesNotMatch(blocked.issues.join("\n"), /updater pubkey/);

  const dryRun = validateStudioDesktopDistribution({
    cwd: root,
    mode: "signed",
    env: {},
    dryRun: true,
  });

  assert.equal(dryRun.ok, true);
  assert.deepEqual(dryRun.missingEnvironment, [
    "APPLE_SIGNING_IDENTITY",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  ]);
});

test("Tauri shell loads a bundled bootstrap page and owns only sidecar lifecycle", () => {
  const tauriConfig = JSON.parse(
    readFileSync(path.join(root, "apps", "studio-desktop", "src-tauri", "tauri.conf.json"), {
      encoding: "utf-8",
    }),
  ) as {
    build?: { frontendDist?: string };
    app?: { windows?: Array<{ label?: string; url?: string }> };
  };
  const mainWindow = tauriConfig.app?.windows?.[0];

  assert.equal(tauriConfig.build?.frontendDist, "../shell");
  assert.equal(mainWindow?.label, "main");
  assert.equal(mainWindow?.url, "index.html");
  assert.notEqual(mainWindow?.url, "http://127.0.0.1:0");

  const shellHtml = readFileSync(
    path.join(root, "apps", "studio-desktop", "shell", "index.html"),
    { encoding: "utf-8" },
  );
  assert.match(shellHtml, /Starting AgentMesh/);
  assert.doesNotMatch(shellHtml, /AgentMesh Studio|Studio workspace/);

  const cargoToml = readFileSync(
    path.join(root, "apps", "studio-desktop", "src-tauri", "Cargo.toml"),
    { encoding: "utf-8" },
  );
  assert.match(cargoToml, /tauri-plugin-shell/);
  assert.match(cargoToml, /tauri-plugin-updater/);
  assert.match(cargoToml, /tauri-plugin-process/);

  const libRs = readFileSync(
    path.join(root, "apps", "studio-desktop", "src-tauri", "src", "lib.rs"),
    { encoding: "utf-8" },
  );
  assert.match(libRs, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(libRs, /tauri_plugin_process::init\(\)/);

  const capability = JSON.parse(readFileSync(
    path.join(root, "apps", "studio-desktop", "src-tauri", "capabilities", "default.json"),
    "utf-8",
  )) as { description?: string; permissions?: string[] };
  assert.match(capability.description ?? "", /updater/i);
  assert.match(capability.description ?? "", /restart/i);
  assert.equal(capability.permissions?.includes("updater:default"), true);
  assert.equal(capability.permissions?.includes("process:allow-restart"), true);

  const updaterConfig = tauriConfig as typeof tauriConfig & {
    bundle?: { targets?: string[] };
    plugins?: { updater?: { endpoints?: string[]; pubkey?: string } };
  };
  assert.deepEqual(updaterConfig.bundle?.targets, ["app", "dmg"]);
  assert.deepEqual(updaterConfig.plugins?.updater?.endpoints, [
    "https://github.com/jinhx128/agentmesh/releases/latest/download/latest.json",
  ]);
  assert.ok((updaterConfig.plugins?.updater?.pubkey?.length ?? 0) > 40);
  assert.notEqual(updaterConfig.plugins?.updater?.pubkey, "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY");
  assert.match(libRs, /tauri_plugin_shell::init/);
  assert.match(libRs, /\.sidecar\("agentmesh-studio-sidecar"\)/);
  assert.match(libRs, /sidecar_launch_config_from_args\(std::env::args\(\)\)/);
  assert.match(libRs, /command\.current_dir\(current_dir\)/);
  assert.match(libRs, /"--workspace"/);
  assert.match(libRs, /strip_prefix\("--workspace="\)/);
  assert.doesNotMatch(libRs, /\.args\(\["--launch-json"\]\)/);
  assert.match(libRs, /append_pair\("token"/);
  assert.match(libRs, /\.navigate\(/);
  assert.doesNotMatch(
    libRs,
    /packages\/runtime|packet|workflow|status\.json|events\.jsonl|\.agentmesh/,
  );
});

test("sidecar bundle launches with app-bundled Node and no PATH dependency", async () => {
  const bundle = bundleStudioDesktopSidecar({ cwd: root });
  assert.equal(bundle.externalBin, "../../../dist-node/apps/studio-desktop/sidecar/agentmesh-studio-sidecar");
  assert.equal(bundle.targetTriple, "aarch64-apple-darwin");
  assert.equal(bundle.entrypointRelative, "../src/main.js");
  assert.equal(bundle.usesBundledNode, true);
  const expectedMacOsNodeLibraries = macOsRpathLibnodeNames(process.execPath);
  for (const libraryName of expectedMacOsNodeLibraries) {
    const libraryPath = path.join(bundle.sidecarDir, libraryName);
    assert.equal(existsSync(libraryPath), true);
    assert.notEqual(statSync(libraryPath).mode & 0o200, 0, `${libraryName} must be owner-writable`);
  }
  if (expectedMacOsNodeLibraries.length > 0) {
    assert.equal(bundle.bundledNodeLibraryCount >= expectedMacOsNodeLibraries.length, true);
  }
  assert.equal(bundle.nodeModulesPath, path.join(
    root,
    "dist-node",
    "apps",
    "studio-desktop",
    "runtime-node_modules",
  ));
  assert.equal(bundle.bundledRuntimeDependencyCount > 0, true);

  const launcher = readFileSync(bundle.launcherPath, { encoding: "utf-8" });
  assert.match(launcher, /\$SELF_DIR\/node/);
  assert.match(launcher, /\$SELF_DIR\/\.\.\/src\/main\.js/);
  assert.match(launcher, /Resources\/dist-node\/apps\/studio-desktop/);
  assert.doesNotMatch(launcher, /env node|pnpm|npx|agentmesh /);
  assert.equal(readFileSync(path.join(bundle.nodeModulesPath, "zod", "package.json"), "utf-8").includes('"name": "zod"'), true);
  assert.deepEqual(sourceTypeScriptFiles(bundle.nodeModulesPath), []);

  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-sidecar-bundle-"));
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const runDir = path.join(workspace, ".agentmesh", "runs", "sidecar-bundle-run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "status.json"),
    `${JSON.stringify(currentPacketStatus({
      run_id: "sidecar-bundle-run",
      status: "created",
      workflow: "sidecar-bundle-test",
      stages: ["plan"],
      completed_stages: [],
      stage_assignments: {
        plan: ["current"],
      },
    }), null, 2)}\n`,
  );
  writeFileSync(path.join(runDir, "events.jsonl"), "");
  writeFileSync(path.join(runDir, "artifacts.toml"), "schema_version = 1\n");
  mkdirSync(path.join(workspace, "empty-path"));

  const launch = await launchSidecar(bundle.launcherPath, [
    "--launch-json",
    "--workspace",
    workspace,
  ], {
    PATH: path.join(workspace, "empty-path"),
  });
  test.after(() => {
    if (launch.child.exitCode === null) {
      launch.child.kill("SIGTERM");
    }
  });

  assert.match(launch.ready.webview_url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.doesNotMatch(JSON.stringify(launch.ready), /sidecar-launch-token/);
  assert.deepEqual(launch.child.spawnargs, [
    bundle.launcherPath,
    "--launch-json",
    "--workspace",
    workspace,
  ]);
  const response = await fetch(`${launch.ready.server_url}/api/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "attach",
      run_id: "sidecar-bundle-run",
      stage: "plan",
      text: "sidecar bundle attach",
    }),
  });
  assert.equal(response.status, 401);

  const queryToken = await fetch(`${launch.ready.server_url}/api/mutations?token=${launch.token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "attach",
      run_id: "sidecar-bundle-run",
      stage: "plan",
      text: "sidecar bundle attach",
    }),
  });
  assert.equal(queryToken.status, 401);

  const authorized = await fetch(`${launch.ready.server_url}/api/mutations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `agentmesh_studio_token=${launch.token}`,
    },
    body: JSON.stringify({
      action: "attach",
      run_id: "sidecar-bundle-run",
      stage: "plan",
      text: "sidecar bundle attach",
    }),
  });
  assert.equal(authorized.status, 200);
  const result = await authorized.json() as {
    command: string[];
    stdout: string;
  };
  assert.deepEqual(result.command, [
    "runtime",
    "flow",
    "attach",
    "sidecar-bundle-run",
    "--stage",
    "plan",
    "--text",
    "sidecar bundle attach",
  ]);
  assert.match(result.stdout, /Attached:/);

  launch.child.stdin?.end();
  const exit = await waitForChildExit(launch.child, 3000);
  assert.equal(exit.code, 0);
  assert.equal(exit.signal, null);
});

test("sidecar launcher resolves packaged app resources layout", () => {
  const bundle = bundleStudioDesktopSidecar({ cwd: root });
  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-packaged-sidecar-"));
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  const macosDir = path.join(workspace, "AgentMesh.app", "Contents", "MacOS");
  const resourcesDir = path.join(workspace, "AgentMesh.app", "Contents", "Resources");
  const packagedSidecarDir = path.join(resourcesDir, "dist-node", "apps", "studio-desktop", "sidecar");
  const packagedEntrypoint = path.join(
    resourcesDir,
    "dist-node",
    "apps",
    "studio-desktop",
    "src",
    "main.js",
  );
  const packagedNode = path.join(packagedSidecarDir, "node");
  const packagedLauncher = path.join(macosDir, "agentmesh-studio-sidecar");
  mkdirSync(macosDir, { recursive: true });
  mkdirSync(packagedSidecarDir, { recursive: true });
  mkdirSync(path.dirname(packagedEntrypoint), { recursive: true });
  copyFileSync(bundle.launcherPath, packagedLauncher);
  chmodSync(packagedLauncher, 0o755);
  writeFileSync(packagedEntrypoint, "");
  writeFileSync(
    packagedNode,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$0\"",
      "printf '%s\\n' \"$1\"",
      "printf '%s\\n' \"$2\"",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  const result = spawnSync(packagedLauncher, ["--launch-json"], {
    encoding: "utf-8",
    env: { PATH: path.join(workspace, "empty-path") },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    realpathSync(packagedNode),
    realpathSync(packagedEntrypoint),
    "--launch-json",
  ]);
});

test("update metadata targets app-managed runtime without changing the npm CLI channel", () => {
  bundleStudioDesktopSidecar({ cwd: root });
  const summary = validateStudioDesktopDistribution({
    cwd: root,
    mode: "metadata",
    env: {},
  }) as DistributionSmokeSummary;

  assert.equal(summary.ok, true);
  assert.equal(summary.runtime.appManaged, true);
  assert.equal(summary.runtime.npmCliSharedInstall, false);
  assert.deepEqual(Object.keys(summary.updates.channels), ["stable", "beta"]);
  assert.equal(summary.updates.metadata.version, "0.1.11");
  assert.ok(summary.updates.metadata.platforms["darwin-aarch64"].url.endsWith(".app.tar.gz"));
  assert.match(summary.updates.metadata.platforms["darwin-aarch64"].url, /github\.com\/jinhx128\/agentmesh/);
  assert.doesNotMatch(summary.updates.metadata.platforms["darwin-aarch64"].url, /github\.com\/agentmesh\/agentmesh/);
  assert.ok(summary.updates.metadata.platforms["darwin-aarch64"].signature.length > 0);

  const tauriConfig = readFileSync(
    path.join(root, "apps", "studio-desktop", "src-tauri", "tauri.conf.json"),
    { encoding: "utf-8" },
  );
  const stableFeed = readFileSync(
    path.join(root, "apps", "studio-desktop", "distribution", "latest.stable.darwin-aarch64.example.json"),
    { encoding: "utf-8" },
  );
  const betaFeed = readFileSync(
    path.join(root, "apps", "studio-desktop", "distribution", "latest.beta.darwin-aarch64.example.json"),
    { encoding: "utf-8" },
  );
  for (const source of [tauriConfig, stableFeed, betaFeed]) {
    assert.match(source, /github\.com\/jinhx128\/agentmesh/);
    assert.doesNotMatch(source, /github\.com\/agentmesh\/agentmesh/);
  }
});

async function launchSidecar(
  launcherPath: string,
  args: string[],
  env: Record<string, string>,
): Promise<{
  child: ReturnType<typeof spawn>;
  token: string;
  ready: {
    event: string;
    server_url: string;
    webview_url: string;
  };
}> {
  const child = spawn(launcherPath, args, {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const token = "sidecar-launch-token";
  child.stdin?.write(`${JSON.stringify({
    schema_version: 1,
    studio_token: token,
  })}\n`);
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`timed out waiting for sidecar readiness: ${stderr}`));
    }, 15000);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`sidecar exited before readiness: code=${code} signal=${signal} stderr=${stderr}`));
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const line = stdout.split("\n").find((candidate) => candidate.trim().length > 0);
      if (!line) {
        return;
      }
      clearTimeout(timeout);
      child.removeAllListeners("exit");
      const ready = JSON.parse(line) as {
        event: string;
        server_url: string;
        webview_url: string;
      };
      resolve({
        child,
        ready,
        token,
      });
    });
  });
}

function waitForChildExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      reject(new Error(`sidecar did not exit within ${timeoutMs}ms after stdin closed`));
    }, timeoutMs);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    };
    child.once("exit", onExit);
  });
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

function macOsRpathLibnodeNames(nodePath: string): string[] {
  if (process.platform !== "darwin") {
    return [];
  }
  const result = spawnSync("otool", ["-L", nodePath], { encoding: "utf-8" });
  if (result.status !== 0) {
    return [];
  }
  return Array.from(result.stdout.matchAll(/@rpath\/(libnode[^\s]+\.dylib)/g), (match) => match[1]);
}

function isTypeScriptSourceFile(filePath: string): boolean {
  return /\.(?:ts|tsx|mts|cts)$/.test(filePath) && !/\.d\.ts$/.test(filePath);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
