import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("Studio registers Mantine notifications and classifies mutation outcomes", async () => {
  const helperSourcePath = path.resolve("apps/studio-web/src/app/mutation-feedback.ts");
  assert.equal(existsSync(helperSourcePath), true, "mutation feedback helper must exist");

  const mainSource = readFileSync(path.resolve("apps/studio-web/src/main.tsx"), "utf-8");
  const packageJson = JSON.parse(readFileSync(path.resolve("apps/studio-web/package.json"), "utf-8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(packageJson.dependencies?.["@mantine/notifications"], "9.2.1");
  assert.match(mainSource, /@mantine\/notifications\/styles\.layer\.css/);
  assert.match(mainSource, /<Notifications[^>]*position="top-right"/);

  const modulePath = "../apps/studio-web/src/app/mutation-feedback.js";
  const feedback = await import(modulePath) as {
    studioMutationSucceeded: (response: unknown) => boolean;
    studioMutationError: (response: unknown, fallback: string) => string;
    requireStudioMutationSuccess: (response: unknown, fallback: string) => void;
  };

  assert.equal(feedback.studioMutationSucceeded({
    ok: true,
    payload: { status: "succeeded", exit_code: 0 },
  }), true);
  assert.equal(feedback.studioMutationSucceeded({
    ok: true,
    payload: { status: "failed", exit_code: 0 },
  }), false);
  assert.equal(feedback.studioMutationSucceeded({
    ok: true,
    payload: { status: "conflict", exit_code: 0 },
  }), false);
  assert.equal(feedback.studioMutationSucceeded({
    ok: true,
    payload: { status: "running", exit_code: 0 },
  }), false);
  assert.equal(feedback.studioMutationSucceeded({
    ok: true,
    payload: { status: "succeeded", exit_code: 2 },
  }), false);
  assert.equal(feedback.studioMutationSucceeded({
    ok: false,
    payload: { error: "请求被拒绝" },
  }), false);
  assert.equal(feedback.studioMutationSucceeded({ ok: true, payload: {} }), true);

  assert.equal(feedback.studioMutationError({
    ok: false,
    payload: { error: "明确错误", stderr: "stderr 错误", stdout: "stdout 错误" },
  }, "默认错误"), "明确错误");
  assert.equal(feedback.studioMutationError({
    ok: true,
    payload: { stderr: "stderr 错误", stdout: "stdout 错误" },
  }, "默认错误"), "stderr 错误");
  assert.equal(feedback.studioMutationError({
    ok: true,
    payload: { stdout: "stdout 错误" },
  }, "默认错误"), "stdout 错误");
  assert.equal(feedback.studioMutationError({ ok: false, payload: {} }, "默认错误"), "默认错误");
  assert.throws(
    () => feedback.requireStudioMutationSuccess({ ok: true, payload: { status: "failed" } }, "保存失败"),
    /保存失败/,
  );
});
