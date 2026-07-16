import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDisplayTitle,
  resolveDisplayTitle,
} from "../packages/runtime/src/display-title.js";

test("display titles normalize explicit agent summaries without adding workspace names", () => {
  assert.equal(normalizeDisplayTitle("  优化   活动\n列表  "), "优化 活动 列表");
  assert.equal(normalizeDisplayTitle(" \n\t "), undefined);
  assert.equal(resolveDisplayTitle({
    title: "  优化   Studio 活动导航 ",
    workspace: "/tmp/agentmesh",
    summaries: ["ignored"],
    createdAt: new Date(2026, 6, 16, 17, 26, 8),
  }), "优化 Studio 活动导航");

  const longTitle = normalizeDisplayTitle("你".repeat(100));
  assert.equal(Array.from(longTitle ?? "").length, 80);
  assert.match(longTitle ?? "", /…$/);
});

test("display titles build deterministic workspace and summary fallbacks", () => {
  const createdAt = new Date(2026, 6, 16, 17, 26, 8);
  assert.equal(resolveDisplayTitle({
    workspace: "/tmp/agentmesh",
    summaries: ["# 优化活动列表\n\nMore detail"],
    createdAt,
  }), "agentmesh-优化活动列表");
  assert.equal(resolveDisplayTitle({
    workspace: "/tmp/agentmesh",
    summaries: ["general", "- 审查模型配置"],
    createdAt,
  }), "agentmesh-审查模型配置");
  assert.equal(resolveDisplayTitle({
    workspace: "/tmp/agentmesh",
    summaries: ["# Request\r\n\r\n- 审查标题持久化"],
    createdAt,
  }), "agentmesh-审查标题持久化");
  assert.equal(resolveDisplayTitle({
    workspace: "/tmp/agentmesh",
    summaries: ["general\n\n真实调用目的"],
    createdAt,
  }), "agentmesh-真实调用目的");

  const combined = resolveDisplayTitle({
    workspace: `/tmp/${"w".repeat(60)}`,
    summaries: ["你".repeat(60)],
    createdAt,
  });
  assert.equal(Array.from(combined).length, 80);
  assert.match(combined, /…$/);
});

test("display titles use a local time fallback and only the ASCII dash separator", () => {
  const title = resolveDisplayTitle({
    workspace: "/tmp/agentmesh",
    summaries: [undefined, "  "],
    createdAt: new Date(2026, 6, 16, 17, 26, 8),
  });
  assert.equal(title, "agentmesh-17:26:08");
  assert.doesNotMatch(title, /[·｜—－]/);
  assert.equal(resolveDisplayTitle({
    workspace: "/",
    summaries: [],
    createdAt: new Date(2026, 6, 16, 17, 26, 8),
  }), "workspace-17:26:08");
});
