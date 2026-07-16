import assert from "node:assert/strict";
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
import {
  installStudioCommandLineTool,
  readStudioIntegrations,
  type StudioIntegrationOptions,
} from "../packages/app-server/src/integrations.js";
import { currentPacketStatus } from "./helpers/current-packet-status.js";

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-studio-desktop-"));
}

function isolateHome(home: string): () => void {
  mkdirSync(home, { recursive: true });
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  return () => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  };
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

function writeFakeAgentmesh(binDir: string, version = "0.1.9"): string {
  mkdirSync(binDir, { recursive: true });
  const filePath = path.join(binDir, "agentmesh");
  writeFileSync(filePath, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then",
    `  echo ${JSON.stringify(`agentmesh ${version}`)}`,
    "  exit 0",
    "fi",
    "exit 0",
    "",
  ].join("\n"));
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

test("parseStudioDesktopArgs uses the most recent registered workspace when app cwd is filesystem root", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const fakeHome = path.join(workspace, "home");
  const registeredWorkspace = path.join(workspace, "registered-workspace");
  const tiedWorkspace = path.join(workspace, "tied-workspace");
  const olderWorkspace = path.join(workspace, "older-workspace");
  const disabledWorkspace = path.join(workspace, "disabled-workspace");
  mkdirSync(path.join(registeredWorkspace, "frontend-dist"), { recursive: true });
  mkdirSync(path.join(tiedWorkspace, "frontend-dist"), { recursive: true });
  mkdirSync(olderWorkspace, { recursive: true });
  mkdirSync(disabledWorkspace, { recursive: true });
  const registryPath = path.join(fakeHome, ".config", "agentmesh", "workspaces.json");
  mkdirSync(path.dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify({
    schema_version: 1,
    workspaces: [
      {
        id: "ws-1111111111111111",
        path: olderWorkspace,
        label: "older",
        enabled: true,
        created_at: "2026-07-01T00:00:00.000Z",
        last_seen_at: "2026-07-14T00:00:00.000Z",
      },
      {
        id: "ws-2222222222222222",
        path: registeredWorkspace,
        label: "zzz-recent",
        enabled: true,
        created_at: "2026-07-02T00:00:00.000Z",
        last_seen_at: "2026-07-15T00:00:00.000Z",
        last_recorded_at: "2026-07-16T00:00:00.000Z",
      },
      {
        id: "ws-4444444444444444",
        path: tiedWorkspace,
        label: "aaa-tied-recent",
        enabled: true,
        created_at: "2026-07-02T00:00:00.000Z",
        last_seen_at: "2026-07-15T00:00:00.000Z",
        last_recorded_at: "2026-07-16T00:00:00.000Z",
      },
      {
        id: "ws-3333333333333333",
        path: disabledWorkspace,
        label: "disabled",
        enabled: false,
        created_at: "2026-07-03T00:00:00.000Z",
        last_seen_at: "2026-07-16T01:00:00.000Z",
        last_recorded_at: "2026-07-16T01:00:00.000Z",
      },
    ],
  }, null, 2)}\n`);

  const previousWorkspace = process.env.AGENTMESH_STUDIO_WORKSPACE;
  delete process.env.AGENTMESH_STUDIO_WORKSPACE;
  try {
    assert.deepEqual(
      parseStudioDesktopArgs(["--asset-dir", path.join(tiedWorkspace, "frontend-dist")], {
        cwd: path.parse(workspace).root,
        homeDir: fakeHome,
      }),
      {
        host: "127.0.0.1",
        port: 0,
        workspace: tiedWorkspace,
        assetDir: path.join(tiedWorkspace, "frontend-dist"),
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

test("parseStudioDesktopArgs falls back to home for unusable workspace registries", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const fakeHome = path.join(workspace, "home");
  const assetDir = path.join(workspace, "frontend-dist");
  const disabledWorkspace = path.join(workspace, "disabled-workspace");
  const registryPath = path.join(fakeHome, ".config", "agentmesh", "workspaces.json");
  mkdirSync(path.dirname(registryPath), { recursive: true });
  mkdirSync(assetDir);
  mkdirSync(disabledWorkspace);

  const registryCases = [
    "{not-json",
    JSON.stringify({ schema_version: 2, workspaces: [] }),
    JSON.stringify({
      schema_version: 1,
      workspaces: [{
        id: "ws-5555555555555555",
        path: disabledWorkspace,
        label: "disabled",
        enabled: false,
        created_at: "2026-07-01T00:00:00.000Z",
        last_seen_at: "2026-07-16T00:00:00.000Z",
      }],
    }),
    JSON.stringify({
      schema_version: 1,
      workspaces: [{
        id: "ws-6666666666666666",
        path: path.join(workspace, "deleted-workspace"),
        label: "deleted",
        enabled: true,
        created_at: "2026-07-01T00:00:00.000Z",
        last_seen_at: "2026-07-16T00:00:00.000Z",
      }],
    }),
  ];

  const previousWorkspace = process.env.AGENTMESH_STUDIO_WORKSPACE;
  delete process.env.AGENTMESH_STUDIO_WORKSPACE;
  try {
    for (const registryPayload of registryCases) {
      writeFileSync(registryPath, `${registryPayload}\n`);
      assert.equal(
        parseStudioDesktopArgs(["--asset-dir", assetDir], {
          cwd: path.parse(workspace).root,
          homeDir: fakeHome,
        }).workspace,
        fakeHome,
      );
    }
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
  const restoreHome = isolateHome(path.join(workspace, "home"));
  test.after(restoreHome);

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
  const restoreHome = isolateHome(path.join(workspace, "home"));
  test.after(restoreHome);

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
    integrations: {
      registryFetch: async () => new Response(JSON.stringify({ version: "0.1.10" }), {
        status: 200,
      }),
      discovery: {
        homeDir: fakeHome,
        wellKnownPaths: [path.join(workspace, "empty-bin")],
        shellPath: path.join(workspace, "missing-shell"),
      },
    },
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
        package_name: string;
        installed: boolean;
        status: string;
        installed_version: string;
        latest_version: string;
        source: string;
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
    assert.equal(payload.command_line_tool.package_name, "@jinhx128/agentmesh");
    assert.equal(payload.command_line_tool.installed, false);
    assert.equal(payload.command_line_tool.status, "missing");
    assert.equal(payload.command_line_tool.installed_version, "missing");
    assert.equal(payload.command_line_tool.source, "missing");
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
      ["antigravity", "claude", "codex", "cursor", "opencode"],
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

test("desktop detects and updates the public npm CLI without path input", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  const agentmeshPath = writeFakeAgentmesh(binDir, "0.1.9");
  const npmPath = path.join(binDir, "npm");
  const npmArgsPath = path.join(workspace, "npm-args.json");
  writeFileSync(npmPath, [
    "#!/bin/sh",
    `printf '%s\\n' \"$@\" > ${JSON.stringify(npmArgsPath)}`,
    `cat > ${JSON.stringify(agentmeshPath)} <<'EOF'`,
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo 'agentmesh 0.1.10'; fi",
    "EOF",
    `chmod +x ${JSON.stringify(agentmeshPath)}`,
    "",
  ].join("\n"));
  chmodSync(npmPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:/bin:/usr/bin`;
  let registryCheckCount = 0;
  const integrations = {
    registryFetch: async () => {
      registryCheckCount += 1;
      return new Response(JSON.stringify({ version: "0.1.10" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  } as StudioIntegrationOptions;
  try {
    const before = await readStudioIntegrations({
      cwd: workspace,
      entrypoint: "desktop",
      integrations,
    });
    assert.deepEqual(before.command_line_tool, {
      supported: true,
      package_name: "@jinhx128/agentmesh",
      installed: true,
      path: agentmeshPath,
      source: "path",
      installed_version: "0.1.9",
      latest_version: "0.1.10",
      status: "update_available",
      diagnostics: [],
    });

    const result = await installStudioCommandLineTool({}, {
      cwd: workspace,
      entrypoint: "desktop",
      integrations,
    }) as unknown as {
      command_line_tool: { installed_version: string; status: string };
      operation: { npm_path: string };
    };
    assert.equal(result.command_line_tool.installed_version, "0.1.10");
    assert.equal(result.command_line_tool.status, "current");
    assert.equal(result.operation.npm_path, npmPath);
    assert.deepEqual(readFileSync(npmArgsPath, "utf-8").trim().split("\n"), [
      "install",
      "--global",
      "@jinhx128/agentmesh@latest",
      "--no-audit",
      "--no-fund",
    ]);
    assert.equal(registryCheckCount, 2);
  } finally {
    process.env.PATH = previousPath;
  }
});

test("non-desktop integrations do not query the public npm registry", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  writeFakeAgentmesh(binDir, "0.1.11");

  const previousPath = process.env.PATH;
  process.env.PATH = binDir;
  let registryCheckCount = 0;
  try {
    const result = await readStudioIntegrations({
      cwd: workspace,
      entrypoint: "studio",
      integrations: {
        registryFetch: async () => {
          registryCheckCount += 1;
          return new Response(JSON.stringify({ version: "0.1.11" }), { status: 200 });
        },
      } as StudioIntegrationOptions,
    });
    assert.equal(registryCheckCount, 0);
    assert.equal(result.command_line_tool.supported, false);
    assert.equal(result.command_line_tool.installed_version, "0.1.11");
    assert.equal(result.command_line_tool.latest_version, "unknown");
    assert.equal(result.command_line_tool.status, "unknown");
  } finally {
    process.env.PATH = previousPath;
  }
});

test("desktop offers the stable CLI update to a matching prerelease install", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  const agentmeshPath = writeFakeAgentmesh(binDir, "0.1.10-beta.1");

  const previousPath = process.env.PATH;
  process.env.PATH = binDir;
  try {
    const result = await readStudioIntegrations({
      cwd: workspace,
      entrypoint: "desktop",
      integrations: {
        registryFetch: async () => new Response(JSON.stringify({ version: "0.1.10" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      } as StudioIntegrationOptions,
    });
    assert.equal(result.command_line_tool.path, agentmeshPath);
    assert.equal(result.command_line_tool.installed_version, "0.1.10-beta.1");
    assert.equal(result.command_line_tool.status, "update_available");
  } finally {
    process.env.PATH = previousPath;
  }
});

test("desktop keeps installed CLI status when npm registry is unavailable", async () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const binDir = path.join(workspace, "bin");
  const agentmeshPath = writeFakeAgentmesh(binDir, "0.1.9");

  const previousPath = process.env.PATH;
  process.env.PATH = binDir;
  try {
    const result = await readStudioIntegrations({
      cwd: workspace,
      entrypoint: "desktop",
      integrations: {
        registryFetch: async () => { throw new Error("offline"); },
      } as StudioIntegrationOptions,
    }) as unknown as {
      command_line_tool: {
        path?: string;
        installed_version: string;
        latest_version: string;
        status: string;
        diagnostics: string[];
      };
    };
    assert.equal(result.command_line_tool.path, agentmeshPath);
    assert.equal(result.command_line_tool.installed_version, "0.1.9");
    assert.equal(result.command_line_tool.latest_version, "unknown");
    assert.equal(result.command_line_tool.status, "unknown");
    assert.match(result.command_line_tool.diagnostics.join("\n"), /registry check failed: offline/);
  } finally {
    process.env.PATH = previousPath;
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
    assert.match(installedSkill, /AgentMesh CLI version: 0\.1\.12/);
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
