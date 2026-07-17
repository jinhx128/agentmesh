import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { BUILTIN_WORKFLOW_IDS } from "@agentmesh/core";
import {
  getWorkflow,
  loadWorkflowFile,
  listWorkflows,
  workflowSearchDirs,
} from "../packages/runtime/src/workflow/registry.js";

interface Sandbox {
  root: string;
  workspace: string;
  home: string;
}

function makeSandbox(): Sandbox {
  const root = mkdtempSync(path.join(tmpdir(), "agentmesh-workflow-"));
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "home");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { root, workspace, home };
}

function writeWorkflow(
  workflowDir: string,
  workflowId = "docs-delivery",
  stages = ["plan", "review", "decide"],
  reviewSessionMode?: string,
): string {
  mkdirSync(workflowDir, { recursive: true });
  const workflowPath = path.join(workflowDir, `${workflowId}.toml`);
  const stageArtifacts = Array.from(new Set(stages.flatMap((stage) => {
    if (stage === "plan") {
      return ["plan.md"];
    }
    if (stage === "execute") {
      return ["handoff.md"];
    }
    if (stage === "verify") {
      return ["verification.md"];
    }
    if (stage === "review") {
      return ["findings.md"];
    }
    if (stage === "decide") {
      return ["decision.md"];
    }
    return [];
  })));
  writeFileSync(
    workflowPath,
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "Docs Delivery"',
      `stages = [${stages.map((stage) => JSON.stringify(stage)).join(", ")}]`,
      'description = "Plan, review, and decide a documentation artifact."',
      'when_to_use = ["A docs artifact needs focused review."]',
      "packet_artifacts = [",
      '  "request.md",',
      ...stageArtifacts.map((artifact) => `  ${JSON.stringify(artifact)},`),
      "]",
      'quality_gates = ["The decider records accepted and rejected findings."]',
      ...(reviewSessionMode === undefined
        ? []
        : [`review_session_mode = ${JSON.stringify(reviewSessionMode)}`]),
      "",
    ].join("\n"),
  );
  return workflowPath;
}

function writeUserWorkflow(
  home: string,
  workflowId = "docs-delivery",
  stages = ["plan", "review", "decide"],
  reviewSessionMode?: string,
): string {
  return writeWorkflow(
    path.join(home, ".config", "agentmesh", "workflows"),
    workflowId,
    stages,
    reviewSessionMode,
  );
}

function withHome(home: string, action: () => void): void {
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    action();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
}

test("lists built-in workflows with stable registry metadata", () => {
  const workflows = listWorkflows([]);
  const workflowIds = workflows.map((workflow) => workflow.workflowId);

  assert.deepEqual(new Set(workflowIds), new Set(Object.values(BUILTIN_WORKFLOW_IDS)));
  const reviewGate = getWorkflow(BUILTIN_WORKFLOW_IDS.REVIEW_GATE, []);
  assert.equal(reviewGate.source, "builtin");
  assert.equal(reviewGate.schemaVersion, 1);
  assert.equal(reviewGate.workflowRecipeVersion, 1);
  assert.deepEqual(reviewGate.compatiblePacketSchemaVersions, [1]);
  assert.equal(reviewGate.reviewSessionMode, "auto");
  const verifiedDelivery = getWorkflow(BUILTIN_WORKFLOW_IDS.VERIFIED_DELIVERY, []);
  assert.equal(verifiedDelivery.source, "builtin");
  assert.deepEqual(verifiedDelivery.stages, ["plan", "execute", "verify", "review", "decide"]);
  assert.deepEqual(verifiedDelivery.stageNodes, [
    { id: "plan", type: "plan", occurrence: 1 },
    { id: "execute", type: "execute", occurrence: 1 },
    { id: "verify", type: "verify", occurrence: 1 },
    { id: "review", type: "review", occurrence: 1 },
    { id: "decide", type: "decide", occurrence: 1 },
  ]);
  assert.ok(verifiedDelivery.packetArtifacts.includes("verification.md"));
  const releaseCheck = getWorkflow(BUILTIN_WORKFLOW_IDS.RELEASE_CHECK, []);
  assert.equal(releaseCheck.reviewSessionMode, "independent");
});

test("review-gate workflow mirrors the repo-maintained recipe source", () => {
  const recipePath = path.resolve("docs/workflows/review-gate.toml");
  const sourceWorkflow = loadWorkflowFile(recipePath, process.cwd(), {
    workflowId: BUILTIN_WORKFLOW_IDS.REVIEW_GATE,
  });
  const reviewGate = getWorkflow(BUILTIN_WORKFLOW_IDS.REVIEW_GATE, []);

  assert.equal(reviewGate.recipeSource, "docs/workflows/review-gate.toml");
  assert.equal(sourceWorkflow.workflowId, reviewGate.workflowId);
  assert.equal(sourceWorkflow.name, reviewGate.name);
  assert.deepEqual(sourceWorkflow.stages, reviewGate.stages);
  assert.equal(sourceWorkflow.description, reviewGate.description);
  assert.deepEqual(sourceWorkflow.whenToUse, reviewGate.whenToUse);
  assert.deepEqual(sourceWorkflow.packetArtifacts, reviewGate.packetArtifacts);
  assert.deepEqual(sourceWorkflow.qualityGates, reviewGate.qualityGates);
  assert.match(
    readFileSync(recipePath, "utf-8"),
    /Private Review Gate skills do not need to migrate/,
  );
});

test("loads workflow TOML from the user registry", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const workflowPath = writeUserWorkflow(sandbox.home);

  withHome(sandbox.home, () => {
    const workflow = getWorkflow("docs-delivery", workflowSearchDirs(sandbox.workspace));

    assert.equal(workflow.source, "user");
    assert.equal(workflow.path, workflowPath);
    assert.equal(workflow.schemaVersion, 1);
    assert.equal(workflow.workflowRecipeVersion, 1);
    assert.deepEqual(workflow.compatiblePacketSchemaVersions, [1]);
    assert.equal(workflow.reviewSessionMode, "auto");
    assert.deepEqual(workflow.stages, ["plan", "review", "decide"]);
    assert.equal(workflow.name, "Docs Delivery");
    assert.equal(workflow.packetArtifacts.length, 4);
  });
});

test("parses review session mode and rejects unknown values", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeUserWorkflow(sandbox.home, "independent-review", ["review", "decide"], "independent");

  withHome(sandbox.home, () => {
    const workflow = getWorkflow("independent-review", workflowSearchDirs(sandbox.workspace));
    assert.equal(workflow.reviewSessionMode, "independent");
  });

  writeUserWorkflow(sandbox.home, "invalid-review", ["review", "decide"], "continuous");
  withHome(sandbox.home, () => {
    assert.throws(
      () => getWorkflow("invalid-review", workflowSearchDirs(sandbox.workspace)),
      /review_session_mode.*auto|interactive_continuous|independent/,
    );
  });
});

test("loads user workflow registry layers", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const userPath = writeUserWorkflow(sandbox.home, "personal-review");

  withHome(sandbox.home, () => {
    const workflows = listWorkflows(workflowSearchDirs(sandbox.workspace));
    const personal = workflows.find((workflow) => workflow.workflowId === "personal-review");

    assert.equal(personal?.source, "user");
    assert.equal(personal?.path, userPath);
  });
});

test("loads user workflow TOML with inline comments", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const workflowDir = path.join(sandbox.home, ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  const workflowPath = path.join(workflowDir, "commented.toml");
  writeFileSync(
    workflowPath,
    [
      "schema_version = 1 # root schema",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "Docs # Delivery" # inline comment',
      'stages = ["plan", "review", "decide"] # stage list',
      'description = "Plan, review, and decide a documentation artifact."',
      'when_to_use = ["A docs # artifact needs focused review."] # keep hash in string',
      'packet_artifacts = ["request.md", "plan.md", "findings.md", "decision.md"]',
      'quality_gates = ["The decider records accepted and rejected findings."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    const workflow = getWorkflow("commented", workflowSearchDirs(sandbox.workspace));

    assert.equal(workflow.name, "Docs # Delivery");
    assert.deepEqual(workflow.whenToUse, ["A docs # artifact needs focused review."]);
  });
});

test("loads user workflow TOML with bracket characters inside multi-line arrays", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const workflowDir = path.join(sandbox.home, ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  const workflowPath = path.join(workflowDir, "bracketed.toml");
  writeFileSync(
    workflowPath,
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'name = "Bracketed Workflow"',
      "stages = [",
      '  "plan",',
      '  "review",',
      '  "decide",',
      "]",
      'description = "Plan, review, and decide a documentation artifact."',
      "when_to_use = [",
      '  "A docs ] artifact needs focused review.",',
      '  "Another reason.",',
      "]",
      'packet_artifacts = ["request.md", "plan.md", "findings.md", "decision.md"]',
      'quality_gates = ["The decider records accepted and rejected findings."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    const workflow = getWorkflow("bracketed", workflowSearchDirs(sandbox.workspace));

    assert.deepEqual(workflow.stages, ["plan", "review", "decide"]);
    assert.deepEqual(workflow.whenToUse, [
      "A docs ] artifact needs focused review.",
      "Another reason.",
    ]);
  });
});

test("rejects workflow TOML without required version metadata", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const workflowDir = path.join(sandbox.home, ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    path.join(workflowDir, "missing-version.toml"),
    [
      "schema_version = 1",
      'stages = ["review", "decide"]',
      'description = "Missing recipe version metadata."',
      'when_to_use = ["A workflow is missing metadata."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Version metadata is present."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /workflow_recipe_version must be 1/,
    );
  });
});

test("rejects workflow TOML with unsupported recipe or packet compatibility versions", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const workflowDir = path.join(sandbox.home, ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    path.join(workflowDir, "future-recipe.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 2",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Future recipe."',
      'when_to_use = ["A future recipe is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Future recipe is rejected."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /workflow_recipe_version must be 1/,
    );
  });

  rmSync(path.join(workflowDir, "future-recipe.toml"));
  writeFileSync(
    path.join(workflowDir, "future-packet.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [99]",
      'stages = ["review", "decide"]',
      'description = "Incompatible packet compatibility."',
      'when_to_use = ["An incompatible packet compatibility is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Future packet compatibility is rejected."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /compatible_packet_schema_versions must equal \[1\]/,
    );
  });

  rmSync(path.join(workflowDir, "future-packet.toml"));
  writeFileSync(
    path.join(workflowDir, "mixed-packet.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [99]",
      'stages = ["review", "decide"]',
      'description = "Unsupported newer packet compatibility is rejected."',
      'when_to_use = ["Unsupported newer packet compatibility is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Only current packet schema compatibility is accepted."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /compatible_packet_schema_versions must equal \[1\]/,
    );
  });
});

test("derives workflow ids from registry filenames and rejects unknown top-level fields", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const workflowDir = path.join(sandbox.home, ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    path.join(workflowDir, "filename-fallback.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Derived id."',
      'when_to_use = ["A workflow id is derived from the registry filename."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["The TOML does not carry a user-authored id."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    const workflow = getWorkflow("filename-fallback", workflowSearchDirs(sandbox.workspace));
    assert.equal(workflow.workflowId, "filename-fallback");
    assert.equal(workflow.name, "Filename Fallback");
  });

  rmSync(path.join(workflowDir, "filename-fallback.toml"));
  writeFileSync(
    path.join(workflowDir, "unknown-field.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Unknown field."',
      'when_to_use = ["A workflow has an unknown field."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Unknown fields are rejected."]',
      'foo = "bar"',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /unknown top-level field: foo/,
    );
  });

  rmSync(path.join(workflowDir, "unknown-field.toml"));
  writeFileSync(
    path.join(workflowDir, "legacy-status.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'status = "mvp"',
      'stages = ["review", "decide"]',
      'description = "Legacy maturity field."',
      'when_to_use = ["A workflow still contains the removed maturity field."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Removed fields are rejected."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /unknown top-level field: status/,
    );
  });
});

test("rejects empty workflow required arrays and missing canonical artifacts", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const workflowDir = path.join(sandbox.home, ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    path.join(workflowDir, "empty-when.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Empty when_to_use."',
      "when_to_use = []",
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Required arrays are non-empty."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /when_to_use must be a non-empty list of strings/,
    );
  });

  rmSync(path.join(workflowDir, "empty-when.toml"));
  writeFileSync(
    path.join(workflowDir, "missing-artifact.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan", "review", "decide"]',
      'description = "Missing canonical artifact."',
      'when_to_use = ["A canonical artifact is missing."]',
      'packet_artifacts = ["plan.md", "decision.md"]',
      'quality_gates = ["Canonical artifacts are covered."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /packet_artifacts missing canonical artifact findings\.md for review/,
    );
  });
});

test("validates workflow failure policy stage types nodes and bounds", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const workflowDir = path.join(sandbox.home, ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    path.join(workflowDir, "policy-ok.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["plan", "decide", "review", "decide"]',
      'description = "Valid policy."',
      'when_to_use = ["A policy is needed."]',
      'packet_artifacts = ["plan.md", "findings.md", "decision.md"]',
      'quality_gates = ["Policy validates."]',
      "",
      "[failure_policy.stage_types.review]",
      'mode = "required"',
      "max_fallback_agents = 2",
      "",
      "[failure_policy.nodes.decide_2]",
      'mode = "terminal"',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    const workflow = getWorkflow("policy-ok", workflowSearchDirs(sandbox.workspace));
    assert.deepEqual(workflow.stageNodes.map((node) => node.id), [
      "plan",
      "decide",
      "review",
      "decide_2",
    ]);
  });

  rmSync(path.join(workflowDir, "policy-ok.toml"));
  writeFileSync(
    path.join(workflowDir, "policy-bad-mode.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Invalid policy mode."',
      'when_to_use = ["A bad mode is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Bad policy is rejected."]',
      "",
      "[failure_policy.stage_types.review]",
      'mode = "retry"',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /failure_policy\.stage_types\.review.*allow|required|terminal/,
    );
  });

  rmSync(path.join(workflowDir, "policy-bad-mode.toml"));
  writeFileSync(
    path.join(workflowDir, "policy-unknown-key.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Unknown policy key."',
      'when_to_use = ["An unknown policy key is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Unknown policy keys are rejected."]',
      "",
      "[failure_policy.stage_types.review]",
      'mode = "allow"',
      'foo = "bar"',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /unknown failure_policy\.stage_types\.review field: foo/,
    );
  });

  rmSync(path.join(workflowDir, "policy-unknown-key.toml"));
  writeFileSync(
    path.join(workflowDir, "policy-unknown-node.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Unknown policy node."',
      'when_to_use = ["An unknown policy node is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Unknown node is rejected."]',
      "",
      "[failure_policy.nodes.review_2]",
      'mode = "terminal"',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /unknown failure_policy node id 'review_2'; valid node ids: review, decide/,
    );
  });

  rmSync(path.join(workflowDir, "policy-unknown-node.toml"));
  writeFileSync(
    path.join(workflowDir, "policy-terminal-max.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'stages = ["review", "decide"]',
      'description = "Terminal policy with max fallback."',
      'when_to_use = ["A terminal max fallback policy is tested."]',
      'packet_artifacts = ["findings.md", "decision.md"]',
      'quality_gates = ["Terminal max fallback is rejected."]',
      "",
      "[failure_policy.stage_types.review]",
      'mode = "terminal"',
      "max_fallback_agents = 1",
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /terminal failure policy must not set max_fallback_agents/,
    );
  });
});

test("rejects a user workflow that shadows a built-in id", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeUserWorkflow(sandbox.home, BUILTIN_WORKFLOW_IDS.BUG_FIX);

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      new RegExp(`duplicate workflow id '${BUILTIN_WORKFLOW_IDS.BUG_FIX}'`),
    );
  });
});

test("rejects duplicate workflow ids across user registry files", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeUserWorkflow(sandbox.home, "shared-delivery");
  const workflowDir = path.join(sandbox.home, ".config", "agentmesh", "workflows");
  const alternateWorkflowDir = path.join(sandbox.root, "alternate-workflows");
  writeWorkflow(alternateWorkflowDir, "shared-delivery");

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows([
        { source: "user", path: workflowDir },
        { source: "user", path: alternateWorkflowDir },
      ]),
      /duplicate workflow id 'shared-delivery'/,
    );
  });
});

test("rejects unsupported user workflow stages", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeUserWorkflow(sandbox.home, "bad-delivery", ["plan", "deploy"]);

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /unsupported stage type 'deploy'/,
    );
  });
});

test("loads workflows with repeated plan execute and review stage nodes", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeUserWorkflow(sandbox.home, "repeated-delivery", [
    "plan",
    "execute",
    "review",
    "execute",
    "review",
    "decide",
  ]);

  withHome(sandbox.home, () => {
    const workflow = getWorkflow("repeated-delivery", workflowSearchDirs(sandbox.workspace));

    assert.deepEqual(workflow.stages, [
      "plan",
      "execute",
      "review",
      "execute",
      "review",
      "decide",
    ]);
    assert.deepEqual(workflow.stageNodes, [
      { id: "plan", type: "plan", occurrence: 1 },
      { id: "execute", type: "execute", occurrence: 1 },
      { id: "review", type: "review", occurrence: 1 },
      { id: "execute_2", type: "execute", occurrence: 2 },
      { id: "review_2", type: "review", occurrence: 2 },
      { id: "decide", type: "decide", occurrence: 1 },
    ]);
  });
});

test("rejects workflow stage counts outside the supported node range", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  const workflowDir = path.join(sandbox.home, ".config", "agentmesh", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    path.join(workflowDir, "missing-stages.toml"),
    [
      "schema_version = 1",
      "workflow_recipe_version = 1",
      "compatible_packet_schema_versions = [1]",
      'description = "Missing stages."',
      'when_to_use = ["Never."]',
      'packet_artifacts = ["request.md"]',
      'quality_gates = ["None."]',
      "",
    ].join("\n"),
  );

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /stages must be present and be a list of strings/,
    );
  });

  rmSync(path.join(workflowDir, "missing-stages.toml"));
  writeUserWorkflow(sandbox.home, "empty-delivery", []);

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /workflow must contain at least 1 stage node/,
    );
  });

  rmSync(path.join(workflowDir, "empty-delivery.toml"));
  writeUserWorkflow(sandbox.home, "too-long-delivery", [
    "plan",
    "execute",
    "review",
    "execute",
    "review",
    "plan",
    "execute",
    "review",
    "plan",
    "execute",
    "review",
    "plan",
    "execute",
    "review",
    "plan",
    "decide",
  ]);

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /workflow must contain at most 15 stage nodes/,
    );
  });
});

test("loads repeated non-consecutive decide workflow nodes", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeUserWorkflow(sandbox.home, "checkpoint-delivery", [
    "plan",
    "decide",
    "execute",
    "review",
    "decide",
  ]);

  withHome(sandbox.home, () => {
    const workflow = getWorkflow("checkpoint-delivery", workflowSearchDirs(sandbox.workspace));

    assert.deepEqual(workflow.stageNodes, [
      { id: "plan", type: "plan", occurrence: 1 },
      { id: "decide", type: "decide", occurrence: 1 },
      { id: "execute", type: "execute", occurrence: 1 },
      { id: "review", type: "review", occurrence: 1 },
      { id: "decide_2", type: "decide", occurrence: 2 },
    ]);
  });
});

test("rejects first or consecutive decide workflow nodes", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeUserWorkflow(sandbox.home, "first-decide", ["decide", "plan"]);

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /decide must not be the first stage node/,
    );
  });

  rmSync(path.join(sandbox.home, ".config", "agentmesh", "workflows", "first-decide.toml"));
  writeUserWorkflow(sandbox.home, "consecutive-decide", ["plan", "decide", "decide"]);

  withHome(sandbox.home, () => {
    assert.throws(
      () => listWorkflows(workflowSearchDirs(sandbox.workspace)),
      /decide must not immediately follow decide/,
    );
  });
});

test("workflows list and show CLI support JSON output", () => {
  const sandbox = makeSandbox();
  test.after(() => rmSync(sandbox.root, { recursive: true, force: true }));
  writeUserWorkflow(sandbox.home);

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.js", import.meta.url));
  const listResult = spawnSync(
    process.execPath,
    [cliPath, "workflows", "list", "--json"],
    { cwd: sandbox.workspace, env: { ...process.env, HOME: sandbox.home }, encoding: "utf-8" },
  );

  assert.equal(listResult.status, 0, listResult.stderr);
  const listPayload = JSON.parse(listResult.stdout);
  assert.ok(
    listPayload.some(
      (workflow: { workflowId: string; source: string }) =>
        workflow.workflowId === "docs-delivery" && workflow.source === "user",
    ),
  );

  const humanList = spawnSync(
    process.execPath,
    [cliPath, "workflows", "list"],
    { cwd: sandbox.workspace, env: { ...process.env, HOME: sandbox.home }, encoding: "utf-8" },
  );
  assert.equal(humanList.status, 0, humanList.stderr);
  assert.match(humanList.stdout, /docs-delivery\tuser/);

  const showResult = spawnSync(
    process.execPath,
    [cliPath, "workflows", "show", "docs-delivery", "--json"],
    { cwd: sandbox.workspace, env: { ...process.env, HOME: sandbox.home }, encoding: "utf-8" },
  );

  assert.equal(showResult.status, 0, showResult.stderr);
  const showPayload = JSON.parse(showResult.stdout);
  assert.equal(showPayload.workflowId, "docs-delivery");
  assert.equal(showPayload.source, "user");
  assert.equal(
    realpathSync(showPayload.path),
    realpathSync(path.join(sandbox.home, ".config", "agentmesh", "workflows", "docs-delivery.toml")),
  );

  const humanShow = spawnSync(
    process.execPath,
    [cliPath, "workflows", "show", "docs-delivery"],
    { cwd: sandbox.workspace, env: { ...process.env, HOME: sandbox.home }, encoding: "utf-8" },
  );
  assert.equal(humanShow.status, 0, humanShow.stderr);
  assert.match(humanShow.stdout, /Source: user/);

  const reviewGateShow = spawnSync(
    process.execPath,
    [cliPath, "workflows", "show", BUILTIN_WORKFLOW_IDS.REVIEW_GATE, "--json"],
    { cwd: sandbox.workspace, env: { ...process.env, HOME: sandbox.home }, encoding: "utf-8" },
  );
  assert.equal(reviewGateShow.status, 0, reviewGateShow.stderr);
  const reviewGatePayload = JSON.parse(reviewGateShow.stdout);
  assert.equal(reviewGatePayload.recipeSource, "docs/workflows/review-gate.toml");

  const humanReviewGate = spawnSync(
    process.execPath,
    [cliPath, "workflows", "show", BUILTIN_WORKFLOW_IDS.REVIEW_GATE],
    { cwd: sandbox.workspace, env: { ...process.env, HOME: sandbox.home }, encoding: "utf-8" },
  );
  assert.equal(humanReviewGate.status, 0, humanReviewGate.stderr);
  assert.match(
    humanReviewGate.stdout,
    /Recipe source:\ndocs\/workflows\/review-gate\.toml/,
  );
});
