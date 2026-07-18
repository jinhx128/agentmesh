import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

type SpawnResult = ReturnType<typeof spawnSync>;

function assertSpawnOk(result: SpawnResult, label: string): void {
  assert.equal(
    result.status,
    0,
    `${label} failed\nstdout:\n${String(result.stdout)}\nstderr:\n${String(result.stderr)}`,
  );
}

function packageFilesFromDryRun(root: string): string[] {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: root,
    encoding: "utf-8",
  });
  assertSpawnOk(result, "npm pack --dry-run --json");
  const payload = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>;
  assert.equal(payload.length, 1);
  return payload[0].files.map((file) => file.path).sort();
}

test("package split exposes the agentmesh CLI as the TS target surface", () => {
  const root = process.cwd();
  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), { encoding: "utf-8" }),
  );

  assert.deepEqual(packageJson.workspaces, ["packages/*", "apps/*"]);
  assert.equal(packageJson.bin.agentmesh, "dist-node/packages/cli/src/cli.js");
  assert.equal(packageJson.bin["agentmesh-ts"], undefined);
  assert.equal(
    packageJson.scripts.agentmesh,
    "npm run build && node dist-node/packages/cli/src/cli.js",
  );
  assert.equal(
    packageJson.scripts["studio-desktop"],
    "npm run build && node dist-node/apps/studio-desktop/src/main.js",
  );
  assert.match(
    packageJson.scripts["cli:install-smoke"],
    /root CLI pack installs and runs in a clean project/,
  );
  assert.equal(packageJson.scripts["agentmesh-ts"], undefined);
  assert.equal(packageJson.engines.node, ">=22");
  assert.doesNotMatch(packageJson.scripts.build, /\brm -rf\b|\bchmod \+x\b/);
  assert.notEqual(
    statSync(path.join(root, packageJson.bin.agentmesh)).mode & 0o111,
    0,
  );

  assert.equal(existsSync(path.join(root, "src-node")), false);
  assert.equal(existsSync(path.join(root, "packages", "runtime", "src")), true);
  assert.equal(existsSync(path.join(root, "packages", "sdk", "src", "index.ts")), true);
  assert.equal(existsSync(path.join(root, "packages", "cli", "src", "cli.ts")), true);
  assert.equal(existsSync(path.join(root, "packages", "app-server", "src", "server.ts")), true);
  assert.equal(existsSync(path.join(root, "apps", "studio", "src", "server.ts")), false);
  assert.equal(existsSync(path.join(root, "apps", "studio-desktop", "src-tauri", "tauri.conf.json")), true);
});

test("active product surfaces contain no Copilot integration", () => {
  const root = process.cwd();
  const activeFiles = [
    "README.md",
    "index.html",
    "docs/roadmap.md",
    "docs/contracts/skill-output.md",
    "docs/distribution/cli-command-install.md",
    "docs/distribution/studio-macos.md",
    "docs/distribution/studio-coexistence-smoke.md",
    "packages/skills/src/verify.ts",
    "packages/skills/agentmesh-skill/SKILL.md",
    "packages/cli/src/commands/skill.ts",
    "packages/app-server/src/integrations.ts",
    "apps/studio-web/src/api/integrations.ts",
    "apps/studio-web/src/features/settings/AgentIntegrationsPanel.tsx",
    "apps/studio-web/src/features/manual/ManualView.tsx",
    "apps/studio-desktop/distribution/macos.json",
    "apps/studio-desktop/src/distribution-smoke.ts",
  ];

  for (const file of activeFiles) {
    assert.doesNotMatch(
      readFileSync(path.join(root, file), "utf-8"),
      /copilot/i,
      `active Copilot reference remains in ${file}`,
    );
  }
});

test("canonical AgentMesh skill defines safe cross-host reviewer scope continuity", () => {
  const skill = readFileSync(
    path.join(process.cwd(), "packages", "skills", "agentmesh-skill", "SKILL.md"),
    "utf-8",
  );

  for (const host of ["codex", "cursor", "claude", "antigravity", "opencode"]) {
    assert.ok(skill.includes(`\`${host}\``), `missing documented host: ${host}`);
  }
  for (const requiredContract of [
    "## Cross-Host Reviewer Session Continuity",
    "agentmesh sessions scope create --host codex --json",
    "Read `correlation_token` from the JSON response",
    "--host-kind codex",
    "--conversation-scope amscope_v1:11111111-1111-4111-8111-111111111111",
    "--review-session-mode interactive_continuous",
    "reuse the exact same opaque `amscope_v1` token",
    "omit `--conversation-scope` and run fresh",
    "A missing or invalid scope always degrades to fresh invocation",
    "native host conversation identity takes precedence",
    "must not derive or recover a scope from the workspace",
    "Formal review and release gates must use `independent`",
    "Never copy a provider/native session ID",
  ]) {
    assert.ok(skill.includes(requiredContract), `missing Skill contract: ${requiredContract}`);
  }
  assert.match(skill, /For another supported host, replace only\s+`--host-kind`/);
});

test("public docs describe reviewer session reuse without overclaiming adapters", () => {
  const root = process.cwd();
  const readme = readFileSync(path.join(root, "README.md"), "utf-8");
  const landingPage = readFileSync(path.join(root, "index.html"), "utf-8");

  for (const [label, content] of [["README", readme], ["landing page", landingPage]] as const) {
    for (const requiredContract of [
      "Reviewer Session",
      "interactive_continuous",
      "independent",
      "agentmesh sessions list --json",
      "agentmesh sessions close",
      "agentmesh sessions purge --expired --json",
      "non-hermetic",
      "Claude Code 与 OpenCode 当前为 experimental",
      "Codex、Cursor、Antigravity 保持 fresh-only",
      "不得从 workspace",
    ]) {
      assert.ok(content.includes(requiredContract), `${label} missing reviewer session contract: ${requiredContract}`);
    }
    assert.match(content, /flow resume[\s\S]*Run[\s\S]*Reviewer Session/i);
  }
});

test("release publish wrappers expose npm and GitHub one-command flows", () => {
  const root = process.cwd();
  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), { encoding: "utf-8" }),
  );

  assert.equal(packageJson.scripts["publish:npm"], "bash scripts/publish-npm.sh");
  assert.equal(packageJson.scripts["publish:github"], "bash scripts/publish-github-release.sh");

  const npmScript = readFileSync(path.join(root, "scripts", "publish-npm.sh"), {
    encoding: "utf-8",
  });
  assert.match(npmScript, /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail/);
  for (const expected of [
    "npm whoami",
    "npm access list packages",
    "npm run build",
    "npm run cli:install-smoke",
    "npm view",
    "npm publish",
    "--access public",
  ]) {
    assert.match(npmScript, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const githubScript = readFileSync(path.join(root, "scripts", "publish-github-release.sh"), {
    encoding: "utf-8",
  });
  assert.match(githubScript, /^#!\/usr\/bin\/env bash\nset -Eeuo pipefail/);
  for (const expected of [
    "gh auth status",
    "node scripts/github-release.mjs",
  ]) {
    assert.match(githubScript, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(githubScript, /release:github:verify/);

  const githubReleaseScript = readFileSync(path.join(root, "scripts", "github-release.mjs"), {
    encoding: "utf-8",
  });
  assert.match(githubReleaseScript, /function readLatestReleaseTag\(\)/);
  assert.match(githubReleaseScript, /`repos\/\$\{repo\}\/releases\/latest`/);
  assert.match(githubReleaseScript, /latestReleaseTag !== tag/);
});

test("packages and apps are explicit workspace build units", () => {
  const root = process.cwd();
  const units = [
    ["packages/core", "@agentmesh/core"],
    ["packages/runtime", "@agentmesh/runtime"],
    ["packages/skills", "@agentmesh/skills"],
    ["packages/sdk", "@agentmesh/sdk"],
    ["packages/cli", "@agentmesh/cli"],
    ["packages/app-server", "@agentmesh/app-server"],
    ["apps/studio", "@agentmesh/studio"],
    ["apps/studio-web", "@agentmesh/studio-web"],
    ["apps/studio-desktop", "@agentmesh/studio-desktop"],
  ] as const;

  for (const [unitPath, packageName] of units) {
    const packagePath = path.join(root, unitPath, "package.json");
    const tsconfigPath = path.join(root, unitPath, "tsconfig.json");
    assert.equal(existsSync(packagePath), true, `${unitPath} should have package.json`);
    assert.equal(existsSync(tsconfigPath), true, `${unitPath} should have tsconfig.json`);

    const unitPackageJson = JSON.parse(readFileSync(packagePath, { encoding: "utf-8" }));
    const unitTsconfig = JSON.parse(readFileSync(tsconfigPath, { encoding: "utf-8" }));
    assert.equal(unitPackageJson.name, packageName);
    assert.equal(unitPackageJson.private, true);
    assert.equal(unitPackageJson.type, "module");
    assert.match(unitPackageJson.scripts?.build ?? "", /tsc -p tsconfig\.json/);
    assert.equal(unitTsconfig.extends, "../../tsconfig.json");
    assert.equal(unitTsconfig.compilerOptions.rootDir, "../..");
    assert.equal(unitTsconfig.compilerOptions.outDir, "../../dist-node");
    assert.ok(Array.isArray(unitTsconfig.include));
    assert.ok(unitTsconfig.include.length > 0);

    if (unitPath === "packages/cli") {
      assert.equal(unitPackageJson.bin.agentmesh, "./src/cli.ts");
      assert.equal(unitPackageJson.exports, undefined);
    } else if (unitPath === "apps/studio-web") {
      assert.equal(unitPackageJson.exports, undefined);
      assert.equal(unitPackageJson.dependencies.react, "^19.2.6");
      assert.equal(unitPackageJson.dependencies["react-dom"], "^19.2.6");
    } else if (unitPath === "apps/studio-desktop") {
      assert.equal(unitPackageJson.exports, undefined);
      assert.equal(unitPackageJson.dependencies["@agentmesh/app-server"], "0.1.13");
    } else {
      assert.equal(typeof unitPackageJson.exports, "object");
      assert.ok(unitPackageJson.exports["."].startsWith("./src/"));
      assert.equal(unitPackageJson.exports["./src/*"], "./src/*");
    }
  }
});

test("root package owns the only installable CLI tarball boundary", () => {
  const root = process.cwd();
  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), { encoding: "utf-8" }),
  );

  assert.equal(packageJson.name, "@jinhx128/agentmesh");
  assert.equal(packageJson.private, false);
  assert.deepEqual(packageJson.publishConfig, {
    access: "public",
    registry: "https://registry.npmjs.org/",
  });
  assert.equal(packageJson.bin.agentmesh, "dist-node/packages/cli/src/cli.js");
  assert.deepEqual(packageJson.files, [
    "dist-node/packages/",
    "dist-node/apps/studio/",
    "dist-node/apps/studio-web/",
    "packages/skills/agentmesh-skill/",
  ]);
  assert.equal(packageJson.dependencies["@agentmesh/core"], undefined);
  assert.equal(packageJson.dependencies["@agentmesh/runtime"], undefined);
  assert.equal(packageJson.dependencies["@agentmesh/skills"], undefined);
  assert.equal(packageJson.dependencies["@agentmesh/sdk"], undefined);
  assert.equal(packageJson.dependencies["@agentmesh/cli"], undefined);
  assert.equal(packageJson.dependencies["@agentmesh/app-server"], undefined);
  assert.equal(packageJson.dependencies["@agentmesh/studio"], undefined);
  assert.equal(packageJson.dependencies["@agentmesh/studio-web"], undefined);
  assert.equal(packageJson.dependencies.react, undefined);
  assert.equal(packageJson.dependencies["react-dom"], undefined);
});

test("root TypeScript build emits declarations for installable internals", () => {
  const root = process.cwd();
  const tsconfig = JSON.parse(readFileSync(path.join(root, "tsconfig.json"), { encoding: "utf-8" }));

  assert.equal(tsconfig.compilerOptions.declaration, true);
  for (const declarationPath of [
    "dist-node/packages/core/src/index.d.ts",
    "dist-node/packages/skills/src/index.d.ts",
    "dist-node/packages/runtime/src/index.d.ts",
    "dist-node/packages/sdk/src/index.d.ts",
    "dist-node/packages/cli/src/cli.d.ts",
    "dist-node/packages/app-server/src/server.d.ts",
  ]) {
    assert.equal(existsSync(path.join(root, declarationPath)), true, `${declarationPath} should exist`);
  }
});

test("root CLI pack contains only the runtime surface needed by the installed bin", () => {
  const root = process.cwd();
  const files = packageFilesFromDryRun(root);

  for (const requiredPath of [
    "package.json",
    "README.md",
    "LICENSE",
    "packages/skills/agentmesh-skill/SKILL.md",
    "dist-node/packages/core/src/index.js",
    "dist-node/packages/core/src/index.d.ts",
    "dist-node/packages/cli/src/cli.js",
    "dist-node/packages/cli/src/cli.d.ts",
    "dist-node/packages/runtime/src/index.js",
    "dist-node/packages/runtime/src/index.d.ts",
    "dist-node/packages/skills/src/index.js",
    "dist-node/packages/skills/src/index.d.ts",
    "dist-node/packages/sdk/src/index.d.ts",
    "dist-node/packages/app-server/src/server.js",
    "dist-node/packages/app-server/src/server.d.ts",
    "dist-node/apps/studio/src/main.js",
    "dist-node/apps/studio-web/frontend/index.html",
  ]) {
    assert.ok(files.includes(requiredPath), `${requiredPath} should be packed`);
  }

  for (const file of files) {
    if (file.startsWith("packages/")) {
      assert.match(file, /^packages\/skills\/agentmesh-skill\//);
    }
    assert.doesNotMatch(file, /^apps\/studio\/src\//);
    assert.doesNotMatch(file, /^apps\/studio-web\/src\//);
    assert.doesNotMatch(file, /^apps\/studio-desktop\//);
    assert.doesNotMatch(file, /^tests-node\//);
    assert.doesNotMatch(file, /^docs\/reviews\//);
    assert.doesNotMatch(file, /^changelog\//);
    if (file.endsWith(".ts")) {
      assert.ok(file.endsWith(".d.ts"), `${file} should be a declaration file`);
    }
  }
});

test("root CLI pack installs and runs in a clean project", () => {
  const root = process.cwd();
  const tempRoot = mkdtempSync(path.join(tmpdir(), "agentmesh-pack-smoke-"));
  const packDir = path.join(tempRoot, "pack");
  const installDir = path.join(tempRoot, "install");
  rmSync(packDir, { recursive: true, force: true });
  rmSync(installDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });
  test.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  const packResult = spawnSync("npm", ["pack", "--json", "--pack-destination", packDir], {
    cwd: root,
    encoding: "utf-8",
  });
  assertSpawnOk(packResult, "npm pack --json");
  const packed = JSON.parse(packResult.stdout) as Array<{ filename: string }>;
  const tarball = path.join(packDir, packed[0].filename);

  const initResult = spawnSync("npm", ["init", "-y"], {
    cwd: installDir,
    encoding: "utf-8",
  });
  assertSpawnOk(initResult, "npm init -y");

  const installResult = spawnSync("npm", ["install", tarball, "--ignore-scripts"], {
    cwd: installDir,
    encoding: "utf-8",
  });
  assertSpawnOk(installResult, "npm install agentmesh tarball");

  const bin = path.join(installDir, "node_modules", ".bin", "agentmesh");
  const fakeAgent = path.join(installDir, "fake-agent");
  writeFileSync(fakeAgent, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(fakeAgent, 0o755);
  const smokeHome = path.join(tempRoot, "home");
  const smokeConfig = path.join(smokeHome, ".config", "agentmesh", "config.toml");
  mkdirSync(path.dirname(smokeConfig), { recursive: true });
  writeFileSync(
    smokeConfig,
    [
      "schema_version = 1",
      "",
      "[agents.pack_smoke]",
      'label = "Pack Smoke"',
      'adapter = "command"',
      `command = "${fakeAgent}"`,
      "args = []",
      'capabilities = ["plan", "execute", "review", "decide"]',
      'prompt_file_arg = "--prompt-file"',
      'output_file_arg = "--output-file"',
      "",
    ].join("\n"),
  );
  const smokeEnv = {
    ...process.env,
    AGENTMESH_CONFIG: "",
    HOME: smokeHome,
  };
  const helpResult = spawnSync(bin, ["--help"], { cwd: installDir, env: smokeEnv, encoding: "utf-8" });
  assertSpawnOk(helpResult, "agentmesh --help");
  assert.match(helpResult.stderr, /usage: agentmesh/);

  const doctorResult = spawnSync(bin, ["doctor", "--json"], {
    cwd: installDir,
    env: smokeEnv,
    encoding: "utf-8",
  });
  assertSpawnOk(doctorResult, "agentmesh doctor --json");
  assert.ok(Array.isArray(JSON.parse(doctorResult.stdout).agents));

  const skillResult = spawnSync(bin, ["skill", "show"], {
    cwd: installDir,
    env: smokeEnv,
    encoding: "utf-8",
  });
  assertSpawnOk(skillResult, "agentmesh skill show");
  assert.match(skillResult.stdout, /# AgentMesh Skill/);
  assert.match(skillResult.stdout, /agentmesh-skill-version-metadata:start/);

  const installSkillResult = spawnSync(bin, ["skill", "install", "--target", "codex", "--force"], {
    cwd: installDir,
    env: smokeEnv,
    encoding: "utf-8",
  });
  assertSpawnOk(installSkillResult, "agentmesh skill install --target codex --force");
  assert.match(installSkillResult.stdout, /\.agents\/skills\/agentmesh\/SKILL\.md/);

  const verifySkillResult = spawnSync(bin, ["skill", "verify", "--target", "codex", "--json"], {
    cwd: installDir,
    env: smokeEnv,
    encoding: "utf-8",
  });
  assertSpawnOk(verifySkillResult, "agentmesh skill verify --target codex --json");
  const verifyPayload = JSON.parse(verifySkillResult.stdout) as {
    ok: boolean;
    files: Array<{ path: string; classification: string; expected: boolean }>;
  };
  const verifiedExpectedFile = verifyPayload.files.find((file) => file.expected);
  assert.equal(verifyPayload.ok, true);
  assert.equal(verifiedExpectedFile?.classification, "ok");
  assert.equal(
    existsSync(path.join(installDir, ".agents", "skills", "agentmesh", "SKILL.md")),
    true,
  );
});

test("core package stays free of runtime IO imports", () => {
  const coreSrc = path.join(process.cwd(), "packages", "core", "src");
  const files = readdirSync(coreSrc, { recursive: true })
    .map((file) => String(file))
    .filter((file) => file.endsWith(".ts"));

  assert.ok(files.length > 0);
  for (const file of files) {
    const content = readFileSync(path.join(coreSrc, file), { encoding: "utf-8" });
    assert.doesNotMatch(content, /from ["']node:(fs|child_process|path|os)["']/);
    assert.doesNotMatch(content, /from ["'](fs|child_process|path|os)["']/);
  }
});

test("adapter package promotion remains deferred until there is a real consumer", () => {
  const root = process.cwd();

  assert.equal(existsSync(path.join(root, "packages", "adapters")), false);

  const decision = readFileSync(
    path.join(root, "docs", "decisions", "adapter-package-promotion.md"),
    { encoding: "utf-8" },
  );
  assert.match(decision, /Decision: deferred/);
  assert.match(decision, /second real consumer/);
  assert.match(decision, /third-party adapter fixture/);
});

test("skills package owns skill templates and install verification", () => {
  const root = process.cwd();
  const skillsPackage = JSON.parse(
    readFileSync(path.join(root, "packages", "skills", "package.json"), { encoding: "utf-8" }),
  );
  const cliSkillCommand = readFileSync(
    path.join(root, "packages", "cli", "src", "commands", "skill.ts"),
    { encoding: "utf-8" },
  );
  const runtimeIndex = readFileSync(
    path.join(root, "packages", "runtime", "src", "index.ts"),
    { encoding: "utf-8" },
  );
  const boundaryScript = readFileSync(path.join(root, "scripts", "check-boundaries.mjs"), {
    encoding: "utf-8",
  });

  assert.equal(skillsPackage.name, "@agentmesh/skills");
  assert.equal(skillsPackage.dependencies["@agentmesh/core"], "0.1.13");
  assert.equal(existsSync(path.join(root, "packages", "skills", "agentmesh-skill", "SKILL.md")), true);
  assert.equal(existsSync(path.join(root, "agentmesh-skill", "SKILL.md")), false);
  assert.match(cliSkillCommand, /@agentmesh\/skills/);
  assert.doesNotMatch(cliSkillCommand, /@agentmesh\/runtime\/src\/skill/);
  assert.doesNotMatch(runtimeIndex, /skill\/verify/);
  assert.equal(existsSync(path.join(root, "packages", "runtime", "src", "skill", "verify.ts")), false);
  assert.match(boundaryScript, /packages\/skills\/src\//);
  assert.match(boundaryScript, /@agentmesh\\\/\(runtime\|cli\)/);
});

test("public read SDK is promoted with read-only boundaries and real consumers", () => {
  const root = process.cwd();
  const publicSurface = readFileSync(
    path.join(root, "docs", "contracts", "public-extension-surface.md"),
    { encoding: "utf-8" },
  );
  const sdkPackageJson = JSON.parse(
    readFileSync(path.join(root, "packages", "sdk", "package.json"), {
      encoding: "utf-8",
    }),
  );
  const sdkIndex = readFileSync(path.join(root, "packages", "sdk", "src", "index.ts"), {
    encoding: "utf-8",
  });
  const studioPacketBrowser = readFileSync(
    path.join(root, "packages", "app-server", "src", "packet-browser.ts"),
    { encoding: "utf-8" },
  );
  const cliAgents = readFileSync(path.join(root, "packages", "cli", "src", "commands", "agents.ts"), {
    encoding: "utf-8",
  });
  const cliWorkflows = readFileSync(
    path.join(root, "packages", "cli", "src", "commands", "workflows.ts"),
    { encoding: "utf-8" },
  );

  assert.equal(sdkPackageJson.name, "@agentmesh/sdk");
  assert.equal(sdkPackageJson.private, true);
  assert.equal(sdkPackageJson.type, "module");
  assert.equal(sdkPackageJson.exports["."], "./src/index.ts");
  assert.equal(sdkPackageJson.dependencies["@agentmesh/runtime"], undefined);
  assert.equal(sdkPackageJson.dependencies["@agentmesh/core"], "0.1.13");
  assert.equal(typeof sdkPackageJson.dependencies["smol-toml"], "string");

  for (const apiName of [
    "listWorkflows",
    "getWorkflow",
    "listAgents",
    "listRuns",
    "getRun",
    "listRunEvents",
    "listArtifacts",
  ]) {
    assert.match(sdkIndex, new RegExp(`export function ${apiName}\\b`));
  }
  assert.doesNotMatch(sdkIndex, /@agentmesh\/runtime|runtime\/src/);
  assert.match(publicSurface, /Read-only SDK promoted/);
  assert.match(publicSurface, /Studio/);
  assert.match(publicSurface, /CLI/);
  assert.doesNotMatch(sdkIndex, /export function appendCallAdoption\b/);
  assert.doesNotMatch(
    sdkIndex,
    /\b(saveStatus|appendEvent|recordArtifact|writeArtifacts|appendFileSync|writeFileSync|writeFileAtomic|renameSync|mkdirSync|spawn|spawnSync)\b/,
  );
  assert.match(studioPacketBrowser, /@agentmesh\/sdk/);
  assert.match(cliAgents, /@agentmesh\/sdk/);
  assert.match(cliWorkflows, /@agentmesh\/sdk/);
});

test("MCP server and UI package follow-ups stay deferred without real consumers", () => {
  const root = process.cwd();

  assert.equal(existsSync(path.join(root, "packages", "mcp-server")), false);
  assert.equal(existsSync(path.join(root, "packages", "ui")), false);

  const decision = readFileSync(
    path.join(root, "docs", "decisions", "extension-followups.md"),
    { encoding: "utf-8" },
  );
  for (const requiredTerm of [
    "Decision: deferred",
    "read-only SDK",
    "MCP server",
    "mcp-readonly.md",
    "workflows, agents, runs, events, artifacts",
    "must not start runs",
    "must not modify workflow or agent config",
    "packages/ui",
    "Studio and Desktop",
    "no empty package",
  ]) {
    assert.match(decision, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("App Server package owns HTTP APIs and does not spawn CLI write paths", () => {
  const appServerSrc = path.join(process.cwd(), "packages", "app-server", "src");
  assert.equal(existsSync(appServerSrc), true);
  const files = readdirSync(appServerSrc, { recursive: true })
    .map((file) => String(file))
    .filter((file) => file.endsWith(".ts"));

  assert.ok(files.length > 0);
  for (const requiredFile of [
    "server.ts",
    "mutations.ts",
    "agent-lifecycle.ts",
    "calls-browser.ts",
    "packet-browser.ts",
    "catalog.ts",
  ]) {
    assert.ok(files.includes(requiredFile), `${requiredFile} should live in packages/app-server`);
  }
  assert.equal(files.includes("mcp-diagnostics.ts"), false);
  for (const file of files) {
    const content = readFileSync(path.join(appServerSrc, file), { encoding: "utf-8" });
    assert.doesNotMatch(content, /from ["']@agentmesh\/cli|import\(["']@agentmesh\/cli/);
    assert.doesNotMatch(
      content,
      /node:child_process|from ["']child_process["']|\b(?:spawn|exec|execFile|fork)(?:Sync)?\b|process\.execPath|packages\/cli/,
      `${file} must not call CLI or child_process`,
    );
  }
  for (const file of ["mutations.ts", "agent-lifecycle.ts", "calls-browser.ts"]) {
    const content = readFileSync(path.join(appServerSrc, file), { encoding: "utf-8" });
    assert.match(content, /@agentmesh\/runtime/);
    assert.doesNotMatch(content, /node:child_process|from ["']child_process["']/);
    assert.doesNotMatch(content, /\b(?:spawn|exec|execFile|fork)(?:Sync)?\b|process\.execPath/);
  }
  const boundaryScript = readFileSync(path.join(process.cwd(), "scripts", "check-boundaries.mjs"), {
    encoding: "utf-8",
  });
  assert.doesNotMatch(boundaryScript, /allowedAppServerCliDiagnosticFiles/);
  assert.doesNotMatch(boundaryScript, /packages\/app-server\/src\/mcp-diagnostics\.ts/);
  assert.match(boundaryScript, /packages\/app-server\/src\//);
});

test("Studio React frontend has Vite build wiring and stays behind App Server APIs", () => {
  const root = process.cwd();
  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), { encoding: "utf-8" }),
  );

  assert.equal(
    packageJson.scripts["build:studio-frontend"],
    "vite build --config apps/studio-web/vite.config.ts",
  );
  assert.match(packageJson.scripts.build, /npm run build:node/);
  assert.match(packageJson.scripts.build, /npm run build:studio-frontend/);
  assert.equal(typeof packageJson.devDependencies.vite, "string");
  assert.equal(typeof packageJson.devDependencies["@vitejs/plugin-react"], "string");
  assert.equal(typeof packageJson.devDependencies["@types/react"], "string");
  assert.equal(typeof packageJson.devDependencies["@types/react-dom"], "string");

  const frontendRoot = path.join(root, "apps", "studio-web", "src");
  assert.equal(existsSync(path.join(root, "apps", "studio", "src", "frontend")), false);
  assert.equal(existsSync(path.join(root, "apps", "studio", "vite.config.ts")), false);
  assert.equal(existsSync(path.join(root, "apps", "studio-web", "vite.config.ts")), true);
  assert.equal(existsSync(path.join(frontendRoot, "index.html")), true);
  assert.equal(existsSync(path.join(frontendRoot, "main.tsx")), true);
  assert.equal(existsSync(path.join(frontendRoot, "app", "App.tsx")), true);

  const files = readdirSync(frontendRoot, { recursive: true })
    .map((file) => String(file))
    .filter((file) => /\.(ts|tsx)$/.test(file));
  assert.ok(files.length > 0);
  for (const file of files) {
    const content = readFileSync(path.join(frontendRoot, file), { encoding: "utf-8" });
    assert.doesNotMatch(content, /packages\/(runtime|sdk|cli|core)|@agentmesh\//);
    assert.doesNotMatch(content, /from ["']node:|from ["'](fs|child_process|path|os)["']/);
    assert.doesNotMatch(
      content,
      /\b(runStudioMutation|studioMutationCommand|writeFileSync|appendFileSync|spawn|spawnSync)\b/,
    );
    assert.doesNotMatch(content, /\b(localStorage|sessionStorage|indexedDB)\b/);
    assert.doesNotMatch(content, /\b(127\.0\.0\.1|localhost):\d+\b|:4777\b/);
  }
});

test("desktop app server boundary requires runtime lock ownership for packet writes", () => {
  const root = process.cwd();
  const contract = readFileSync(path.join(root, "docs", "contracts", "app-server.md"), {
    encoding: "utf-8",
  });
  assert.match(contract, /App Server mutation must go through runtime APIs/);
  assert.match(contract, /filesystem run-lock/);
  assert.match(contract, /must not write packet files directly/);

  const candidateSources = [
    path.join(root, "apps", "desktop", "src"),
    path.join(root, "apps", "app-server", "src"),
    path.join(root, "apps", "studio-desktop", "src"),
  ].filter((dir) => existsSync(dir));

  for (const sourceDir of candidateSources) {
    const files = readdirSync(sourceDir, { recursive: true })
      .map((file) => String(file))
      .filter((file) => file.endsWith(".ts"));
    for (const file of files) {
      const content = readFileSync(path.join(sourceDir, file), { encoding: "utf-8" });
      assert.doesNotMatch(content, /packages\/runtime\/src\/packet\/io|@agentmesh\/runtime/);
      assert.doesNotMatch(
        content,
        /\b(writeFileSync|appendFileSync|writeFileAtomic)\s*\([^)]*(status\.json|events\.jsonl|artifacts\.toml|\.md)/s,
      );
    }
  }
});

test("studio desktop distribution decision chooses host and updater policy", () => {
  const decision = readFileSync(
    path.join(process.cwd(), "docs", "decisions", "studio-distribution.md"),
    { encoding: "utf-8" },
  );

  for (const requiredTerm of [
    "Decision: Tauri 2",
    "macOS DMG",
    "Developer ID",
    "notarization",
    "tauri-plugin-updater",
    "static JSON",
    "signed update artifacts",
    "stable channel",
    "beta channel",
    "manual rollback",
    "GitHub Releases",
    "Electron fallback",
    "Chromium API",
    "node-pty",
    "native Node modules",
    "sidecar packaging",
    "Windows/Linux require separate decisions",
  ]) {
    assert.match(decision, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("studio desktop distribution explicitly permits native preferences commands", () => {
  const tauriRoot = path.join(process.cwd(), "apps", "studio-desktop", "src-tauri");
  const rustSource = readFileSync(path.join(tauriRoot, "src", "lib.rs"), "utf-8");
  const handlerCommands = rustSource.match(
    /invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/,
  )?.[1];
  assert.ok(handlerCommands, "the Tauri invoke handler must be registered");
  assert.match(handlerCommands, /\bget_desktop_preferences\b/);
  assert.match(handlerCommands, /\bset_desktop_preferences\b/);

  const permissionPath = path.join(tauriRoot, "permissions", "desktop-preferences.toml");
  assert.equal(existsSync(permissionPath), true, "the app command permission manifest must exist");
  const permissionSource = readFileSync(permissionPath, "utf-8");
  assert.match(permissionSource, /identifier\s*=\s*"allow-desktop-preferences"/);
  const allowedCommands = permissionSource
    .match(/commands\.allow\s*=\s*\[([^\]]*)\]/)?.[1]
    .match(/"[^"]+"/g)
    ?.map((value) => JSON.parse(value))
    .sort();
  assert.deepEqual(allowedCommands, ["get_desktop_preferences", "set_desktop_preferences"]);
  assert.doesNotMatch(permissionSource, /\b(?:scope|commands\.deny)\b/);

  const capability = JSON.parse(
    readFileSync(path.join(tauriRoot, "capabilities", "default.json"), "utf-8"),
  ) as {
    remote?: { urls?: string[] };
    permissions?: string[];
  };
  assert.deepEqual(capability.remote?.urls, ["http://127.0.0.1:*"]);
  assert.ok(capability.permissions?.includes("allow-desktop-preferences"));
  assert.ok(capability.permissions?.includes("updater:default"));
  assert.ok(capability.permissions?.includes("process:allow-restart"));
});

test("studio distribution coexistence smoke evidence covers app and CLI channels", () => {
  const evidence = readFileSync(
    path.join(process.cwd(), "docs", "distribution", "studio-coexistence-smoke.md"),
    { encoding: "utf-8" },
  );

  for (const requiredTerm of [
    "app-bundled App Server",
    "PATH-visible agentmesh",
    "entry-agent",
    "filesystem run-lock",
    "unsupported newer packet",
    "read-only",
    "Install Command Line Tool",
    "@jinhx128/agentmesh@latest",
    "no bin path input",
    "web Studio smoke",
    "CLI Studio smoke",
    "desktop Studio smoke",
  ]) {
    assert.match(evidence, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("internal distribution shape is documented as a release gate", () => {
  const distribution = readFileSync(
    path.join(process.cwd(), "docs", "distribution", "package-shape.md"),
    { encoding: "utf-8" },
  );

  for (const requiredTerm of [
    "root package `@jinhx128/agentmesh` is the only installable CLI tarball",
    "`private: false`",
    "`dist-node/packages/`",
    "`dist-node/apps/studio/`",
    "`dist-node/apps/studio-web/`",
    "`packages/skills/agentmesh-skill/`",
    "no `@agentmesh/*` workspace dependencies",
    "declaration files",
    "clean install smoke",
    "source checkout",
    "tarball",
    "public npm registry",
    "PATH-visible `agentmesh`",
    "agentmesh skill verify --target <host> --json",
    "Agent Integrations command-line action",
    "DMG-only",
    "Desktop channel",
    "does not consume the npm CLI tarball",
    "actual installed version",
    "without a bin path input",
    "app-server/runtime/studio-web",
    "build artifacts",
  ]) {
    assert.match(distribution, new RegExp(requiredTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
