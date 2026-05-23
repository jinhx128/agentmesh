import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { once } from "node:events";

import { parseStudioDesktopArgs } from "../apps/studio-desktop/src/options.js";
import {
  redactStudioUrlForLog,
  restartStudioDesktopHost,
  serializeStudioDesktopLaunchEvent,
  startStudioDesktopHost,
} from "../apps/studio-desktop/src/host.js";
import { currentPacketStatus } from "./helpers/current-packet-status.js";

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-studio-desktop-"));
}

function writeRun(workspace: string, runId: string): void {
  const runDir = path.join(workspace, ".agentmesh", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, "status.json"),
    `${JSON.stringify(currentPacketStatus({
      run_id: runId,
      status: "created",
      workflow: "desktop-test",
      stages: ["plan"],
      completed_stages: [],
    }), null, 2)}\n`,
  );
  writeFileSync(path.join(runDir, "events.jsonl"), "");
  writeFileSync(path.join(runDir, "artifacts.toml"), "schema_version = 1\n");
}

function writeFakeAgentmesh(binDir: string): string {
  mkdirSync(binDir, { recursive: true });
  const filePath = path.join(binDir, "agentmesh");
  writeFileSync(filePath, "#!/bin/sh\necho fake-agentmesh \"$@\"\n");
  chmodSync(filePath, 0o755);
  return filePath;
}

function writeFakeProviderCli(binDir: string, command: string, version: string): string {
  mkdirSync(binDir, { recursive: true });
  const filePath = path.join(binDir, command);
  writeFileSync(filePath, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then",
    `  echo ${JSON.stringify(version)}`,
    "  exit 0",
    "fi",
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(filePath, 0o755);
  return filePath;
}

test("parseStudioDesktopArgs uses dynamic local defaults", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const assetDir = path.join(workspace, "AgentMesh.app", "studio-assets");
  mkdirSync(assetDir, { recursive: true });

  assert.deepEqual(parseStudioDesktopArgs([], { cwd: workspace, assetDir }), {
    host: "127.0.0.1",
    port: 0,
    workspace,
    assetDir,
  });
});

test("parseStudioDesktopArgs uses workspace env when app cwd is filesystem root", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.join(workspace, "frontend-dist"));

  const previousWorkspace = process.env.AGENTMESH_STUDIO_WORKSPACE;
  process.env.AGENTMESH_STUDIO_WORKSPACE = workspace;
  try {
    assert.deepEqual(
      parseStudioDesktopArgs(["--asset-dir", path.join(workspace, "frontend-dist")], {
        cwd: path.parse(workspace).root,
      }),
      {
        host: "127.0.0.1",
        port: 0,
        workspace,
        assetDir: path.join(workspace, "frontend-dist"),
      },
    );
  } finally {
    if (previousWorkspace === undefined) {
      delete process.env.AGENTMESH_STUDIO_WORKSPACE;
    } else {
      process.env.AGENTMESH_STUDIO_WORKSPACE = previousWorkspace;
    }
  }
});

test("parseStudioDesktopArgs discovers a recent workspace when app cwd is filesystem root", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const fakeHome = path.join(workspace, "home");
  const discoveredWorkspace = path.join(fakeHome, "Documents", "WebStorm", "agentmesh");
  mkdirSync(path.join(discoveredWorkspace, "frontend-dist"), { recursive: true });
  writeRun(discoveredWorkspace, "discovered-run");

  const previousWorkspace = process.env.AGENTMESH_STUDIO_WORKSPACE;
  delete process.env.AGENTMESH_STUDIO_WORKSPACE;
  try {
    assert.deepEqual(
      parseStudioDesktopArgs(["--asset-dir", path.join(discoveredWorkspace, "frontend-dist")], {
        cwd: path.parse(workspace).root,
        homeDir: fakeHome,
      }),
      {
        host: "127.0.0.1",
        port: 0,
        workspace: discoveredWorkspace,
        assetDir: path.join(discoveredWorkspace, "frontend-dist"),
      },
    );
  } finally {
    if (previousWorkspace !== undefined) {
      process.env.AGENTMESH_STUDIO_WORKSPACE = previousWorkspace;
    }
  }
});

test("parseStudioDesktopArgs falls back to home instead of filesystem root", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(path.join(workspace, "frontend-dist"));
  const fakeHome = path.join(workspace, "home");
  mkdirSync(fakeHome);

  const previousWorkspace = process.env.AGENTMESH_STUDIO_WORKSPACE;
  delete process.env.AGENTMESH_STUDIO_WORKSPACE;
  try {
    assert.deepEqual(
      parseStudioDesktopArgs(["--asset-dir", path.join(workspace, "frontend-dist")], {
        cwd: path.parse(workspace).root,
        homeDir: fakeHome,
      }),
      {
        host: "127.0.0.1",
        port: 0,
        workspace: fakeHome,
        assetDir: path.join(workspace, "frontend-dist"),
      },
    );
  } finally {
    if (previousWorkspace !== undefined) {
      process.env.AGENTMESH_STUDIO_WORKSPACE = previousWorkspace;
    }
  }
});

test("parseStudioDesktopArgs accepts explicit workspace, port, and assets", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const project = path.join(workspace, "project");
  mkdirSync(project);
  mkdirSync(path.join(workspace, "frontend-dist"));

  assert.deepEqual(
    parseStudioDesktopArgs([
      "--workspace",
      project,
      "--port",
      "6123",
      "--asset-dir",
      "frontend-dist",
    ], { cwd: workspace }),
    {
      host: "127.0.0.1",
      port: 6123,
      workspace: project,
      assetDir: path.join(workspace, "frontend-dist"),
    },
  );
});

test("parseStudioDesktopArgs rejects invalid workspace and port", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  assert.throws(
    () => parseStudioDesktopArgs(["--port", "abc"], { cwd: workspace }),
    /invalid --port/,
  );
  assert.throws(
    () => parseStudioDesktopArgs(["--port", "65536"], { cwd: workspace }),
    /invalid --port/,
  );
  assert.throws(
    () => parseStudioDesktopArgs(["--workspace", path.join(workspace, "missing")], {
      cwd: workspace,
    }),
    /invalid --workspace/,
  );
  assert.throws(
    () => parseStudioDesktopArgs(["--asset-dir", path.join(workspace, "missing-assets")], {
      cwd: workspace,
    }),
    /invalid --asset-dir/,
  );
});

test("startStudioDesktopHost starts cookie-authenticated App Server and reads runs", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "desktop-run");

  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "test-token",
  });
  test.after(() => {
    void started.stop();
  });

  assert.match(started.serverUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(started.webviewUrl, `${started.serverUrl}/`);

  const bootstrapDenied = await fetch(`${started.serverUrl}/api/bootstrap`);
  assert.equal(bootstrapDenied.status, 401);

  const initialDenied = await fetch(started.webviewUrl);
  assert.equal(initialDenied.status, 401);

  const queryInitial = await fetch(`${started.webviewUrl}?token=test-token`);
  assert.equal(queryInitial.status, 200);
  assert.equal(queryInitial.headers.get("referrer-policy"), "no-referrer");
  const querySetCookie = queryInitial.headers.get("set-cookie") ?? "";
  assert.match(querySetCookie, /agentmesh_studio_token=test-token/);
  const queryInitialHtml = await queryInitial.text();
  const scriptMatch = queryInitialHtml.match(/\/assets\/index-[^"]+\.js/);
  assert.ok(scriptMatch);
  const queryAssetDenied = await fetch(`${started.serverUrl}${scriptMatch[0]}?token=test-token`);
  assert.equal(queryAssetDenied.status, 401);
  const queryAsset = await fetch(`${started.serverUrl}${scriptMatch[0]}`, {
    headers: { cookie: "agentmesh_studio_token=test-token" },
  });
  assert.equal(queryAsset.status, 200);
  assert.match(queryAsset.headers.get("content-type") ?? "", /text\/javascript/);

  const initial = await fetch(started.webviewUrl, {
    headers: { cookie: "agentmesh_studio_token=test-token" },
  });
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get("referrer-policy"), "no-referrer");
  const setCookie = initial.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /agentmesh_studio_token=test-token/);
  assert.match(setCookie, /HttpOnly/);
  const initialHtml = await initial.text();
  assert.match(initialHtml, /\/assets\/index-[^"]+\.js/);
  assert.match(initialHtml, /\/assets\/index-[^"]+\.css/);
  assert.doesNotMatch(initialHtml, /\/studio\.js/);

  const bootstrap = await fetch(`${started.serverUrl}/api/bootstrap`, {
    headers: { cookie: setCookie },
  });
  assert.equal(bootstrap.status, 200);
  const bootstrapPayload = await bootstrap.json() as {
    schema_version: number;
    authenticated: boolean;
    workspace: string;
    api_base_url: string;
  };
  assert.deepEqual(bootstrapPayload, {
    schema_version: 1,
    authenticated: true,
    workspace,
    api_base_url: "",
  });
  assert.doesNotMatch(JSON.stringify(bootstrapPayload), /test-token/);

  const denied = await fetch(`${started.serverUrl}/api/runs`);
  assert.equal(denied.status, 401);

  const malformedCookie = await fetch(`${started.serverUrl}/api/runs`, {
    headers: { cookie: "agentmesh_studio_token=%" },
  });
  assert.equal(malformedCookie.status, 401);

  const health = await fetch(`${started.serverUrl}/api/health?token=test-token`);
  assert.equal(health.status, 401);

  const bearerHealth = await fetch(`${started.serverUrl}/api/health`, {
    headers: { authorization: "Bearer test-token" },
  });
  assert.equal(bearerHealth.status, 200);
  assert.deepEqual(await bearerHealth.json(), { ok: true });

  const cookieHealth = await fetch(`${started.serverUrl}/api/health`, {
    headers: { cookie: "agentmesh_studio_token=test-token" },
  });
  assert.equal(cookieHealth.status, 200);
  assert.deepEqual(await cookieHealth.json(), { ok: true });

  const queryRuns = await fetch(`${started.serverUrl}/api/runs?token=test-token`);
  assert.equal(queryRuns.status, 401);

  const cookieRuns = await fetch(`${started.serverUrl}/api/runs`, {
    headers: { cookie: "agentmesh_studio_token=test-token" },
  });
  assert.equal(cookieRuns.status, 200);
  const payload = await cookieRuns.json() as { runs: Array<{ run_id: string }> };
  assert.deepEqual(payload.runs.map((run) => run.run_id), ["desktop-run"]);

  const compatibility = await fetch(`${started.serverUrl}/api/compatibility`, {
    headers: { cookie: "agentmesh_studio_token=test-token" },
  });
  assert.equal(compatibility.status, 200);
  const compatibilityPayload = await compatibility.json() as {
    current_entrypoint: string;
    decision: string;
  };
  assert.equal(compatibilityPayload.current_entrypoint, "desktop");
  assert.equal(compatibilityPayload.decision, "read_write");
  await started.stop();
});

test("desktop App Server rejects unsafe host origin and CORS probes", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "origin-run");

  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "origin-token",
  });
  test.after(() => {
    void started.stop();
  });

  const cookie = "agentmesh_studio_token=origin-token";
  const invalidHost = await requestRaw(`${started.serverUrl}/api/runs`, {
    host: "evil.local",
    cookie,
  });
  assert.equal(invalidHost.status, 403);

  const evilOrigin = await requestRaw(`${started.serverUrl}/api/runs`, {
    origin: "http://evil.local",
    cookie,
  });
  assert.equal(evilOrigin.status, 403);
  assert.equal(evilOrigin.headers["access-control-allow-origin"], undefined);

  const preflight = await requestRaw(`${started.serverUrl}/api/mutations`, {
    origin: "http://evil.local",
    "access-control-request-method": "POST",
  }, "OPTIONS");
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers["access-control-allow-origin"], undefined);

  const sameOrigin = await fetch(`${started.serverUrl}/api/runs`, {
    headers: {
      origin: started.serverUrl,
      cookie,
    },
  });
  assert.equal(sameOrigin.status, 200);
  const payload = await sameOrigin.json() as { runs: Array<{ run_id: string }> };
  assert.deepEqual(payload.runs.map((run) => run.run_id), ["origin-run"]);
  await started.stop();
});

test("desktop launch URLs are redacted before logging", () => {
  assert.equal(
    redactStudioUrlForLog("http://127.0.0.1:6123/?token=secret-token&view=runs"),
    "http://127.0.0.1:6123/?token=<redacted>&view=runs",
  );
  assert.doesNotMatch(
    redactStudioUrlForLog("http://127.0.0.1:6123/?token=secret-token"),
    /secret-token/,
  );
});

test("desktop launch JSON exposes a cookie-authenticated URL for the Tauri shell", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "launch-json-run");

  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "launch-json-token",
  });
  test.after(() => {
    void started.stop();
  });

  const line = serializeStudioDesktopLaunchEvent(started);
  assert.equal(line.endsWith("\n"), false);
  const payload = JSON.parse(line) as {
    schema_version: number;
    event: string;
    server_url: string;
    webview_url: string;
    workspace: string;
    token?: string;
  };

  assert.deepEqual(Object.keys(payload).sort(), [
    "event",
    "schema_version",
    "server_url",
    "webview_url",
    "workspace",
  ]);
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.event, "agentmesh_studio_ready");
  assert.equal(payload.server_url, started.serverUrl);
  assert.equal(payload.webview_url, `${started.serverUrl}/`);
  assert.doesNotMatch(payload.webview_url, /token=/);
  assert.equal(payload.workspace, workspace);
  assert.equal(payload.token, undefined);
  assert.doesNotMatch(line, /launch-json-token/);
  await started.stop();
});

test("startStudioDesktopHost uses runtime APIs for mutations without a bundled CLI", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "mutation-run");

  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "mutation-token",
  });
  test.after(() => {
    void started.stop();
  });

  const response = await fetch(`${started.serverUrl}/api/mutations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "agentmesh_studio_token=mutation-token",
    },
    body: JSON.stringify({
      action: "attach",
      run_id: "mutation-run",
      stage: "plan",
      text: "desktop attach",
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json() as {
    command: string[];
    stdout: string;
  };
  assert.deepEqual(result.command, [
    "runtime",
    "flow",
    "attach",
    "mutation-run",
    "--stage",
    "plan",
    "--text",
    "desktop attach",
  ]);
  assert.match(result.stdout, /Attached:/);
  await started.stop();
});

test("desktop integrations expose no-global CLI status without blocking Studio", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "no-global-cli-run");
  const fakeHome = path.join(workspace, "home");
  const opencodePath = writeFakeProviderCli(
    path.join(fakeHome, ".opencode", "bin"),
    "opencode",
    "opencode 9.9.9",
  );

  const previousPath = process.env.PATH;
  const previousHome = process.env.HOME;
  const previousShell = process.env.SHELL;
  process.env.PATH = "";
  process.env.HOME = fakeHome;
  process.env.SHELL = path.join(workspace, "missing-shell");
  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "integration-token",
  });
  try {
    const response = await fetch(`${started.serverUrl}/api/desktop/integrations`, {
      headers: { cookie: "agentmesh_studio_token=integration-token" },
    });
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const payload = JSON.parse(responseText) as {
      command_line_tool: {
        supported: boolean;
        path_command: { found: boolean; source: string };
      };
      skills: { targets: Array<{ target: string; status: string }> };
      provider_clis: {
        tools: Array<{
          tool: string;
          adapter: string;
          command: string;
          found: boolean;
          source: string;
          path?: string;
          version: string;
        }>;
      };
    };
    assert.equal(payload.command_line_tool.supported, true);
    assert.equal(payload.command_line_tool.path_command.found, false);
    assert.equal(payload.command_line_tool.path_command.source, "missing");
    assert.deepEqual(
      payload.provider_clis.tools.map((tool) => tool.tool).sort(),
      ["antigravity", "claude", "codex", "cursor", "opencode"],
    );
    const opencode = payload.provider_clis.tools.find((tool) => tool.tool === "opencode");
    assert.equal(opencode?.adapter, "opencode-cli");
    assert.equal(opencode?.command, "opencode");
    assert.equal(opencode?.found, true);
    assert.equal(opencode?.source, "well_known");
    assert.equal(opencode?.path, opencodePath);
    assert.equal(opencode?.version, "opencode 9.9.9");
    assert.deepEqual(
      payload.skills.targets.map((target) => target.target).sort(),
      ["antigravity", "claude", "codex", "copilot", "cursor", "opencode"],
    );

    const runs = await fetch(`${started.serverUrl}/api/runs`, {
      headers: { cookie: "agentmesh_studio_token=integration-token" },
    });
    assert.equal(runs.status, 200, await runs.text());
  } finally {
    process.env.PATH = previousPath;
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = previousShell;
    }
    await started.stop();
  }
});

test("desktop command-line tool install requires confirmation and writes an app-managed wrapper", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const existingBin = path.join(workspace, "existing-bin");
  const installBin = path.join(workspace, "install-bin");
  const existingCommand = writeFakeAgentmesh(existingBin);

  const previousPath = process.env.PATH;
  process.env.PATH = existingBin;
  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "tool-token",
  });
  try {
    const denied = await fetch(`${started.serverUrl}/api/desktop/integrations/command-line-tool`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "agentmesh_studio_token=tool-token",
      },
      body: JSON.stringify({ bin_dir: installBin }),
    });
    assert.equal(denied.status, 409, await denied.text());
    assert.equal(readFileSync(existingCommand, "utf-8"), "#!/bin/sh\necho fake-agentmesh \"$@\"\n");

    const installed = await fetch(`${started.serverUrl}/api/desktop/integrations/command-line-tool`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "agentmesh_studio_token=tool-token",
      },
      body: JSON.stringify({ bin_dir: installBin, confirm_existing: true }),
    });
    const installedText = await installed.text();
    assert.equal(installed.status, 200, installedText);
    const payload = JSON.parse(installedText) as {
      installed: { path: string; replaced_existing: boolean };
      command_line_tool: {
        path_command: { path?: string; source: string };
        target_path: string;
        target_file: { exists: boolean; source: string; version: string; different: boolean };
      };
    };
    const wrapperPath = path.join(installBin, "agentmesh");
    assert.equal(payload.installed.path, wrapperPath);
    assert.equal(payload.installed.replaced_existing, false);
    assert.equal(payload.command_line_tool.target_path, wrapperPath);
    assert.deepEqual(payload.command_line_tool.target_file, {
      exists: true,
      source: "app_wrapper",
      version: "0.1.3",
      different: false,
    });
    assert.equal(payload.command_line_tool.path_command.path, existingCommand);
    assert.equal(payload.command_line_tool.path_command.source, "external");
    const wrapper = readFileSync(wrapperPath, "utf-8");
    assert.match(wrapper, /agentmesh_app_managed=true/);
    assert.match(wrapper, /agentmesh_cli_version=0\.1\.3/);

    const help = execFileSync(wrapperPath, ["--help"], {
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: installBin,
        HOME: path.join(workspace, "home"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(help, "");
  } finally {
    process.env.PATH = previousPath;
    await started.stop();
  }
});

test("desktop command-line tool install requires confirmation before replacing target file", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const installBin = path.join(workspace, "install-bin");
  const existingTarget = writeFakeAgentmesh(installBin);

  const previousPath = process.env.PATH;
  process.env.PATH = "";
  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "target-conflict-token",
  });
  try {
    const denied = await fetch(`${started.serverUrl}/api/desktop/integrations/command-line-tool`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "agentmesh_studio_token=target-conflict-token",
      },
      body: JSON.stringify({ bin_dir: installBin }),
    });
    assert.equal(denied.status, 409, await denied.text());
    assert.equal(readFileSync(existingTarget, "utf-8"), "#!/bin/sh\necho fake-agentmesh \"$@\"\n");

    const installed = await fetch(`${started.serverUrl}/api/desktop/integrations/command-line-tool`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "agentmesh_studio_token=target-conflict-token",
      },
      body: JSON.stringify({ bin_dir: installBin, confirm_existing: true }),
    });
    const installedText = await installed.text();
    assert.equal(installed.status, 200, installedText);
    const payload = JSON.parse(installedText) as {
      installed: { path: string; replaced_existing: boolean };
      command_line_tool: {
        target_path: string;
        requires_confirmation: boolean;
        target_file: { exists: boolean; source: string; version: string; different: boolean };
      };
    };
    assert.equal(payload.installed.path, existingTarget);
    assert.equal(payload.installed.replaced_existing, true);
    assert.equal(payload.command_line_tool.target_path, existingTarget);
    assert.equal(payload.command_line_tool.requires_confirmation, false);
    assert.deepEqual(payload.command_line_tool.target_file, {
      exists: true,
      source: "app_wrapper",
      version: "0.1.3",
      different: false,
    });
  } finally {
    process.env.PATH = previousPath;
    await started.stop();
  }
});

test("desktop skill install writes only selected targets and reports each result", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const workspaceSkillDir = path.join(workspace, "packages", "skills", "agentmesh-skill");
  mkdirSync(workspaceSkillDir, { recursive: true });
  writeFileSync(path.join(workspaceSkillDir, "SKILL.md"), "# Wrong Workspace Skill\n");

  const started = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "skill-token",
  });
  try {
    const response = await fetch(`${started.serverUrl}/api/desktop/integrations/skills`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "agentmesh_studio_token=skill-token",
      },
      body: JSON.stringify({ targets: ["codex", "claude"], force: true }),
    });
    const responseText = await response.text();
    assert.equal(response.status, 200, responseText);
    const payload = JSON.parse(responseText) as {
      installed_targets: Array<{ target: string; ok: boolean }>;
      skills: { targets: Array<{ target: string; ok: boolean; status: string }> };
    };
    assert.deepEqual(payload.installed_targets.map((target) => target.target), ["codex", "claude"]);
    assert.deepEqual(payload.installed_targets.map((target) => target.ok), [true, true]);
    assert.equal(existsSync(path.join(workspace, ".agents", "skills", "agentmesh", "SKILL.md")), true);
    assert.equal(existsSync(path.join(workspace, ".claude", "skills", "agentmesh", "SKILL.md")), true);
    assert.equal(existsSync(path.join(workspace, ".cursor", "rules", "agentmesh.mdc")), false);
    const installedSkill = readFileSync(
      path.join(workspace, ".agents", "skills", "agentmesh", "SKILL.md"),
      "utf-8",
    );
    assert.doesNotMatch(installedSkill, /Wrong Workspace Skill/);
    assert.match(installedSkill, /# AgentMesh Skill/);
    assert.match(installedSkill, /AgentMesh CLI version: 0\.1\.3/);
    assert.equal(
      payload.skills.targets.find((target) => target.target === "codex")?.status,
      "ok",
    );
    assert.equal(
      payload.skills.targets.find((target) => target.target === "claude")?.status,
      "ok",
    );
    assert.equal(
      payload.skills.targets.find((target) => target.target === "cursor")?.status,
      "ok",
    );
  } finally {
    await started.stop();
  }
});

test("startStudioDesktopHost reports actionable port allocation errors", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const blocker = createServer();
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  test.after(() => blocker.close());
  const address = blocker.address();
  assert.ok(address && typeof address === "object");

  await assert.rejects(
    () => startStudioDesktopHost({
      workspace,
      port: address.port,
      token: "blocked-token",
    }),
    /Unable to start AgentMesh App Server on 127\.0\.0\.1/,
  );
});

test("restartStudioDesktopHost replaces the launch token after sidecar exit", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  writeRun(workspace, "restart-run");

  const first = await startStudioDesktopHost({
    workspace,
    port: 0,
    token: "first-token",
  });
  const restarted = await restartStudioDesktopHost(first, {
    workspace,
    port: 0,
    token: "second-token",
  });
  test.after(() => {
    void restarted.stop();
  });

  assert.equal(first.server.listening, false);
  assert.equal(restarted.token, "second-token");
  assert.equal(restarted.webviewUrl, `${restarted.serverUrl}/`);

  const staleQueryToken = await fetch(`${restarted.serverUrl}/api/health?token=first-token`);
  assert.equal(staleQueryToken.status, 401);

  const staleCookie = await fetch(`${restarted.serverUrl}/api/health`, {
    headers: { cookie: "agentmesh_studio_token=first-token" },
  });
  assert.equal(staleCookie.status, 401);

  const freshCookie = await fetch(`${restarted.serverUrl}/api/health`, {
    headers: { cookie: "agentmesh_studio_token=second-token" },
  });
  assert.equal(freshCookie.status, 200);
  await restarted.stop();
});

function requestRaw(
  target: string,
  headers: Record<string, string>,
  method = "GET",
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const url = new URL(target);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: url.hostname,
      port: Number(url.port),
      path: `${url.pathname}${url.search}`,
      method,
      headers,
    }, (response) => {
      let body = "";
      response.setEncoding("utf-8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body,
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}
