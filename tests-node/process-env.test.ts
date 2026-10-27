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
  assert.equal(env.NO_PROXY, "127.0.0.1,localhost,local");
  assert.equal(env.no_proxy, "127.0.0.1,localhost,local");
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

test("Claude drops host authentication and unauthenticated host routing only", () => {
  const baseEnv = {
    PATH: "/bin",
    HOME: "/home/user",
    CLAUDECODE: "1",
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
    CLAUDE_CODE_HOST_AUTH_ENV_VAR: "DESKTOP_GATEWAY_TOKEN",
    ANTHROPIC_BASE_URL: "https://desktop-gateway.invalid",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "user-model",
    ANTHROPIC_MODEL: "user-model",
    CLAUDE_CONFIG_DIR: "/home/user/custom-claude",
    CLAUDE_CODE_SAFE_MODE: "1",
    OPENAI_API_KEY: "user-openai-key",
    CURSOR_API_KEY: "user-cursor-key",
    GEMINI_API_KEY: "user-gemini-key",
    OPENCODE_CONFIG: "/home/user/opencode.json",
  };
  const options = { baseEnv, platform: "linux" as const, adapterId: "claude-code-cli" };
  const env = buildAgentProcessEnv(undefined, options);

  for (const key of Object.keys(baseEnv)) {
    if (key === "CLAUDECODE" || key === "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"
      || key === "CLAUDE_CODE_HOST_AUTH_ENV_VAR" || key === "ANTHROPIC_BASE_URL") {
      assert.equal(Object.hasOwn(env, key), false, `${key} must not reach an independent agent`);
    } else {
      assert.equal(env[key], baseEnv[key as keyof typeof baseEnv]);
    }
  }
  assert.equal(baseEnv.CLAUDECODE, "1", "must not mutate the parent environment");
  assert.equal(baseEnv.ANTHROPIC_BASE_URL, "https://desktop-gateway.invalid");
});

test("host managed marker does not erase independently configured provider credentials", () => {
  for (const credential of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
    const options = {
      adapterId: "claude-code-cli",
      platform: "linux" as const,
      baseEnv: {
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
        [credential]: "user-credential",
        ANTHROPIC_BASE_URL: "https://user-provider.invalid",
        ANTHROPIC_MODEL: "user-model",
      },
    };
    const env = buildAgentProcessEnv(undefined, options);
    assert.equal(env[credential], "user-credential");
    assert.equal(env.ANTHROPIC_BASE_URL, "https://user-provider.invalid");
    assert.equal(env.ANTHROPIC_MODEL, "user-model");
    assert.equal(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, undefined);
  }
});

test("non-Claude adapters preserve inherited Anthropic configuration even without credentials", () => {
  for (const adapterId of [undefined, "command", "codex-cli", "cursor-agent", "opencode-cli", "antigravity-cli"]) {
    const options = {
      adapterId, platform: "linux" as const,
      baseEnv: {
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
        ANTHROPIC_BASE_URL: "https://user-provider.invalid",
        ANTHROPIC_MODEL: "user-model",
      },
    };
    const env = buildAgentProcessEnv(undefined, options);
    assert.equal(env.ANTHROPIC_BASE_URL, options.baseEnv.ANTHROPIC_BASE_URL, adapterId);
    assert.equal(env.ANTHROPIC_MODEL, "user-model", adapterId);
  }
});

test("Windows host isolation handles case-insensitive names without changing unrelated casing", () => {
  const options = {
    adapterId: "claude-code-cli", platform: "win32" as const,
    baseEnv: {
      Claude_Code_Provider_Managed_By_Host: "1",
      claude_code_host_auth_env_var: "HOST_TOKEN",
      claudecode: "1",
      anthropic_base_url: "https://desktop-gateway.invalid",
      Path: "C:\\Windows",
    },
  };
  assert.deepEqual(buildAgentProcessEnv(undefined, options), { Path: "C:\\Windows" });
  const authenticated = buildAgentProcessEnv(undefined, {
    ...options, baseEnv: { ...options.baseEnv, anthropic_api_key: "user-key" },
  });
  assert.equal(authenticated.anthropic_api_key, "user-key");
  assert.equal(authenticated.anthropic_base_url, options.baseEnv.anthropic_base_url);
});

test("Windows explicit env replaces all inherited case variants", () => {
  const env = buildAgentProcessEnv({ ANTHROPIC_API_KEY: "explicit-key", Path: "C:\\agent" }, {
    platform: "win32",
    baseEnv: { anthropic_api_key: "inherited-key", Anthropic_Api_Key: "duplicate", PATH: "C:\\host" },
  });
  assert.deepEqual(env, { ANTHROPIC_API_KEY: "explicit-key", Path: "C:\\agent" });
});

test("POSIX environment names remain case-sensitive", () => {
  const options = {
    adapterId: "claude-code-cli", platform: "linux" as const,
    baseEnv: { claude_code_provider_managed_by_host: "1", anthropic_base_url: "user-route", claudecode: "1" },
  };
  assert.deepEqual(buildAgentProcessEnv(undefined, options), options.baseEnv);
});

test("terminal provider credentials survive without a host-managed provider", () => {
  for (const managedFlag of [undefined, "0", ""]) {
    const env = buildAgentProcessEnv(undefined, {
      baseEnv: {
        CLAUDECODE: "1",
        CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: managedFlag,
        ANTHROPIC_BASE_URL: "https://user-provider.invalid",
        ANTHROPIC_API_KEY: "user-key",
        ANTHROPIC_AUTH_TOKEN: "user-token",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "user-model",
      },
      platform: "linux",
    });
    assert.equal(env.CLAUDECODE, undefined);
    assert.equal(env.ANTHROPIC_BASE_URL, "https://user-provider.invalid");
    assert.equal(env.ANTHROPIC_API_KEY, "user-key");
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, "user-token");
    assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, "user-model");
  }
});

test("independent agents do not inherit a host auth reference even without the managed flag", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: { CLAUDE_CODE_HOST_AUTH_ENV_VAR: "DESKTOP_GATEWAY_TOKEN" },
    platform: "linux",
  });
  assert.equal(Object.hasOwn(env, "CLAUDE_CODE_HOST_AUTH_ENV_VAR"), false);
});

test("explicit agent configuration wins after host environment isolation", () => {
  const overrides = {
    ANTHROPIC_BASE_URL: "https://agent-provider.invalid",
    ANTHROPIC_AUTH_TOKEN: "agent-token",
    ANTHROPIC_MODEL: "agent-model",
    CLAUDE_CODE_HOST_AUTH_ENV_VAR: "AGENT_TOKEN",
  };
  const env = buildAgentProcessEnv(overrides, {
    baseEnv: {
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: "1",
      ANTHROPIC_BASE_URL: "https://desktop-gateway.invalid",
      ANTHROPIC_AUTH_TOKEN: "host-token",
    },
    platform: "linux",
  });
  for (const [key, value] of Object.entries(overrides)) assert.equal(env[key], value);
  assert.equal(env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST, undefined);
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

test("macOS proxy exceptions are rewritten to the portable NO_PROXY spelling", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: {},
    platform: "darwin",
    macProxyOutput: `
<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : 192.168.0.0/16
    2 : localhost
    3 : *.local
    4 : *.internal.example.com
    5 : <local>
    6 : .legacy.example.com
    7 : internal.example.com
  }
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7897
}
`,
  });

  // `*.host` and `.host` collapse to the bare host, `<local>` is dropped, and the duplicate
  // that entry 4 collapses into is not repeated.
  assert.equal(
    env.NO_PROXY,
    "127.0.0.1,192.168.0.0/16,localhost,local,internal.example.com,legacy.example.com",
  );
  assert.equal(env.no_proxy, env.NO_PROXY);
});

test("macOS proxy exception wildcard entry keeps bypassing every host", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: {},
    platform: "darwin",
    macProxyOutput: `
<dictionary> {
  ExceptionsList : <array> {
    0 : *
  }
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7897
}
`,
  });

  assert.equal(env.NO_PROXY, "*");
});

test("macOS proxy exceptions with no portable meaning leave NO_PROXY unset", () => {
  const env = buildAgentProcessEnv(undefined, {
    baseEnv: {},
    platform: "darwin",
    macProxyOutput: `
<dictionary> {
  ExceptionsList : <array> {
    0 : <local>
  }
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7897
}
`,
  });

  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:7897");
  assert.equal(env.NO_PROXY, undefined);
  assert.equal(env.no_proxy, undefined);
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
