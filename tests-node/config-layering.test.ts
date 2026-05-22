import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../packages/runtime/src/config.js";

interface Sandbox {
  root: string;
  workspace: string;
  home: string;
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), "agentmesh-config-layering-"));
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "home");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { root, workspace, home };
}

function writeConfig(filePath: string, lines: string[]): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${lines.join("\n")}\n`, { encoding: "utf-8" });
}

function userConfig(home: string): string {
  return path.join(home, ".config", "agentmesh", "config.toml");
}

function projectConfig(workspace: string): string {
  return path.join(workspace, ".agentmesh", "config.toml");
}

function withAgentmeshEnv(
  home: string,
  envConfig: string | undefined,
  action: () => void,
): void {
  const previousHome = process.env.HOME;
  const previousConfig = process.env.AGENTMESH_CONFIG;
  process.env.HOME = home;
  if (envConfig) {
    process.env.AGENTMESH_CONFIG = envConfig;
  } else {
    delete process.env.AGENTMESH_CONFIG;
  }
  try {
    action();
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
}

function assertProjectConfigThrows(lines: string[], pattern: RegExp): void {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(projectConfig(sandbox.workspace), lines);
  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(() => loadConfig(undefined, sandbox.workspace), pattern);
  });
}

function assertUserConfigThrows(lines: string[], pattern: RegExp): void {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), lines);
  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(() => loadConfig(undefined, sandbox.workspace), pattern);
  });
}

test("loadConfig reads user config when no project config exists", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[agents.user_planner]",
    'adapter = "command"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(undefined, sandbox.workspace);
    assert.deepEqual(Object.keys(config.agents), ["user_planner"]);
  });
});

test("loadConfig rejects resource sections in project config", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[agents.project_executor]",
    'adapter = "command"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /agents are user-scoped and cannot be set in project config/,
    );
  });
});

test("loadConfig rejects MCP server sections in project config", () => {
  assertProjectConfigThrows([
    "schema_version = 1",
    "",
    "[mcp_servers.docs]",
    'command = "docs-mcp"',
  ], /mcp_servers are user-scoped and cannot be set in project config/);
});

test("loadConfig merges user resources and project policy layers", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[agents.user_planner]",
    'adapter = "command"',
    "",
    "[mcp_servers.user_docs]",
    'command = "docs-mcp"',
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[context_policy]",
    "max_files = 5",
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(undefined, sandbox.workspace);
    assert.deepEqual(Object.keys(config.agents), ["user_planner"]);
    assert.deepEqual(Object.keys(config.mcp_servers), ["user_docs"]);
    assert.equal(config.context_policy.max_files, 5);
  });
});

test("loadConfig treats explicit config as highest-precedence overlay", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const overlayConfig = path.join(sandbox.root, "overlay.toml");
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[agents.user_planner]",
    'adapter = "command"',
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[context_policy]",
    "max_files = 5",
  ]);
  writeConfig(overlayConfig, [
    "schema_version = 1",
    "",
    "[agents.overlay_reviewer]",
    'adapter = "command"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(overlayConfig, sandbox.workspace);
    assert.deepEqual(Object.keys(config.agents).sort(), [
      "overlay_reviewer",
      "user_planner",
    ]);
    assert.equal(config.context_policy.max_files, 5);
  });
});

test("loadConfig treats AGENTMESH_CONFIG as highest-precedence overlay", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const envConfig = path.join(sandbox.root, "env-overlay.toml");
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[agents.user_planner]",
    'adapter = "command"',
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[context_policy]",
    "max_files = 5",
  ]);
  writeConfig(envConfig, [
    "schema_version = 1",
    "",
    "[agents.env_reviewer]",
    'adapter = "command"',
  ]);

  withAgentmeshEnv(sandbox.home, envConfig, () => {
    const config = loadConfig(undefined, sandbox.workspace);
    assert.deepEqual(Object.keys(config.agents).sort(), [
      "env_reviewer",
      "user_planner",
    ]);
    assert.equal(config.context_policy.max_files, 5);
  });
});

test("loadConfig rejects explicit agents that redefine user agent ids", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const overlayConfig = path.join(sandbox.root, "overlay.toml");
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[agents.planner]",
    'adapter = "command"',
  ]);
  writeConfig(overlayConfig, [
    "schema_version = 1",
    "",
    "[agents.planner]",
    'adapter = "command"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(overlayConfig, sandbox.workspace),
      /duplicate agents id across config layers: planner/,
    );
  });
});

test("loadConfig rejects duplicate MCP server ids across user and explicit layers", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const overlayConfig = path.join(sandbox.root, "overlay.toml");
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[mcp_servers.docs]",
    'command = "user-docs"',
  ]);
  writeConfig(overlayConfig, [
    "schema_version = 1",
    "",
    "[mcp_servers.docs]",
    'command = "project-docs"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(overlayConfig, sandbox.workspace),
      /duplicate mcp_servers id across config layers: docs/,
    );
  });
});

test("loadConfig rejects malformed MCP server configs", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[mcp_servers.docs]",
    'args = ["--port", "1234"]',
    "",
    "[mcp_servers.bad_args]",
    'command = "mcp-server"',
    'args = ["ok", 7]',
    "",
    '[mcp_servers."bad id"]',
    'command = "mcp-server"',
    "",
    '[mcp_servers."bad:colon"]',
    'command = "mcp-server"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /mcp_servers\.docs\.command is required/,
    );
  });
});

test("loadConfig rejects non-string MCP args", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[mcp_servers.docs]",
    'command = "mcp-server"',
    'args = ["ok", 7]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /mcp_servers\.docs\.args must be a list of strings/,
    );
  });
});

test("loadConfig rejects non-string MCP resource hints", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[mcp_servers.docs]",
    'command = "mcp-server"',
    'resource_hints = ["memory://ok", 42]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /mcp_servers\.docs\.resource_hints must be a list of strings/,
    );
  });
});

test("loadConfig rejects secret-bearing MCP server fields", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[mcp_servers.docs]",
    'command = "mcp-server"',
    'env = ["TOKEN=secret"]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /mcp_servers\.docs\.env is not supported/,
    );
  });
});

test("loadConfig rejects invalid MCP server ids", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    '[mcp_servers."bad id"]',
    'command = "mcp-server"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /mcp_servers id must contain only letters, numbers, dot, underscore, and dash: bad id/,
    );
  });
});

test("loadConfig rejects MCP server ids that contain colons", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    '[mcp_servers."bad:colon"]',
    'command = "mcp-server"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /mcp_servers id must contain only letters, numbers, dot, underscore, and dash: bad:colon/,
    );
  });
});

test("loadConfig accepts project workflow defaults that reference user agent ids", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[agents.reviewer_a]",
    'adapter = "command"',
    "",
    "[agents.reviewer_b]",
    'adapter = "command"',
    "",
    "[agents.decider]",
    'adapter = "command"',
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[workflow_defaults.w-67ef1b1f]",
    'review = ["reviewer_a", "reviewer_b"]',
    'decide = "decider"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(undefined, sandbox.workspace);
    assert.deepEqual(config.workflow_defaults["w-67ef1b1f"], {
      review: ["reviewer_a", "reviewer_b"],
      decide: "decider",
    });
  });
});

test("loadConfig accepts verify workflow defaults and capability profiles", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[agents.verifier]",
    'adapter = "command"',
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[workflow_defaults.verify-flow]",
    'verify = "verifier"',
    "",
    "[capability_profiles.\"verifier.command\"]",
    'stage = "verify"',
    'required_capabilities = ["verify"]',
    "min_count = 1",
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(undefined, sandbox.workspace);
    assert.deepEqual(config.workflow_defaults["verify-flow"], {
      verify: "verifier",
    });
    assert.deepEqual(config.capability_profiles["verifier.command"], {
      stage: "verify",
      required_capabilities: ["verify"],
      min_count: 1,
    });
  });
});

test("loadConfig replaces workflow default arrays across layers instead of appending", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[agents.user_reviewer]",
    'adapter = "command"',
    "",
    "[agents.project_reviewer]",
    'adapter = "command"',
    "",
    "[agents.decider]",
    'adapter = "command"',
    "",
    "[workflow_defaults.w-67ef1b1f]",
    'review = ["user_reviewer"]',
    'decide = "decider"',
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[workflow_defaults.w-67ef1b1f]",
    'review = ["project_reviewer"]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(undefined, sandbox.workspace);
    assert.deepEqual(config.workflow_defaults["w-67ef1b1f"], {
      review: ["project_reviewer"],
      decide: "decider",
    });
  });
});

test("loadConfig rejects workflow defaults that reference unknown agent ids", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[workflow_defaults.w-67ef1b1f]",
    'review = ["missing_reviewer"]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /workflow_defaults\.w-67ef1b1f\.review references unknown agent: missing_reviewer/,
    );
  });
});

test("loadConfig rejects malformed agent registration metadata", () => {
  assertUserConfigThrows([
    "schema_version = 1",
    "",
    "[agents.\"bad id\"]",
    'adapter = "command"',
  ], /agent id may only contain/);

  assertUserConfigThrows([
    "schema_version = 1",
    "",
    "[agents.runner]",
    'adapter = "command"',
    'aliases = ["legacy"]',
  ], /agents\.runner\.aliases is not supported/);

  assertUserConfigThrows([
    "schema_version = 1",
    "",
    "[agents.runner]",
    'adapter = "command"',
    'reasoning_effort = "warp"',
  ], /agents\.runner\.reasoning_effort must be one of/);

  assertUserConfigThrows([
    "schema_version = 1",
    "",
    "[agents.runner]",
    'adapter = "command"',
    "timeout_seconds = 10",
  ], /agents\.runner\.timeout_seconds must be between 30 and 3600/);

});

test("loadConfig merges context policy layers conservatively", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const overlayConfig = path.join(sandbox.root, "overlay.toml");
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[context_policy]",
    "max_bytes = 4096",
    "max_files = 5",
    "freshness_max_age_seconds = 86400",
    'required_sources = ["docs/base.md"]',
    'denied_paths = ["secrets"]',
    'redact_patterns = ["API_KEY=[A-Za-z0-9]+"]',
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[context_policy]",
    "max_bytes = 1024",
    'required_sources = ["docs/project.md"]',
    'denied_paths = ["docs/private.md"]',
    'redact_patterns = ["SECRET=[^\\\\n]+"]',
  ]);
  writeConfig(overlayConfig, [
    "schema_version = 1",
    "",
    "[context_policy]",
    "max_files = 2",
    'required_sources = ["docs/overlay.md"]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(overlayConfig, sandbox.workspace);
    assert.deepEqual(config.context_policy, {
      max_bytes: 1024,
      max_files: 2,
      freshness_max_age_seconds: 86400,
      required_sources: ["docs/base.md", "docs/project.md", "docs/overlay.md"],
      denied_paths: ["secrets", "docs/private.md"],
      redact_patterns: ["API_KEY=[A-Za-z0-9]+", "SECRET=[^\\n]+"],
    });
  });
});

test("loadConfig rejects malformed context policy configs", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[context_policy]",
    "max_bytes = -1",
    'required_sources = ["docs/base.md", 7]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /context_policy\.max_bytes must be a positive integer|context_policy\.required_sources must be a list of strings/,
    );
  });
});

test("loadConfig rejects non-array context policy list fields with schema diagnostics", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[context_policy]",
    "required_sources = 7",
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /context_policy\.required_sources must be a list of strings/,
    );
  });
});

test("loadConfig merges review and release policies by workflow", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const overlayConfig = path.join(sandbox.root, "overlay.toml");
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[review_policy.w-67ef1b1f]",
    'required_review_profiles = ["reviewer.security"]',
    "",
    "[release_policy.w-67ef1b1f]",
    'required_evidence = ["tests"]',
    'needs_decision_risks = ["migration"]',
  ]);
  writeConfig(overlayConfig, [
    "schema_version = 1",
    "",
    "[review_policy.w-67ef1b1f]",
    'required_review_profiles = ["reviewer.accessibility"]',
    "",
    "[release_policy.w-67ef1b1f]",
    'required_evidence = ["diff-check"]',
    'needs_decision_risks = ["data-loss"]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(overlayConfig, sandbox.workspace);
    assert.deepEqual(config.review_policy["w-67ef1b1f"], {
      required_review_profiles: ["reviewer.security", "reviewer.accessibility"],
    });
    assert.deepEqual(config.release_policy["w-67ef1b1f"], {
      required_evidence: ["tests", "diff-check"],
      needs_decision_risks: ["migration", "data-loss"],
    });
  });
});

test("loadConfig rejects user-scoped review and release policy", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[review_policy.w-67ef1b1f]",
    'required_review_profiles = ["reviewer.security"]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /review_policy is project-scoped and cannot be set in user config/,
    );
  });
});

test("loadConfig merges run defaults and execution policy conservatively", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const overlayConfig = path.join(sandbox.root, "overlay.toml");
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[run_defaults]",
    "adapter_timeout_secs = 30",
    "retry_attempts = 2",
    "",
    "[execution_policy]",
    "max_adapter_timeout_secs = 20",
    "max_retry_attempts = 3",
    "require_user_gate = false",
    "allow_auto_dispatch = true",
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[run_defaults]",
    "adapter_timeout_secs = 25",
    "event_page_size = 100",
    "",
    "[execution_policy]",
    "max_adapter_timeout_secs = 10",
    "max_retry_attempts = 1",
    "require_user_gate = true",
  ]);
  writeConfig(overlayConfig, [
    "schema_version = 1",
    "",
    "[execution_policy]",
    "allow_auto_dispatch = false",
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(overlayConfig, sandbox.workspace);
    assert.deepEqual(config.run_defaults, {
      adapter_timeout_secs: 25,
      event_page_size: 100,
      retry_attempts: 2,
    });
    assert.deepEqual(config.execution_policy, {
      max_adapter_timeout_secs: 10,
      max_retry_attempts: 1,
      require_user_gate: true,
      allow_auto_dispatch: false,
    });
  });
});

test("loadConfig parses default primary agents and fallback settings", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const overlayConfig = path.join(sandbox.root, "overlay.toml");
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[agents.common]",
    'adapter = "command"',
    'capabilities = ["plan", "review", "decide"]',
    "",
    "[agents.executor]",
    'adapter = "command"',
    'capabilities = ["execute"]',
    "",
    "[agents.reviewer_a]",
    'adapter = "command"',
    'capabilities = ["review"]',
    "",
    "[agents.reviewer_b]",
    'adapter = "command"',
    'capabilities = ["review"]',
    "",
    "[agents.fallback_common]",
    'adapter = "command"',
    'capabilities = ["plan", "verify", "review", "decide"]',
    "",
    "[agents.fallback_verify]",
    'adapter = "command"',
    'capabilities = ["verify"]',
    "",
    "[default_stage_agents]",
    'agents = ["common"]',
    "",
    "[default_stage_agents.stage_types]",
    'execute = ["executor"]',
    "",
    "[fallback]",
    'agents = ["fallback_common"]',
    "max_attempts_per_agent = 1",
    "timeout_seconds = 900",
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[default_stage_agents.stage_types.review]",
    'agents = ["reviewer_a", "reviewer_b"]',
    "",
    "[fallback.stage_types.verify]",
    'agents = ["fallback_verify"]',
    "inherit_common = true",
    "max_attempts_per_agent = 2",
    "timeout_seconds = 1200",
  ]);
  writeConfig(overlayConfig, [
    "schema_version = 1",
    "",
    "[fallback.stage_types.review]",
    'agents = ["fallback_common"]',
    "inherit_common = false",
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(overlayConfig, sandbox.workspace);
    assert.deepEqual(config.default_stage_agents, {
      agents: ["common"],
      stage_types: {
        execute: { agents: ["executor"] },
        review: { agents: ["reviewer_a", "reviewer_b"] },
      },
    });
    assert.deepEqual(config.fallback, {
      agents: ["fallback_common"],
      max_attempts_per_agent: 1,
      timeout_seconds: 900,
      stage_types: {
        verify: {
          agents: ["fallback_verify"],
          inherit_common: true,
          max_attempts_per_agent: 2,
          timeout_seconds: 1200,
        },
        review: {
          agents: ["fallback_common"],
          inherit_common: false,
        },
      },
    });
  });
});

test("loadConfig rejects malformed default primary and fallback settings", () => {
  const baseAgents = [
    "schema_version = 1",
    "",
    "[agents.executor]",
    'adapter = "command"',
    'capabilities = ["execute"]',
    "",
    "[agents.reviewer]",
    'adapter = "command"',
    'capabilities = ["review"]',
    "",
    "[agents.other]",
    'adapter = "command"',
    'capabilities = ["plan"]',
    "",
  ];

  const assertProjectPolicyThrows = (lines: string[], pattern: RegExp): void => {
    const sandbox = makeSandbox();
    test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
    writeConfig(userConfig(sandbox.home), baseAgents);
    writeConfig(projectConfig(sandbox.workspace), [
      "schema_version = 1",
      "",
      ...lines,
    ]);
    withAgentmeshEnv(sandbox.home, undefined, () => {
      assert.throws(() => loadConfig(undefined, sandbox.workspace), pattern);
    });
  };

  assertProjectPolicyThrows([
    "[default_stage_agents.nodes.review]",
    'agents = ["reviewer"]',
  ], /default_stage_agents\.nodes is not supported/);

  assertProjectPolicyThrows([
    "[default_stage_agents]",
    'agents = ["missing"]',
  ], /default_stage_agents\.agents references unknown agent: missing/);

  assertProjectPolicyThrows([
    "[default_stage_agents.stage_types.review]",
    'agents = ["current", "reviewer"]',
  ], /default_stage_agents\.stage_types\.review\.agents cannot mix current with worker agents/);

  assertProjectPolicyThrows([
    "[default_stage_agents.stage_types.execute]",
    'agents = ["executor", "other"]',
  ], /default_stage_agents\.stage_types\.execute\.agents must contain exactly one agent/);

  assertProjectPolicyThrows([
    "[default_stage_agents.stage_types.review]",
    'agents = ["other"]',
  ], /default_stage_agents\.stage_types\.review\.agents references agent without review capability: other/);

  assertProjectPolicyThrows([
    "[fallback]",
    'agents = ["current"]',
  ], /fallback\.agents must not include current/);

  assertProjectPolicyThrows([
    "[fallback]",
    'agents = ["reviewer"]',
    "timeout_seconds = 10",
  ], /fallback\.timeout_seconds must be between 30 and 3600/);
});

test("loadConfig keeps user model aliases and project capability profiles separate", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[model_aliases.mimo]",
    'adapter = "codex-cli"',
    'model = "gpt-5.5"',
    "",
    "[capability_profile_preferences.\"reviewer.long_context\"]",
    'agents = ["local_reviewer"]',
  ]);
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[capability_profiles.\"reviewer.long_context\"]",
    'stage = "review"',
    'required_capabilities = ["review", "long_context"]',
    "min_count = 1",
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    const config = loadConfig(undefined, sandbox.workspace);
    assert.deepEqual(config.model_aliases.mimo, {
      adapter: "codex-cli",
      model: "gpt-5.5",
    });
    assert.deepEqual(config.capability_profiles["reviewer.long_context"], {
      stage: "review",
      required_capabilities: ["review", "long_context"],
      min_count: 1,
    });
    assert.deepEqual(config.capability_profile_preferences["reviewer.long_context"], {
      agents: ["local_reviewer"],
    });
  });
});

test("loadConfig rejects personal alias sections in project config", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[model_aliases.mimo]",
    'adapter = "codex-cli"',
    'model = "gpt-5.5"',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /model_aliases is user-scoped and cannot be set in project config/,
    );
  });
});

test("loadConfig rejects project capability profiles in user config", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(sandbox.home), [
    "schema_version = 1",
    "",
    "[capability_profiles.\"reviewer.long_context\"]",
    'stage = "review"',
    'required_capabilities = ["review", "long_context"]',
    "min_count = 1",
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /capability_profiles is project-scoped and cannot be set in user config/,
    );
  });
});

test("loadConfig rejects project-scoped capability profile preferences", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeConfig(projectConfig(sandbox.workspace), [
    "schema_version = 1",
    "",
    "[capability_profile_preferences.\"reviewer.long_context\"]",
    'agents = ["local_reviewer"]',
  ]);

  withAgentmeshEnv(sandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, sandbox.workspace),
      /capability_profile_preferences is user-scoped and cannot be set in project config/,
    );
  });
});

test("loadConfig rejects malformed model alias and capability profile configs", () => {
  const badAliasSandbox = makeSandbox();
  test.after(() => rmSync(badAliasSandbox.root, { recursive: true, force: true }));
  writeConfig(userConfig(badAliasSandbox.home), [
    "schema_version = 1",
    "",
    "[model_aliases.mimo]",
    'adapter = "codex-cli"',
    'model = "gpt-5.5"',
    'extra = "ignored"',
  ]);

  withAgentmeshEnv(badAliasSandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, badAliasSandbox.workspace),
      /model_aliases\.mimo\.extra is not supported/,
    );
  });

  const badProfileSandbox = makeSandbox();
  test.after(() => rmSync(badProfileSandbox.root, { recursive: true, force: true }));
  writeConfig(projectConfig(badProfileSandbox.workspace), [
    "schema_version = 1",
    "",
    "[capability_profiles.\"reviewer.long_context\"]",
    'stage = "deploy"',
    'required_capabilities = ["review", "long_context"]',
    "min_count = 1",
  ]);

  withAgentmeshEnv(badProfileSandbox.home, undefined, () => {
    assert.throws(
      () => loadConfig(undefined, badProfileSandbox.workspace),
      /capability_profiles\.reviewer\.long_context\.stage is not a supported stage/,
    );
  });
});
