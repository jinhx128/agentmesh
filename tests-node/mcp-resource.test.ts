import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMcpResourceSpec,
  parseMcpResourceSpecs,
} from "../packages/runtime/src/mcp/resource.js";

test("parseMcpResourceSpec accepts server id and URI separated by the first colon", () => {
  assert.deepEqual(parseMcpResourceSpec("docs:file:///repo/README.md"), {
    raw: "docs:file:///repo/README.md",
    serverId: "docs",
    resourceUri: "file:///repo/README.md",
  });
  assert.deepEqual(parseMcpResourceSpec("notes:project/brief.md"), {
    raw: "notes:project/brief.md",
    serverId: "notes",
    resourceUri: "project/brief.md",
  });
  assert.deepEqual(parseMcpResourceSpecs(["docs:file:///a.md", "notes:brief"]), [
    {
      raw: "docs:file:///a.md",
      serverId: "docs",
      resourceUri: "file:///a.md",
    },
    {
      raw: "notes:brief",
      serverId: "notes",
      resourceUri: "brief",
    },
  ]);
});

test("parseMcpResourceSpec rejects malformed resource specs", () => {
  for (const value of [
    "",
    "docs",
    ":file:///repo/README.md",
    "docs:",
    "bad id:file:///repo/README.md",
    " docs:file:///repo/README.md",
    "docs :file:///repo/README.md",
  ]) {
    assert.throws(
      () => parseMcpResourceSpec(value),
      /--mcp-resource must be <server-id>:<resource-uri>/,
      value,
    );
  }
});
