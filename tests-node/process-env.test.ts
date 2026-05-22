import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildAgentProcessEnv,
  resetAgentProcessEnvCache,
} from "../packages/runtime/src/process-env.js";

const MACOS_PROXY_OUTPUT = `
<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
    2 : *.local
  }
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}
`;

test.beforeEach(() => {
  resetAgentProcessEnvCache();
});

test("agent process environment inherits base env and macOS system proxy", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: { PATH: "/bin" },
    platform: "darwin",
    macProxyOutput: MACOS_PROXY_OUTPUT,
  });

  assert.equal(env.PATH, "/bin");
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(env.http_proxy, "http://127.0.0.1:7897");
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:7897");
  assert.equal(env.https_proxy, "http://127.0.0.1:7897");
  assert.equal(env.ALL_PROXY, "socks5://127.0.0.1:7897");
  assert.equal(env.all_proxy, "socks5://127.0.0.1:7897");
  assert.equal(env.NO_PROXY, "127.0.0.1,localhost,*.local");
  assert.equal(env.no_proxy, "127.0.0.1,localhost,*.local");
});

test("agent process environment drops undefined base entries", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: { PATH: "/bin", HTTP_PROXY: undefined },
    platform: "linux",
  });

  assert.equal(env.PATH, "/bin");
  assert.equal(Object.hasOwn(env, "HTTP_PROXY"), false);
  assert.equal(Object.hasOwn(env, "http_proxy"), false);
});

test("agent configured env overrides inherited system env", () => {
  const env = buildAgentProcessEnv(
    {
      HTTPS_PROXY: "http://agent-proxy:8080",
      CUSTOM_FLAG: "agent",
    },
    {
      baseEnv: { HTTPS_PROXY: "http://shell-proxy:7890" },
      platform: "darwin",
      macProxyOutput: MACOS_PROXY_OUTPUT,
    },
  );

  assert.equal(env.HTTPS_PROXY, "http://agent-proxy:8080");
  assert.equal(env.https_proxy, "http://agent-proxy:8080");
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(env.CUSTOM_FLAG, "agent");
});

test("non-darwin agent process environment mirrors existing proxy aliases only", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: { HTTP_PROXY: "http://shell-proxy:8080" },
    platform: "linux",
    macProxyOutput: MACOS_PROXY_OUTPUT,
  });

  assert.equal(env.HTTP_PROXY, "http://shell-proxy:8080");
  assert.equal(env.http_proxy, "http://shell-proxy:8080");
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.ALL_PROXY, undefined);
});

test("macOS system proxy lookup failures do not remove inherited env", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: { PATH: "/bin" },
    platform: "darwin",
    macProxyCommand: process.execPath,
    macProxyArgs: ["-e", "process.exit(2)"],
  });

  assert.equal(env.PATH, "/bin");
  assert.equal(env.HTTP_PROXY, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
});

test("macOS system proxy lookup timeouts do not remove inherited env", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: { PATH: "/bin" },
    platform: "darwin",
    macProxyCommand: process.execPath,
    macProxyArgs: ["-e", "setTimeout(() => {}, 10000)"],
    macProxyTimeoutMs: 10,
  });

  assert.equal(env.PATH, "/bin");
  assert.equal(env.HTTP_PROXY, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
});

test("macOS system proxy lookup is cached until reset", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-process-env-"));
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const counterPath = path.join(workspace, "counter.txt");
  const script = [
    "const fs = require('fs');",
    `const counterPath = ${JSON.stringify(counterPath)};`,
    "const current = fs.existsSync(counterPath) ? Number(fs.readFileSync(counterPath, 'utf-8')) : 0;",
    "fs.writeFileSync(counterPath, String(current + 1));",
    "console.log('HTTPEnable : 1');",
    "console.log('HTTPProxy : 127.0.0.1');",
    "console.log('HTTPPort : 7897');",
  ].join("");

  const options = {
    baseEnv: {},
    platform: "darwin" as const,
    macProxyCommand: process.execPath,
    macProxyArgs: ["-e", script],
  };
  const first = buildAgentProcessEnv(undefined, options);
  const second = buildAgentProcessEnv(undefined, options);

  assert.equal(first.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(second.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(readFileSync(counterPath, "utf-8"), "1");
});

test("agent configured env can clear inherited proxy aliases", () => {
  const env = buildAgentProcessEnv(
    {
      HTTPS_PROXY: "",
    },
    {
      baseEnv: {},
      platform: "darwin",
      macProxyOutput: MACOS_PROXY_OUTPUT,
    },
  );

  assert.equal(env.HTTPS_PROXY, "");
  assert.equal(env.https_proxy, "");
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7897");
});

test("macOS system proxy parser ignores unrelated scutil keys", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: {},
    platform: "darwin",
    macProxyOutput: `
<dictionary> {
  FTPEnable : 1
  FTPProxy : ftp-proxy.invalid
  FTPPort : 21
  ProxyAutoConfigEnable : 1
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7897
}
`,
  });

  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.ALL_PROXY, undefined);
});
