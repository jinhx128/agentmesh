import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ReviewerAvailabilityRecordSchema,
  ReviewerRegistryEntrySchema,
  ReviewerRegistrySchema,
} from "../packages/core/src/index.js";
import { buildReviewerRegistry } from "../packages/runtime/src/review/registry.js";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "agentmesh-reviewer-registry-"));
}

function writeConfig(workspace: string): string {
  const configPath = path.join(workspace, "agentmesh.toml");
  writeFileSync(
    configPath,
    [
      "schema_version = 1",
      "",
      "[agents.reviewer]",
      'label = "Antigravity Reviewer"',
      'adapter = "antigravity-cli"',
      'command = "agy"',
      'model = "gemini-3.1-pro"',
      'capabilities = ["review", "decide"]',
      "",
      "[agents.executor]",
      'label = "Executor Only"',
      'adapter = "command"',
      `command = "${process.execPath}"`,
      'capabilities = ["execute"]',
      "",
    ].join("\n"),
  );
  return configPath;
}

test("core validates reviewer registry metadata", () => {
  const availability = ReviewerAvailabilityRecordSchema.parse({
    state: "available",
    reason: "agent has review capability",
  });
  assert.equal(availability.state, "available");

  const entry = ReviewerRegistryEntrySchema.parse({
    schema_version: 1,
    id: "reviewer",
    label: "Antigravity Reviewer",
    adapter_target: "antigravity-cli",
    expected_output_format: "agentmesh-review-markdown-v1",
    availability,
  });
  assert.equal(entry.adapter_target, "antigravity-cli");

  const registry = ReviewerRegistrySchema.parse({
    schema_version: 1,
    expected_output_format: "agentmesh-review-markdown-v1",
    reviewers: [entry],
  });
  assert.equal(registry.reviewers[0].id, "reviewer");
  assert.throws(() =>
    ReviewerAvailabilityRecordSchema.parse({
      state: "maybe",
    }),
  );
});

test("reviewer registry derives availability metadata from configured agents", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const configPath = writeConfig(workspace);

  const registry = buildReviewerRegistry(configPath);

  assert.equal(registry.schema_version, 1);
  assert.equal(registry.expected_output_format, "agentmesh-review-markdown-v1");
  const reviewer = registry.reviewers.find((entry) => entry.id === "reviewer");
  assert.equal(reviewer?.label, "Antigravity Reviewer");
  assert.equal(reviewer?.adapter_target, "antigravity-cli");
  assert.equal(reviewer?.availability.state, "available");
  assert.equal(reviewer?.source_layer, "explicit");
  assert.match(reviewer?.source_path ?? "", /agentmesh\.toml$/);
  assert.deepEqual(reviewer?.capability_profiles, ["review"]);

  const executor = registry.reviewers.find((entry) => entry.id === "executor");
  assert.equal(executor?.availability.state, "unavailable");
  assert.match(executor?.availability.reason ?? "", /lacks review capability/);
});

test("reviewers list CLI emits human and JSON registry metadata", () => {
  const workspace = makeWorkspace();
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const configPath = writeConfig(workspace);

  const json = spawnSync(
    process.execPath,
    [cliPath, "--config", configPath, "reviewers", "list", "--json"],
    { cwd: workspace, encoding: "utf-8" },
  );
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.reviewers[0].expected_output_format, "agentmesh-review-markdown-v1");
  assert.equal(
    payload.reviewers.some(
      (entry: { id: string; availability: { state: string } }) =>
        entry.id === "executor" && entry.availability.state === "unavailable",
    ),
    true,
  );

  const human = spawnSync(
    process.execPath,
    [cliPath, "--config", configPath, "reviewers", "list"],
    { cwd: workspace, encoding: "utf-8" },
  );
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /reviewer\tAntigravity Reviewer\tantigravity-cli\tavailable/);
  assert.match(human.stdout, /executor\tExecutor Only\tcommand\tunavailable/);

  assert.match(readFileSync(configPath, "utf-8"), /capabilities = \["review", "decide"\]/);
});
