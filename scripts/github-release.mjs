import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  createUpdaterMetadata,
  normalizePackedTarballAsset,
  releaseTarballName,
  updaterAssetNames,
} from "./github-release-assets.mjs";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8"));
const version = packageJson.version;
const tag = `v${version}`;
const repo = args.repo ?? process.env.GITHUB_REPOSITORY ?? "jinhx128/agentmesh";
const distDir = path.join(root, "dist-release");
const updaterAssets = updaterAssetNames(version);
const assets = [
  releaseTarballName(version),
  `AgentMesh_${version}_aarch64.dmg`,
  updaterAssets.archive,
  updaterAssets.signature,
  "latest.json",
  `agentmesh-skill-${version}.md`,
  "SHA256SUMS",
];

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.verifyOnly) {
  verifyRelease({ compareLocal: args.compareLocal });
  process.exit(0);
}

if (!args.prepareOnly) {
  assertCommand("gh", ["--version"], "GitHub CLI is required to create or verify releases.");
  assertTagExists();
  assertReleaseWorkspace();
}

if (!args.skipBuild) {
  const signingEnv = updaterSigningEnvironment();
  run("npm", ["run", "build"]);
  run("npm", ["run", "studio-desktop:package:dev"]);
  run("cargo", [
    "tauri",
    "build",
    "--config",
    "apps/studio-desktop/src-tauri/tauri.conf.json",
    "--bundles",
    "app,dmg",
    "--debug",
  ], { env: signingEnv });
}

prepareAssets();

if (args.prepareOnly) {
  console.log(`Prepared release assets for ${tag} in dist-release/.`);
  process.exit(0);
}

publishRelease();
verifyRelease({ compareLocal: true });

function prepareAssets() {
  mkdirSync(distDir, { recursive: true });
  console.log("$ npm pack --pack-destination dist-release --json");
  const npmPackOutput = execFileSync("npm", ["pack", "--pack-destination", "dist-release", "--json"], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  normalizePackedTarballAsset({ distDir, npmPackOutput, version });

  const dmgName = `AgentMesh_${version}_aarch64.dmg`;
  const dmgSource = path.join(
    root,
    "apps/studio-desktop/src-tauri/target/debug/bundle/dmg",
    dmgName,
  );
  const dmgTarget = path.join(distDir, dmgName);
  if (!existsSync(dmgSource)) {
    throw new Error(`Missing DMG ${dmgSource}. Run without --skip-build or build the DMG first.`);
  }
  copyFileSync(dmgSource, dmgTarget);

  const updaterSource = path.join(
    root,
    "apps/studio-desktop/src-tauri/target/debug/bundle/macos/AgentMesh.app.tar.gz",
  );
  const updaterSignatureSource = `${updaterSource}.sig`;
  assertFile(updaterSource);
  assertFile(updaterSignatureSource);
  copyFileSync(updaterSource, path.join(distDir, updaterAssets.archive));
  copyFileSync(updaterSignatureSource, path.join(distDir, updaterAssets.signature));

  const signature = readFileSync(path.join(distDir, updaterAssets.signature), "utf-8");
  const notes = args.notesFile && existsSync(args.notesFile)
    ? readFileSync(args.notesFile, "utf-8").trim()
    : `AgentMesh v${version}`;
  const updaterMetadata = createUpdaterMetadata({
    version,
    signature,
    pubDate: new Date().toISOString(),
    repo,
    notes,
  });
  writeFileSync(path.join(distDir, "latest.json"), `${JSON.stringify(updaterMetadata, null, 2)}\n`);

  const skillMarkdown = execFileSync(
    process.execPath,
    [
      path.join(root, "dist-node/packages/cli/src/cli.js"),
      "skill",
      "export",
      "--format",
      "markdown",
    ],
    { cwd: root, encoding: "utf-8" },
  );
  writeFileSync(path.join(distDir, `agentmesh-skill-${version}.md`), skillMarkdown);

  const checksumAssets = assets.filter((asset) => asset !== "SHA256SUMS");
  for (const asset of checksumAssets) {
    assertFile(path.join(distDir, asset));
  }
  const sums = checksumAssets.map((asset) => `${sha256(path.join(distDir, asset))}  dist-release/${asset}`);
  writeFileSync(path.join(distDir, "SHA256SUMS"), `${sums.join("\n")}\n`);

  for (const asset of assets) {
    const assetPath = path.join(distDir, asset);
    assertFile(assetPath);
    console.log(`${asset}\t${statSync(assetPath).size}`);
  }
}

function publishRelease() {
  const assetPaths = assets.map((asset) => path.join("dist-release", asset));
  if (releaseExists()) {
    run("gh", ["release", "upload", tag, ...assetPaths, "--repo", repo, "--clobber"]);
    return;
  }

  const notesFile = args.notesFile ?? writeDefaultNotes();
  run("gh", [
    "release",
    "create",
    tag,
    ...assetPaths,
    "--repo",
    repo,
    "--title",
    `AgentMesh ${tag}`,
    "--notes-file",
    notesFile,
    "--verify-tag",
  ]);
}

function verifyRelease({ compareLocal }) {
  assertCommand("gh", ["--version"], "GitHub CLI is required to verify releases.");
  assertTagExists();
  const release = readRelease();
  const latestReleaseTag = readLatestReleaseTag();
  const remoteAssets = new Map(release.assets.map((asset) => [asset.name, asset]));
  const expectedDigests = compareLocal ? readExpectedDigests() : new Map();
  const failures = [];

  if (release.tagName !== tag) {
    failures.push(`expected tag ${tag}, got ${release.tagName}`);
  }
  if (release.isDraft) {
    failures.push(`${tag} is still a draft release`);
  }
  if (release.isPrerelease) {
    failures.push(`${tag} is marked as prerelease`);
  }
  if (latestReleaseTag !== tag) {
    failures.push(`GitHub latest release is ${latestReleaseTag}, expected ${tag}`);
  }
  for (const asset of assets) {
    const remote = remoteAssets.get(asset);
    if (!remote) {
      failures.push(`missing release asset ${asset}`);
      continue;
    }
    if (remote.state !== "uploaded") {
      failures.push(`${asset} state is ${remote.state}`);
    }
    if (remote.size <= 0) {
      failures.push(`${asset} size is ${remote.size}`);
    }
    const expectedDigest = expectedDigests.get(asset);
    if (expectedDigest && remote.digest && remote.digest !== `sha256:${expectedDigest}`) {
      failures.push(`${asset} digest mismatch: ${remote.digest} != sha256:${expectedDigest}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Release verification failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }
  console.log(`Verified ${release.url}`);
}

function readRelease() {
  const output = execFileSync(
    "gh",
    [
      "release",
      "view",
      tag,
      "--repo",
      repo,
      "--json",
      "tagName,name,isDraft,isPrerelease,publishedAt,url,assets",
    ],
    { cwd: root, encoding: "utf-8" },
  );
  return JSON.parse(output);
}

function readLatestReleaseTag() {
  return execFileSync(
    "gh",
    ["api", `repos/${repo}/releases/latest`, "--jq", ".tag_name"],
    { cwd: root, encoding: "utf-8" },
  ).trim();
}

function releaseExists() {
  const result = spawnSync("gh", ["release", "view", tag, "--repo", repo], {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.status === 0) {
    return true;
  }
  if (`${result.stderr}${result.stdout}`.includes("release not found")) {
    return false;
  }
  throw new Error(result.stderr || result.stdout || `gh release view exited with ${result.status}`);
}

function readExpectedDigests() {
  const digestMap = new Map();
  for (const asset of assets) {
    const assetPath = path.join(distDir, asset);
    if (existsSync(assetPath)) {
      digestMap.set(asset, sha256(assetPath));
    }
  }
  return digestMap;
}

function assertTagExists() {
  assertCommand("git", ["rev-parse", "--verify", tag], `Missing local tag ${tag}.`);
  const remote = execFileSync("git", ["ls-remote", "--tags", "origin", tag], {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  if (!remote) {
    throw new Error(`Missing remote tag ${tag}. Push it before creating the GitHub Release.`);
  }
}

function assertReleaseWorkspace() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  const tagCommit = execFileSync("git", ["rev-parse", `${tag}^{}`], {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  if (head !== tagCommit) {
    throw new Error(`Current HEAD ${head} does not match ${tag} commit ${tagCommit}.`);
  }

  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  if (status && !args.allowDirty) {
    throw new Error("Working tree is dirty. Commit, stash, or pass --allow-dirty intentionally.");
  }
}

function writeDefaultNotes() {
  const notesPath = path.join(os.tmpdir(), `agentmesh-release-${tag}.md`);
  const body = [
    `AgentMesh ${tag} release.`,
    "",
    "Assets",
    "",
    `- agentmesh-${version}.tgz: CLI npm install tarball`,
    `- AgentMesh_${version}_aarch64.dmg: unsigned macOS Apple Silicon DMG`,
    `- ${updaterAssets.archive}: signed Tauri updater archive`,
    `- ${updaterAssets.signature}: updater archive signature`,
    "- latest.json: stable Tauri updater metadata",
    `- agentmesh-skill-${version}.md: standalone AgentMesh skill markdown`,
    "- SHA256SUMS: release asset checksums",
    "",
    "Install and upgrade notes",
    "",
    "- Users upgrading from v0.1.10 must replace AgentMesh.app with this DMG once; later updater-enabled versions can update in-app.",
    "- The DMG is unsigned and Apple Silicon-only; first open may require right-click Open or approval in System Settings / Privacy & Security.",
    "- The CLI tarball is a separate channel. Update PATH-visible CLI installs with npm install -g using the matching agentmesh tarball.",
    "- Settings / Agent Integrations manages the separate public npm CLI and verifies the PATH-visible version after installation.",
    "",
  ].join("\n");
  writeFileSync(notesPath, body);
  return notesPath;
}

function assertFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing release file ${filePath}`);
  }
}

function assertCommand(command, commandArgs, message) {
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`${message}\n${result.stderr || result.stdout || `${command} exited with ${result.status}`}`);
  }
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function run(command, commandArgs, options = {}) {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`);
  execFileSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
}

function updaterSigningEnvironment() {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY && process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    return {
      TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
    };
  }
  if (process.platform !== "darwin") {
    throw new Error("TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD are required.");
  }
  const keyPath = path.join(os.homedir(), ".config", "agentmesh", "updater", "agentmesh.key");
  if (!existsSync(keyPath)) {
    throw new Error(`Missing updater signing key ${keyPath}.`);
  }
  const password = execFileSync(
    "security",
    ["find-generic-password", "-a", os.userInfo().username, "-s", "dev.agentmesh.studio.updater", "-w"],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  if (!password) {
    throw new Error("Updater signing password is missing from macOS Keychain.");
  }
  return {
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, "utf-8"),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  };
}

function parseArgs(input) {
  const parsed = {
    allowDirty: false,
    compareLocal: false,
    help: false,
    notesFile: undefined,
    prepareOnly: false,
    repo: undefined,
    skipBuild: false,
    verifyOnly: false,
  };
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--notes-file") {
      parsed.notesFile = requireValue(input, index, arg);
      index += 1;
    } else if (arg === "--compare-local") {
      parsed.compareLocal = true;
    } else if (arg === "--allow-dirty") {
      parsed.allowDirty = true;
    } else if (arg === "--prepare-only") {
      parsed.prepareOnly = true;
    } else if (arg === "--repo") {
      parsed.repo = requireValue(input, index, arg);
      index += 1;
    } else if (arg === "--skip-build") {
      parsed.skipBuild = true;
    } else if (arg === "--verify-only") {
      parsed.verifyOnly = true;
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return parsed;
}

function requireValue(input, index, arg) {
  const value = input[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${arg} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/github-release.mjs [options]

Create or verify the GitHub Release for the current package version.

Options:
  --notes-file <path>  Release notes file used when creating a new release.
  --allow-dirty        Allow publishing from a dirty working tree. Use only for recovery.
  --compare-local      During --verify-only, compare remote asset digests with dist-release/.
  --prepare-only       Build release assets and checksums without touching GitHub.
  --repo <owner/name>  GitHub repository. Defaults to GITHUB_REPOSITORY or jinhx128/agentmesh.
  --skip-build         Reuse existing build output and DMG when preparing assets.
  --verify-only        Verify the GitHub Release and uploaded assets only.
  --help               Show this help.
`);
}
