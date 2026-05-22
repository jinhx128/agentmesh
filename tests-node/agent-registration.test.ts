import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  defaultAgentLabel,
} from "../packages/runtime/src/adapters.js";
import {
  buildAgentRegistrationCandidate,
  probeAgentRegistrationReadiness,
} from "../packages/runtime/src/adapters/registration.js";
import {
  discoverAdapterModels,
  modelDiscoveryHook,
  modelSlugSegment,
  normalizeModelKey,
  resolveAdapterModel,
  resolveKnownAdapterModel,
  resolveKnownAdapterModelWithAliases,
} from "../packages/runtime/src/adapters/models.js";
import {
  createAgentRegistration,
  generateAgentRegistrationId,
} from "../packages/runtime/src/agents/lifecycle.js";

test("model resolver accepts exact and normalized shorthand", () => {
  const discoveredModels = ["gpt-5.5", "gpt-5.4"];

  assert.equal(normalizeModelKey("gpt 5.5"), "gpt-5-5");
  assert.deepEqual(resolveAdapterModel("gpt-5.5", discoveredModels), {
    status: "resolved",
    canonicalModel: "gpt-5.5",
  });
  assert.deepEqual(resolveAdapterModel("gpt55", discoveredModels), {
    status: "resolved",
    canonicalModel: "gpt-5.5",
  });
  assert.deepEqual(resolveAdapterModel("gpt 5.5", discoveredModels), {
    status: "resolved",
    canonicalModel: "gpt-5.5",
  });
});

test("model resolver exposes provider final segment slug", () => {
  const resolved = resolveAdapterModel("anthropic/claude-sonnet-4.5", [
    "anthropic/claude-sonnet-4.5",
  ]);

  assert.deepEqual(resolved, {
    status: "resolved",
    canonicalModel: "anthropic/claude-sonnet-4.5",
  });
  assert.equal(modelSlugSegment("anthropic/claude-sonnet-4.5"), "claude-sonnet-4-5");
});

test("model discovery exposes explicit hooks without returning default models", () => {
  const discovery = discoverAdapterModels("codex");

  assert.equal(discovery.status, "unsupported");
  assert.equal(discovery.adapterId, "codex-cli");
  assert.equal(discovery.source, "unsupported");

  const codexHook = modelDiscoveryHook("codex");
  assert.equal(codexHook.status, "supported");
  assert.equal(codexHook.adapterId, "codex-cli");
  assert.equal(codexHook.strategy, "command");
  assert.deepEqual(codexHook.command, ["codex", "debug", "models", "--bundled"]);

  const opencodeHook = modelDiscoveryHook("opencode");
  assert.equal(opencodeHook.status, "supported");
  assert.equal(opencodeHook.adapterId, "opencode-cli");
  assert.equal(opencodeHook.strategy, "command");
  assert.deepEqual(opencodeHook.command, ["opencode", "models"]);

  const cursorHook = modelDiscoveryHook("cursor");
  assert.equal(cursorHook.status, "supported");
  assert.equal(cursorHook.adapterId, "cursor-agent");
  assert.equal(cursorHook.strategy, "command");
  assert.deepEqual(cursorHook.command, ["cursor-agent", "models"]);

  const antigravityHook = modelDiscoveryHook("antigravity");
  assert.equal(antigravityHook.status, "supported");
  assert.equal(antigravityHook.adapterId, "antigravity-cli");
  assert.equal(antigravityHook.strategy, "executable-strings");
  assert.equal(antigravityHook.commandName, "agy");
});

test("model discovery hydrates codex from the bundled debug model catalog", () => {
  const codex = discoverAdapterModels("codex", {
    runCli: true,
    commandRunner: (command) => {
      assert.deepEqual(command, ["codex", "debug", "models", "--bundled"]);
      return {
        status: 0,
        stdout: JSON.stringify({
          models: [
            { slug: "gpt-5.5", visibility: "list" },
            { slug: "gpt-5.4-mini", visibility: "list" },
            { slug: "codex-auto-review", visibility: "hide" },
            { slug: "internal-debug", visibility: "hidden" },
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.equal(codex.status, "discovered");
  assert.equal(codex.adapterId, "codex-cli");
  assert.equal(codex.source, "adapter-cli");
  assert.ok(codex.models.includes("gpt-5.5"));
  assert.ok(codex.models.includes("gpt-5.4-mini"));
  assert.equal(codex.models.includes("codex-auto-review"), false);
  assert.equal(codex.models.includes("internal-debug"), false);
});

test("model discovery does not return built-in model defaults as discovered models", () => {
  const cursor = discoverAdapterModels("cursor", {
    runCli: true,
    commandRunner: (command) => {
      assert.deepEqual(command, ["cursor-agent", "models"]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.equal(cursor.status, "unsupported");
  assert.equal(cursor.adapterId, "cursor-agent");
  assert.equal(cursor.source, "unsupported");
});

test("model discovery hydrates claude from the installed CLI binary catalog", () => {
  const claude = discoverAdapterModels("claude", {
    runCli: true,
    commandPathResolver: (command) => command === "claude" ? "/tmp/fake-claude" : undefined,
    commandRunner: (command) => {
      assert.deepEqual(command, ["strings", "/tmp/fake-claude"]);
      return {
        status: 0,
        stdout: [
          "claude-code-cli",
          "claude-opus-4-7",
          "claude-sonnet-4-6",
          "claude-haiku-4-5",
          "claude-desktop-settings",
        ].join("\n"),
        stderr: "",
      };
    },
  });

  assert.equal(claude.status, "discovered");
  assert.equal(claude.source, "adapter-cli");
  assert.ok(claude.models.includes("claude-opus-4-7"));
  assert.ok(claude.models.includes("claude-sonnet-4-6"));
  assert.ok(claude.models.includes("claude-haiku-4-5"));
  assert.equal(claude.models.includes("claude-code-cli"), false);
  assert.equal(claude.models.includes("claude-desktop-settings"), false);
});

test("model discovery hydrates antigravity from local user model data", () => {
  const antigravity = discoverAdapterModels("antigravity", {
    runCli: true,
    commandPathResolver: (command) => command === "agy" ? "/tmp/fake-agy" : undefined,
    userDataTextProvider: () => [
      [
        "AgyAllowedModels",
        "gemini-3.5-flashhidden-id",
        "gemini-3.1-proCustom",
        "gemini-3-pro-previewtext",
        "gemini-2.5-flashuss-model",
        "gemini-3.1-flash-lite",
        "gemini-3.1-flash-image-preview",
        "gemini-2.5-pro-windsurfgenerate",
        "claude-sonnet-4-6",
        "claude-opus-4-6",
        "claude-code-cli",
        "gpt-oss-120b-maasparse",
      ].join("\n"),
    ],
    commandRunner: (command) => {
      assert.deepEqual(command, ["strings", "/tmp/fake-agy"]);
      return {
        status: 0,
        stdout: "gemini-2.5-pro\n",
        stderr: "",
      };
    },
  });

  assert.equal(antigravity.status, "discovered");
  assert.equal(antigravity.adapterId, "antigravity-cli");
  assert.equal(antigravity.source, "adapter-cli");
  assert.ok(antigravity.models.includes("gemini-3.5-flash"));
  assert.ok(antigravity.models.includes("gemini-3.1-pro"));
  assert.ok(antigravity.models.includes("gemini-3-pro-preview"));
  assert.ok(antigravity.models.includes("gemini-2.5-flash"));
  assert.ok(antigravity.models.includes("gemini-3.1-flash-lite"));
  assert.ok(antigravity.models.includes("claude-sonnet-4-6"));
  assert.ok(antigravity.models.includes("claude-opus-4-6"));
  assert.ok(antigravity.models.includes("gpt-oss-120b-maas"));
  assert.equal(antigravity.models.includes("gemini-3.1-flash-image-preview"), false);
  assert.equal(antigravity.models.includes("gemini-2.5-pro-windsurf"), false);
  assert.equal(antigravity.models.includes("claude-code-cli"), false);
});

test("antigravity model discovery merges executable and user data without fallback fixtures", () => {
  const antigravity = discoverAdapterModels("antigravity", {
    runCli: true,
    commandPathResolver: (command) => command === "agy" ? "/tmp/fake-agy" : undefined,
    userDataTextProvider: () => ["gemini-3.1-pro\n"],
    commandRunner: (command) => {
      assert.deepEqual(command, ["strings", "/tmp/fake-agy"]);
      return {
        status: 0,
        stdout: "gemini-2.5-flash\n",
        stderr: "",
      };
    },
  });

  assert.equal(antigravity.status, "discovered");
  assert.deepEqual(antigravity.models, ["gemini-2.5-flash", "gemini-3.1-pro"]);
  assert.equal(antigravity.models.includes("gemini-3.5-flash"), false);
});

test("antigravity model discovery includes dynamically observed local model labels", () => {
  const options = {
    runCli: true,
    commandPathResolver: (command: string) => command === "agy" ? "/tmp/fake-agy" : undefined,
    userDataTextProvider: () => [
      [
        'model_config_manager.go:157] Propagating selected model override to backend: label="Gemini 3.5 Flash (High)"',
        "> Claude Opus 4.6 (Thinking)",
        "GPT-OSS 120B (Medium)",
      ].join("\n"),
    ],
    commandRunner: (command: string[]) => {
      assert.deepEqual(command, ["strings", "/tmp/fake-agy"]);
      return {
        status: 0,
        stdout: "gemini-3.1-pro\n",
        stderr: "",
      };
    },
  };
  const antigravity = discoverAdapterModels("antigravity", options);

  assert.equal(antigravity.status, "discovered");
  assert.deepEqual(antigravity.models, [
    "claude-opus-4-6",
    "gemini-3.1-pro",
    "gemini-3.5-flash",
    "gpt-oss-120b-maas",
  ]);
});

test("model discovery can hydrate supported adapters from their CLI output", () => {
  const opencode = discoverAdapterModels("opencode", {
    runCli: true,
    commandRunner: (command) => {
      assert.deepEqual(command, ["opencode", "models"]);
      return {
        status: 0,
        stdout: [
          "opencode/deepseek-v4-flash-free",
          "openai/gpt-5.5-pro",
          "zhuanzhuan/deepseek-v4-pro",
          "zhuanzhuan/glm-5.1",
          "",
        ].join("\n"),
        stderr: "",
      };
    },
  });

  assert.equal(opencode.status, "discovered");
  assert.equal(opencode.source, "adapter-cli");
  assert.ok(opencode.models.includes("zhuanzhuan/glm-5.1"));
  assert.ok(opencode.models.includes("openai/gpt-5.5-pro"));
  assert.equal(opencode.models.includes("openai/gpt-5.5"), false);

  const cursor = discoverAdapterModels("cursor", {
    runCli: true,
    commandRunner: (command) => {
      assert.deepEqual(command, ["cursor-agent", "models"]);
      return {
        status: 0,
        stdout: [
          "Available models",
          "",
          "auto - Auto",
          "composer-2.5-fast - Composer 2.5 Fast",
          "kimi-k2.5 - Kimi K2.5",
          "",
          "Tip: use --model <id> to switch.",
        ].join("\n"),
        stderr: "",
      };
    },
  });

  assert.equal(cursor.status, "discovered");
  assert.equal(cursor.source, "adapter-cli");
  assert.ok(cursor.models.includes("composer-2.5-fast"));
  assert.ok(cursor.models.includes("kimi-k2.5"));
  assert.equal(cursor.models.includes("composer-2-fast"), false);
});

test("model discovery covers every Studio agent tool explicitly", () => {
  const adapters = [
    "codex-cli",
    "claude-code-cli",
    "cursor-agent",
    "antigravity-cli",
    "opencode-cli",
  ];
  const invokedCommands = new Map<string, string[]>();

  for (const adapter of adapters) {
    const hook = modelDiscoveryHook(adapter);
    const discovery = discoverAdapterModels(adapter, {
      runCli: true,
      commandPathResolver: (command) => {
        if (command === "claude") {
          return "/tmp/fake-claude";
        }
        if (command === "agy") {
          return "/tmp/fake-agy";
        }
        return undefined;
      },
      userDataTextProvider: () => adapter === "antigravity-cli" ? ["gemini-3.1-pro\n"] : [],
      commandRunner: (command) => {
        invokedCommands.set(adapter, command);
        if (adapter === "codex-cli") {
          return {
            status: 0,
            stdout: JSON.stringify({ models: [{ slug: "gpt-5.5", visibility: "list" }] }),
            stderr: "",
          };
        }
        if (adapter === "claude-code-cli") {
          return { status: 0, stdout: "claude-opus-4-7\n", stderr: "" };
        }
        if (adapter === "cursor-agent") {
          return { status: 0, stdout: "composer-2.5-fast\n", stderr: "" };
        }
        if (adapter === "antigravity-cli") {
          return { status: 0, stdout: "gemini-3.1-pro\n", stderr: "" };
        }
        if (adapter === "opencode-cli") {
          return { status: 0, stdout: "openai/gpt-5.5-pro\n", stderr: "" };
        }
        return { status: 0, stdout: "unexpected-model\n", stderr: "" };
      },
    });

    assert.equal(discovery.adapterId, adapter);
    assert.equal(hook.status, "supported");
    assert.equal(discovery.status, "discovered");
    assert.equal(discovery.source, "adapter-cli");
    assert.ok(discovery.models.length > 0);
  }

  assert.deepEqual(
    Array.from(invokedCommands.entries()).sort(),
    [
      ["antigravity-cli", ["strings", "/tmp/fake-agy"]],
      ["claude-code-cli", ["strings", "/tmp/fake-claude"]],
      ["codex-cli", ["codex", "debug", "models", "--bundled"]],
      ["cursor-agent", ["cursor-agent", "models"]],
      ["opencode-cli", ["opencode", "models"]],
    ],
  );
});

test("model discovery reports unsupported for generic command adapter", () => {
  const discovery = discoverAdapterModels("command");

  assert.equal(discovery.status, "unsupported");
  assert.equal(discovery.adapterId, "command");
  assert.equal(discovery.source, "unsupported");
  assert.match(discovery.reason, /does not provide model discovery/i);
});

test("known adapter model resolution uses discovered canonical fixtures", () => {
  assert.deepEqual(resolveKnownAdapterModel("codex", "gpt55"), {
    status: "resolved",
    canonicalModel: "gpt-5.5",
  });
  assert.deepEqual(resolveKnownAdapterModel("cursor", "composer-2"), {
    status: "resolved",
    canonicalModel: "composer-2",
  });
  assert.deepEqual(resolveKnownAdapterModel("cursor", "compose2-fast"), {
    status: "resolved",
    canonicalModel: "composer-2-fast",
  });
  assert.deepEqual(resolveKnownAdapterModel("cursor", "composer2fast"), {
    status: "resolved",
    canonicalModel: "composer-2-fast",
  });
  assert.deepEqual(resolveKnownAdapterModel("command", "custom-model"), {
    status: "resolved",
    canonicalModel: "custom-model",
  });
});

test("composer typo shorthand is scoped to cursor adapter resolution", () => {
  assert.deepEqual(resolveKnownAdapterModel("cursor", "compose"), {
    status: "ambiguous",
    input: "compose",
    candidates: ["composer-2", "composer-2-fast"],
  });
  assert.deepEqual(resolveAdapterModel("opencode", "compose2-fast", ["composer-2-fast"]), {
    status: "not_found",
    input: "compose2-fast",
  });
  assert.deepEqual(resolveAdapterModel("compose2-fast", ["composer-2-fast"]), {
    status: "not_found",
    input: "compose2-fast",
  });
});

test("model resolver uses explicit aliases after adapter discovery misses", () => {
  assert.deepEqual(
    resolveKnownAdapterModelWithAliases("codex", "mimo", {
      mimo: { adapter: "codex-cli", model: "gpt-5.5" },
    }),
    {
      status: "resolved",
      canonicalModel: "gpt-5.5",
    },
  );
  assert.deepEqual(
    resolveKnownAdapterModelWithAliases("codex", "gpt55", {
      gpt55: { adapter: "codex-cli", model: "gpt-5.4" },
    }),
    {
      status: "resolved",
      canonicalModel: "gpt-5.5",
    },
  );
  assert.deepEqual(
    resolveKnownAdapterModelWithAliases("antigravity", "mimo", {
      mimo: { adapter: "codex-cli", model: "gpt-5.5" },
    }),
    {
      status: "not_found",
      input: "mimo",
    },
  );
  assert.deepEqual(
    resolveKnownAdapterModelWithAliases("command", "local", {
      local: { adapter: "command", model: "canonical-local-model" },
    }),
    {
      status: "resolved",
      canonicalModel: "canonical-local-model",
    },
  );
});

test("known adapter model resolution can use live adapter discovery", () => {
  const resolved = resolveKnownAdapterModelWithAliases("cursor", "composer-2.5-fast", {}, {
    runCli: true,
    commandRunner: (command) => {
      assert.deepEqual(command, ["cursor-agent", "models"]);
      return {
        status: 0,
        stdout: [
          "Available models",
          "composer-2.5-fast - Composer 2.5 Fast",
          "",
        ].join("\n"),
        stderr: "",
      };
    },
  });

  assert.deepEqual(resolved, {
    status: "resolved",
    canonicalModel: "composer-2.5-fast",
  });

  const antigravity = resolveKnownAdapterModelWithAliases("antigravity", "gemini35flash", {}, {
    runCli: true,
    commandPathResolver: (command) => command === "agy" ? "/tmp/fake-agy" : undefined,
    userDataTextProvider: () => ['label="Gemini 3.5 Flash (High)"'],
    commandRunner: (command) => {
      assert.deepEqual(command, ["strings", "/tmp/fake-agy"]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(antigravity, {
    status: "resolved",
    canonicalModel: "gemini-3.5-flash",
  });

  assert.deepEqual(resolveKnownAdapterModelWithAliases("antigravity", "current", {}, {
    runCli: true,
    commandPathResolver: (command) => command === "agy" ? "/tmp/fake-agy" : undefined,
    commandRunner: () => ({ status: 0, stdout: "", stderr: "" }),
  }), {
    status: "resolved",
    canonicalModel: "current",
  });
});

test("agent registration id generator emits short ids and skips collisions", () => {
  const candidates = ["a-00000001", "a-00000002", "a-00000003"];
  let nextCandidate = 0;
  const id = generateAgentRegistrationId(new Set(["a-00000001", "a-00000002"]), () =>
    candidates[nextCandidate++]
  );

  assert.equal(id, "a-00000003");
  assert.equal(nextCandidate, 3);
});

test("agent registration uses generated short ids that are unique across user and explicit config layers", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-agent-id-"));
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const home = path.join(workspace, ".home");
  const previousHome = process.env.HOME;
  const previousConfig = process.env.AGENTMESH_CONFIG;
  process.env.HOME = home;
  delete process.env.AGENTMESH_CONFIG;
  try {
    const userConfigPath = path.join(home, ".config", "agentmesh", "config.toml");
    mkdirSync(path.dirname(userConfigPath), { recursive: true });
    writeFileSync(
      userConfigPath,
      [
        "schema_version = 1",
        "",
        "[agents.a-00000001]",
        'adapter = "command"',
        'command = "node"',
        'model = "local"',
        "",
      ].join("\n"),
    );
    const explicitConfigPath = path.join(workspace, "explicit-agentmesh.toml");
    writeFileSync(
      explicitConfigPath,
      [
        "schema_version = 1",
        "",
        "[agents.a-00000002]",
        'adapter = "command"',
        'command = "node"',
        'model = "local"',
        "",
      ].join("\n"),
    );

    const result = createAgentRegistration({
      adapter: "command",
      model: "local",
      command: process.execPath,
      args: ["--version"],
    }, {
      cwd: workspace,
      configPath: explicitConfigPath,
      agentIdGenerator: sequenceAgentIds(["a-00000001", "a-00000002", "a-00000003"]),
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.agentId, "a-00000003");
    const userContent = readFileSync(userConfigPath, "utf-8");
    assert.match(userContent, /\[agents\.a-00000001\]/);
    assert.match(userContent, /\[agents\.a-00000003\]/);
    const explicitContent = readFileSync(explicitConfigPath, "utf-8");
    assert.match(explicitContent, /\[agents\.a-00000002\]/);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousConfig === undefined) {
      delete process.env.AGENTMESH_CONFIG;
    } else {
      process.env.AGENTMESH_CONFIG = previousConfig;
    }
  }
});

test("default agent label uses canonical model and adapter metadata", () => {
  const resolved = resolveKnownAdapterModel("codex", "gpt55");
  assert.equal(resolved.status, "resolved");
  assert.equal(defaultAgentLabel("codex", resolved.canonicalModel), "Codex CLI (gpt-5.5)");
  assert.equal(
    defaultAgentLabel("opencode-cli", "zhuanzhuan/deepseek-v4-pro"),
    "OpenCode CLI (zhuanzhuan/deepseek-v4-pro)",
  );
  assert.equal(defaultAgentLabel("cursor", "composer-2-fast"), "Cursor Agent (composer-2-fast)");
});

test("agent registration candidate is built from canonical adapter and model", () => {
  const resolved = resolveKnownAdapterModel("codex", "gpt55");
  assert.equal(resolved.status, "resolved");

  const candidate = buildAgentRegistrationCandidate({
    agentId: "a-12345678",
    adapter: "codex",
    model: resolved.canonicalModel,
    reasoningEffort: "high",
  });

  assert.equal(candidate.id, "a-12345678");
  assert.equal(candidate.label, "Codex CLI (gpt-5.5)");
  assert.equal(candidate.adapter, "codex-cli");
  assert.equal(candidate.command, "codex");
  assert.deepEqual(candidate.args, ["exec"]);
  assert.equal(candidate.model, "gpt-5.5");
  assert.equal(candidate.reasoning_effort, "high");
  assert.deepEqual(candidate.capabilities, ["plan", "execute", "verify", "review", "decide"]);
});

function sequenceAgentIds(ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? ids.at(-1) ?? "a-ffffffff";
}

test("agent registration candidate honors explicit capabilities over defaults", () => {
  const candidate = buildAgentRegistrationCandidate({
    agentId: "a-11111111",
    adapter: "codex",
    model: "gpt-5.5",
    capabilities: ["plan", "decide"],
    timeoutSeconds: 1200,
  });

  assert.deepEqual(candidate.capabilities, ["plan", "decide"]);
  assert.equal(candidate.timeout_seconds, 1200);
});

test("agent registration candidate rejects invalid static metadata", () => {
  assert.throws(
    () => buildAgentRegistrationCandidate({
      agentId: "bad id",
      adapter: "codex",
      model: "gpt-5.5",
    }),
    /agent id may only contain/,
  );
  assert.throws(
    () => buildAgentRegistrationCandidate({
      agentId: "a-33333333",
      adapter: "codex",
      model: "gpt-5.5",
      capabilities: ["bad capability"],
    }),
    /agent capability may only contain/,
  );
  assert.throws(
    () => buildAgentRegistrationCandidate({
      agentId: "a-44444444",
      adapter: "codex",
      model: "gpt-5.5",
      reasoningEffort: "warp",
    }),
    /reasoning_effort must be one of/,
  );
  assert.throws(
    () => buildAgentRegistrationCandidate({
      agentId: "a-55555555",
      adapter: "codex",
      model: "gpt-5.5",
      timeoutSeconds: 10,
    } as any),
    /timeout_seconds must be between 30 and 3600/,
  );
});

test("agent registration readiness treats command adapters as command-existence only", () => {
  const candidate = buildAgentRegistrationCandidate({
    agentId: "a-66666666",
    adapter: "command",
    model: "custom",
    command: process.execPath,
    label: "Local Echo",
  });

  const result = probeAgentRegistrationReadiness(candidate);

  assert.equal(result.ok, true);
  assert.equal(result.report.classification, "ready");
  assert.equal(result.report.help_probe, "not_applicable");
  assert.equal(result.report.version_probe, "not_applicable");
});

test("model resolver reports ambiguous shorthand candidates", () => {
  assert.deepEqual(resolveAdapterModel("gpt5", ["gpt-5.5", "gpt-5.4"]), {
    status: "ambiguous",
    input: "gpt5",
    candidates: ["gpt-5.4", "gpt-5.5"],
  });
});

test("model resolver reports not_found for unknown input", () => {
  assert.deepEqual(resolveAdapterModel("gpt-6", ["gpt-5.5", "gpt-5.4"]), {
    status: "not_found",
    input: "gpt-6",
  });
});

test("model resolver reports not_found for punctuation-only input", () => {
  assert.deepEqual(resolveAdapterModel("!!!", ["gpt-5.5", "gpt-5.4"]), {
    status: "not_found",
    input: "!!!",
  });
});
