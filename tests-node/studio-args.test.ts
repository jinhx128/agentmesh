import assert from "node:assert/strict";
import test from "node:test";

import { parseStudioArgs } from "../packages/app-server/src/args.js";

test("parseStudioArgs uses local defaults", () => {
  assert.deepEqual(parseStudioArgs([]), {
    host: "127.0.0.1",
    port: 4777,
  });
});

test("parseStudioArgs accepts explicit host and port", () => {
  assert.deepEqual(parseStudioArgs(["--host", "0.0.0.0", "--port", "6123"]), {
    host: "0.0.0.0",
    port: 6123,
  });
});

test("parseStudioArgs accepts port 0 for ephemeral binding", () => {
  assert.deepEqual(parseStudioArgs(["--port", "0"]), {
    host: "127.0.0.1",
    port: 0,
  });
});

test("parseStudioArgs rejects invalid ports", () => {
  assert.throws(() => parseStudioArgs(["--port", "abc"]), /invalid --port/);
  assert.throws(() => parseStudioArgs(["--port", "65536"]), /invalid --port/);
  assert.throws(() => parseStudioArgs(["--port", "-1"]), /invalid --port/);
});
