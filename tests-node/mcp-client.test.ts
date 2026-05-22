import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  type McpFailureClassification,
  listMcpResourceHints,
  mcpFailureClassification,
  mcpIngestionError,
  McpClientError,
  closeMcpClientCache,
  createMcpClientCache,
  readMcpTextResource,
  readMcpTextResources,
} from "../packages/runtime/src/mcp/client.js";

const fakeServerPath = fileURLToPath(
  new URL("./fixtures/mcp/fake-server.js", import.meta.url),
);
const rawBadServerPath = fileURLToPath(
  new URL("./fixtures/mcp/raw-bad-server.js", import.meta.url),
);
const MCP_TEST_TIMEOUT_MS = 5_000;

test("readMcpTextResource runs initialize, initialized, resource read, and process close", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-mcp-client-"));
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const logPath = path.join(workspace, "fake-server-events.jsonl");

  const resource = await readMcpTextResource(
    {
      command: process.execPath,
      args: [fakeServerPath],
      env: {
        AGENTMESH_FAKE_MCP_LOG: logPath,
      },
    },
    "memory://hello",
    {
      initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
      readTimeoutMs: MCP_TEST_TIMEOUT_MS,
    },
  );

  assert.deepEqual(resource, {
    uri: "memory://hello",
    mimeType: "text/plain",
    text: "Hello from fake MCP: memory://hello",
  });
  const events = readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event: { event: string }) => event.event),
    ["initialize", "initialized", "resources/read", "close"],
  );
});

test("readMcpTextResources reuses one process for multiple resources on the same server", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-mcp-client-"));
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const logPath = path.join(workspace, "fake-server-events.jsonl");

  const resources = await readMcpTextResources(
    {
      command: process.execPath,
      args: [fakeServerPath],
      env: {
        AGENTMESH_FAKE_MCP_LOG: logPath,
      },
    },
    ["memory://one", "memory://two"],
    {
      initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
      readTimeoutMs: MCP_TEST_TIMEOUT_MS,
    },
  );

  assert.deepEqual(
    resources.map((resource) => resource.text),
    ["Hello from fake MCP: memory://one", "Hello from fake MCP: memory://two"],
  );
  const events = readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event: { event: string }) => event.event),
    ["initialize", "initialized", "resources/read", "resources/read", "close"],
  );
});

test("readMcpTextResource ignores normal stderr output from stdio servers", async () => {
  const resource = await readMcpTextResource(
    {
      command: process.execPath,
      args: [fakeServerPath],
      env: { AGENTMESH_FAKE_MCP_STDERR: "diagnostic line" },
    },
    "memory://stderr-ok",
    {
      initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
      readTimeoutMs: MCP_TEST_TIMEOUT_MS,
    },
  );

  assert.equal(resource.text, "Hello from fake MCP: memory://stderr-ok");
});

test("readMcpTextResources reports MCP connect timing", async () => {
  const timings: Array<{ mcp_connect_ms: number; cache_hit: boolean }> = [];
  const resources = await readMcpTextResources(
    {
      command: process.execPath,
      args: [fakeServerPath],
    },
    ["memory://timed"],
    {
      initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
      readTimeoutMs: MCP_TEST_TIMEOUT_MS,
      onTiming: (timing) => timings.push(timing),
    },
  );

  assert.equal(resources[0].text, "Hello from fake MCP: memory://timed");
  assert.equal(timings.length, 1);
  assert.equal(typeof timings[0].mcp_connect_ms, "number");
  assert.ok(timings[0].mcp_connect_ms >= 0);
  assert.equal(timings[0].cache_hit, false);
});

test("MCP connection cache reuses one active session across list and read", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-mcp-client-"));
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const logPath = path.join(workspace, "fake-server-events.jsonl");
  const cache = createMcpClientCache();
  const timings: Array<{ mcp_connect_ms: number; cache_hit: boolean }> = [];
  const config = {
    command: process.execPath,
    args: [fakeServerPath],
    env: {
      AGENTMESH_FAKE_MCP_LOG: logPath,
    },
  };

  try {
    const hints = await listMcpResourceHints(config, {
      cache,
      initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
      listTimeoutMs: MCP_TEST_TIMEOUT_MS,
      onTiming: (timing) => timings.push(timing),
    });
    const resource = await readMcpTextResource(config, "memory://cached", {
      cache,
      initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
      readTimeoutMs: MCP_TEST_TIMEOUT_MS,
      onTiming: (timing) => timings.push(timing),
    });

    assert.deepEqual(
      hints.map((hint) => hint.uri),
      ["memory://listed-1", "memory://listed-2"],
    );
    assert.equal(resource.text, "Hello from fake MCP: memory://cached");
  } finally {
    await closeMcpClientCache(cache);
  }

  const events = readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    events.map((event: { event: string }) => event.event),
    ["initialize", "initialized", "resources/list", "resources/read", "close"],
  );
  assert.deepEqual(
    timings.map((timing) => timing.cache_hit),
    [false, true],
  );
  assert.ok(timings[0].mcp_connect_ms >= 0);
  assert.equal(timings[1].mcp_connect_ms, 0);
});

test("MCP connection cache evicts sessions after request failures", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-mcp-client-"));
  test.after(() => rmSync(workspace, { recursive: true, force: true }));
  const logPath = path.join(workspace, "fake-server-events.jsonl");
  const cache = createMcpClientCache();
  const config = {
    command: process.execPath,
    args: [fakeServerPath],
    env: {
      AGENTMESH_FAKE_MCP_LOG: logPath,
      AGENTMESH_FAKE_MCP_READ_EXIT: "1",
    },
  };

  try {
    await assertMcpFailure(
      () =>
        readMcpTextResource(config, "memory://crash-one", {
          cache,
          initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
          readTimeoutMs: MCP_TEST_TIMEOUT_MS,
        }),
      "unknown",
      /MCP request failed: .*Connection closed/,
    );
    await assertMcpFailure(
      () =>
        readMcpTextResource(config, "memory://crash-two", {
          cache,
          initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
          readTimeoutMs: MCP_TEST_TIMEOUT_MS,
        }),
      "unknown",
      /MCP request failed: .*Connection closed/,
    );
  } finally {
    await closeMcpClientCache(cache);
  }

  const events = readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.filter((event: { event: string }) => event.event === "initialize").length, 2);
  assert.equal(events.filter((event: { event: string }) => event.event === "resources/read").length, 2);
});

test("readMcpTextResource times out initialize and read requests", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "agentmesh-mcp-client-"));
  test.after(() => rmSync(workspace, { recursive: true, force: true }));

  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: process.execPath,
          args: [fakeServerPath],
          env: { AGENTMESH_FAKE_MCP_INITIALIZE_DELAY_MS: "50" },
        },
        "memory://slow-init",
        { initializeTimeoutMs: 5, readTimeoutMs: MCP_TEST_TIMEOUT_MS },
      ),
    "timeout",
    /MCP request timed out: initialize/,
  );

  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: process.execPath,
          args: [fakeServerPath],
          env: { AGENTMESH_FAKE_MCP_READ_DELAY_MS: "50" },
        },
        "memory://slow-read",
        { initializeTimeoutMs: MCP_TEST_TIMEOUT_MS, readTimeoutMs: 5 },
      ),
    "timeout",
    /MCP request timed out: resources\/read/,
  );
});

test("readMcpTextResource classifies server exit during read as unknown", async () => {
  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: process.execPath,
          args: [fakeServerPath],
          env: { AGENTMESH_FAKE_MCP_READ_EXIT: "1" },
        },
        "memory://read-crash",
        { initializeTimeoutMs: MCP_TEST_TIMEOUT_MS, readTimeoutMs: MCP_TEST_TIMEOUT_MS },
      ),
    "unknown",
    /MCP request failed: .*Connection closed/,
  );
});

test("readMcpTextResource rejects text resources over the byte limit", async () => {
  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: process.execPath,
          args: [fakeServerPath],
          env: { AGENTMESH_FAKE_MCP_TEXT_SIZE: `${256 * 1024 + 1}` },
        },
        "memory://large",
        {
          initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
          readTimeoutMs: MCP_TEST_TIMEOUT_MS,
          maxTextResourceBytes: 256 * 1024,
        },
      ),
    "resource_too_large",
    /MCP text resource exceeds 262144 bytes/,
  );
});

test("listMcpResourceHints applies limits and protocol-error classification", async () => {
  const hints = await listMcpResourceHints(
    {
      command: process.execPath,
      args: [fakeServerPath],
      env: { AGENTMESH_FAKE_MCP_LIST_COUNT: "3" },
    },
    {
      initializeTimeoutMs: MCP_TEST_TIMEOUT_MS,
      listTimeoutMs: MCP_TEST_TIMEOUT_MS,
      resourceHintLimit: 2,
    },
  );

  assert.deepEqual(
    hints.map((hint) => hint.uri),
    ["memory://listed-1", "memory://listed-2"],
  );

  await assertMcpFailure(
    () =>
      listMcpResourceHints(
        {
          command: process.execPath,
          args: [rawBadServerPath],
        },
        { initializeTimeoutMs: MCP_TEST_TIMEOUT_MS, listTimeoutMs: MCP_TEST_TIMEOUT_MS },
      ),
    "invalid_json_rpc",
    /Invalid MCP JSON-RPC message/,
  );
});

test("readMcpTextResource classifies server startup failures", async () => {
  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: path.join(tmpdir(), "agentmesh-missing-mcp-server"),
        },
        "memory://missing-server",
        { initializeTimeoutMs: MCP_TEST_TIMEOUT_MS, readTimeoutMs: MCP_TEST_TIMEOUT_MS },
      ),
    "server_start_failed",
    /Failed to start MCP server/,
  );
});

test("readMcpTextResource classifies initialize failures", async () => {
  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: process.execPath,
          args: [fakeServerPath],
          env: { AGENTMESH_FAKE_MCP_INITIALIZE_ERROR: "1" },
        },
        "memory://init-fails",
        { initializeTimeoutMs: MCP_TEST_TIMEOUT_MS, readTimeoutMs: MCP_TEST_TIMEOUT_MS },
      ),
    "initialize_failed",
    /MCP initialize failed/,
  );
});

test("readMcpTextResource classifies missing resources", async () => {
  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: process.execPath,
          args: [fakeServerPath],
          env: { AGENTMESH_FAKE_MCP_RESOURCE_NOT_FOUND: "1" },
        },
        "memory://missing",
        { initializeTimeoutMs: MCP_TEST_TIMEOUT_MS, readTimeoutMs: MCP_TEST_TIMEOUT_MS },
      ),
    "resource_not_found",
    /MCP resource not found/,
  );
});

test("readMcpTextResource does not treat method-not-found as resource-not-found", async () => {
  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: process.execPath,
          args: [fakeServerPath],
          env: { AGENTMESH_FAKE_MCP_METHOD_NOT_FOUND: "1" },
        },
        "memory://method-missing",
        { initializeTimeoutMs: MCP_TEST_TIMEOUT_MS, readTimeoutMs: MCP_TEST_TIMEOUT_MS },
      ),
    "unknown",
    /MCP request failed: .*Method not found/,
  );
});

test("readMcpTextResource classifies non-text resources", async () => {
  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: process.execPath,
          args: [fakeServerPath],
          env: { AGENTMESH_FAKE_MCP_NON_TEXT_RESOURCE: "1" },
        },
        "memory://binary",
        { initializeTimeoutMs: MCP_TEST_TIMEOUT_MS, readTimeoutMs: MCP_TEST_TIMEOUT_MS },
      ),
    "non_text_resource",
    /MCP resources\/read result did not include a text content item/,
  );
});

test("readMcpTextResource classifies invalid JSON-RPC frames", async () => {
  await assertMcpFailure(
    () =>
      readMcpTextResource(
        {
          command: process.execPath,
          args: [rawBadServerPath],
          env: { AGENTMESH_FAKE_MCP_GARBAGE_STDOUT: "1" },
        },
        "memory://invalid-json",
        { initializeTimeoutMs: MCP_TEST_TIMEOUT_MS, readTimeoutMs: MCP_TEST_TIMEOUT_MS },
      ),
    "invalid_json_rpc",
    /Invalid MCP JSON-RPC message/,
  );
});

test("mcpFailureClassification maps unclassified errors to unknown", () => {
  assert.equal(mcpFailureClassification(new Error("plain failure")), "unknown");
  assert.equal(mcpIngestionError(new Error("plain failure")), "unknown: plain failure");
});

async function assertMcpFailure(
  action: () => Promise<unknown>,
  expectedClassification: McpFailureClassification,
  expectedMessage: RegExp,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => {
      assert(error instanceof McpClientError);
      assert.equal(error.classification, expectedClassification);
      assert.match(error.message, expectedMessage);
      assert.equal(mcpFailureClassification(error), expectedClassification);
      assert.match(mcpIngestionError(error), new RegExp(`^${expectedClassification}: `));
      return true;
    },
  );
}
