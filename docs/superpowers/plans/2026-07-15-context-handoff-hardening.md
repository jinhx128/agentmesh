# Context Handoff Hardening Implementation Plan

> 状态（2026-07-16）：历史已完成。代码、测试与文档已由 `d5dbbe4` 交付；下方未勾选项属于陈旧状态，不重新执行。当前唯一事实源为 `2026-07-16-studio-activity-and-v012-release.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with TDD checkpoints.

**Goal:** Make AgentMesh context capture safe and faithful when handing evidence to a downstream agent.

**Architecture:** Build one policy-aware source manifest for file-backed inputs, reject denied paths after realpath/pathspec expansion, preserve partial MCP results, and include untracked files in scoped evidence. Keep prompt artifacts bounded but make missing/truncated evidence explicit, and thread the dispatch working directory through synthesis prompt assembly.

**Tech Stack:** TypeScript, Node.js `node:test`, Git CLI, MCP SDK.

## Global Constraints

- Preserve packet schema compatibility and existing artifact names.
- Do not add runtime dependencies.
- Keep reviewers and dispatch read-only with respect to source files.
- Every behavior change gets a regression test before implementation.

### Task 1: Secure and complete context capture

**Files:**
- Modify: `packages/runtime/src/flow/context-policy.ts`
- Modify: `packages/runtime/src/flow/context-pack.ts`
- Modify: `packages/runtime/src/mcp/client.ts` only if needed for per-resource errors
- Test: `tests-node/flow-context.test.ts`, `tests-node/mcp-client.test.ts`

- [ ] Add failing tests for symlink/denied-path bypass, denied descendants inside a broad scope, untracked scoped files, and partial MCP failure.
- [ ] Run targeted tests and confirm each fails for the intended reason.
- [ ] Implement the smallest source-manifest/policy checks, untracked diff capture, per-resource MCP error preservation, and a safe diff buffer limit.
- [ ] Run targeted tests and confirm they pass.

### Task 2: Make handoff prompts explicit and path-correct

**Files:**
- Modify: `packages/runtime/src/flow/prompt.ts`
- Modify: `packages/runtime/src/flow/dispatch.ts`
- Test: `tests-node/flow-prompt.test.ts`, `tests-node/flow-dispatch.test.ts`

- [ ] Add failing tests for missing prior artifacts, execute handoff requirements, truncated context visibility, and synthesis cwd.
- [ ] Run targeted tests and confirm failure.
- [ ] Add explicit handoff contract and missing/truncation markers; pass dispatch `cwd` through synthesis prompt assembly.
- [ ] Run targeted tests and confirm pass.

### Task 3: Verify and review

- [ ] Run `npm run build:node`.
- [ ] Run targeted flow/context/MCP tests.
- [ ] Run `npm test`.
- [ ] Run `git diff --check` and inspect the final diff for unrelated changes.
