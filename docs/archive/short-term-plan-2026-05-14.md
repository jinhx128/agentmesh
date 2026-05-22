# AgentMesh 短期计划归档

归档日期：2026-05-14

本文件从根目录 `plan.md` 抽出，记录 TS-on-Node 短期重构和本地 release gate 完成情况。根目录 `plan.md` 继续作为当前长期计划的唯一事实源。

注：涉及旧 Python MVP 的证据只表示历史阶段曾完成过对应能力；Python runtime 已经 decommission。当前 TS-on-Node 路线里的 MCP client 会在长期 L3 重新落地和加固。

## 已完成基线

以下内容视为前一轮短期 MVP 已完成。保留在这里，是为了记录 TS 目标栈启动前已经完成过什么。

- [x] ~~Flow resume / retry MVP：从 `failed_stage` 或指定 stage 恢复，记录 retry events，并保护已完成 artifacts。~~ 证据：已在 Python MVP 中实现，并经过此前 dogfood。
- [x] ~~Handoff MVP：另一个入口 agent 或 worker 可以只靠 packet artifacts 继续，不依赖私有聊天上下文。~~ 证据：已在 flow packet artifacts 中实现。
- [x] ~~Release-check MVP：聚合 diff、verification、review findings、skipped checks、residual risk 和 verdict。~~ 证据：Python MVP 可用，TS read-side summary 可读。
- [x] ~~Doctor / skill verify readiness MVP：检查 CLI 存在性、help/version、auth probe、non-interactive readiness 和 Skill install status。~~ 证据：已有 TS `doctor` 和 `skill verify` slices。
- [x] ~~Local workflow TOML 和轻量 events/status commands。~~ 证据：Python MVP 加 TS read-side commands。
- [x] ~~统一 host 命名为 `OpenCode`。~~ 证据：此前已完成命名清理。
- [x] ~~第一批 TS-on-Node slices：packet validate、workflow list/show、packet status/events/artifacts、release-check summary、doctor、skill verify。~~ 证据：已迁入 `packages/runtime` 和 `packages/cli`，并由 `tests-node/` 覆盖。
- [x] ~~MCP client context ingestion MVP：配置好的 stdio MCP resources 可以读入 `context.md`。~~ 证据：commit `85c15c4`、`src/agentmesh/mcp.py`、README MCP docs，以及 `tests/test_flow_packet.py` 中的 MCP tests。

## 短期计划

### S1. 合并计划事实源

- [x] ~~把 `big-plan.md` 和旧 `plan.md` 合并进这份 canonical `plan.md`。~~ 证据：本文件。
- [x] ~~合并有用内容后，从根目录 planning set 中移除 `big-plan.md`。~~ 证据：根目录 planning set 中已移除该文件。
- [x] ~~把合并后的计划发给 Claude Opus 4.7 做 plan review。~~ 证据：`.review-state/plan-review/20260514T015137-merged-plan-opus47/claude-opus47.out`。
- [x] ~~核对 4.7 findings，只接受有事实支持的 findings，并 patch 本文件。~~ 证据：4.7 findings 已应用到本节以及后续短期与长期计划。
- [x] ~~把最终 plan-review 输出记录到 `.review-state/plan-review/`。~~ 证据：`.review-state/plan-review/20260514T015137-merged-plan-opus47/`。

### S2. P0 Protocol Kernel

目标：让 packet/event/status/workflow/artifact/release contracts 稳定到 CLI、未来 Studio 和未来 adapters 都能观察同一个世界。

- [x] ~~在移动 schemas 之前，先创建最小 `packages/core` skeleton。~~ 证据：`packages/core/package.json`、`packages/core/src/index.ts`，`npm test` 通过 40 个 Node tests。
- [x] ~~创建 `docs/contracts/packet-layout.md`；必须枚举 packet directory shape 和每个标准文件：`request.md`、`context.md`、`plan.md`、`handoff.md`、`findings.md`、`decision.md`、`events.jsonl`、`status.json`、`artifacts.toml` 和 `release-summary.md`。~~ 证据：`docs/contracts/packet-layout.md` 和 `tests-node/core-contracts.test.ts`。
- [x] ~~创建 `docs/contracts/status-json.md`。~~ 证据：`docs/contracts/status-json.md`。
- [x] ~~创建 `docs/contracts/events-jsonl.md`。~~ 证据：`docs/contracts/events-jsonl.md`。
- [x] ~~创建 `docs/contracts/artifacts-toml.md`。~~ 证据：`docs/contracts/artifacts-toml.md`。
- [x] ~~创建 `docs/contracts/workflow-toml.md`。~~ 证据：`docs/contracts/workflow-toml.md`。
- [x] ~~创建 `docs/contracts/release-verdict.md`。~~ 证据：`docs/contracts/release-verdict.md`。
- [x] ~~给 packet、status、event、artifact、workflow 和 release verdict models 加明确的 schema version fields。~~ 证据：`packages/core/src/index.ts` schemas 和 `npm test`。
- [x] ~~定义 schema versioning policy：
  - 使用单调递增整数 `schema_version`
  - readers 接受当前版本和文档化的兼容旧版本
  - readers 对更新且未知的版本清晰失败
  - migrations 必须显式且有测试~~ 证据：`assertSupportedSchemaVersion` 和 `docs/contracts/packet-layout.md`。
- [x] ~~定义 event replay 和 retention semantics。~~ 证据：`docs/contracts/events-jsonl.md`。
- [x] ~~定义 stage state machine transitions：
  - planned
  - running
  - completed
  - failed
  - skipped
  - needs_decision
  - handoff_ready~~ 证据：`packages/core/src/index.ts` 中的 `STAGE_STATES` 和 `docs/contracts/status-json.md`。
- [x] ~~定义 completed stages 的 artifact protection rules。~~ 证据：`docs/contracts/artifacts-toml.md` 和 `docs/contracts/packet-layout.md`。
- [x] ~~定义 release verdict consistency rules。~~ 证据：`docs/contracts/release-verdict.md`。
- [x] ~~把 `events.jsonl`、`status.json` 和 packet layout 标记为 Studio 与其他工具的 external observation contract。~~ 证据：`docs/contracts/packet-layout.md`。
- [x] ~~在 `packages/core` 定义 adapter invocation interface types：invocation input、invocation output、capability metadata 和 failure classification。内置实现与 runtime registry 延后到 L3。~~ 证据：`AdapterInvocationInputSchema`、`AdapterInvocationOutputSchema` 和 `AdapterFailureClassificationSchema`。
- [x] ~~把 Zod schemas 添加或移动到 `packages/core`。~~ 证据：`packages/core/src/index.ts`。
- [x] ~~用 fixture packets 增加 validation tests。~~ 证据：`tests-node/core-contracts.test.ts`、`tests-node/fixtures/packets/valid-basic` 和 `npm test`。

### S3. Package Split 和 CLI Rename

目标：把当前 `src-node/` 实现变成真正的 TS-on-Node 架构。

- [x] ~~把 `packages/core` skeleton 扩成 strict、可发布的内部 package。~~ 证据：`packages/core/package.json`、`packages/core/tsconfig.json`，并继承 strict TypeScript build。
- [x] ~~创建 `packages/runtime`。~~ 证据：`packages/runtime/package.json` 和 `packages/runtime/src/index.ts`。
- [x] ~~创建 `packages/cli`。~~ 证据：`packages/cli/package.json` 和 `packages/cli/src/cli.ts`。
- [x] ~~为 `packages/*` 配置 npm workspaces。~~ 证据：root `package.json` workspaces 和 `package-lock.json`。
- [x] ~~把 pure models 和 schemas 从 `src-node/` 移到 `packages/core`。~~ 证据：`packages/core/src/index.ts`；`src-node/` 已移除。
- [x] ~~把 packet IO、workflow registry、release-check、doctor 和 skill verify 从 `src-node/` 移到 `packages/runtime`。~~ 证据：`packages/runtime/src/*` 和 Node tests。
- [x] ~~把 command parsing 从 `src-node/cli.ts` 移到 `packages/cli`。~~ 证据：`packages/cli/src/cli.ts`。
- [x] ~~把 bin 从 `agentmesh-ts` 改名为 `agentmesh`。~~ 证据：root `package.json` bin 和 `tests-node/package-structure.test.ts`。
- [x] ~~不再把 Python CLI 当成稳定入口；TS CLI 成为唯一目标命令面。~~ 证据：README 现在描述 TS/Node 是目标实现，Python 是 S4 legacy deletion。
- [x] ~~不引入 `agentmesh-py` 或任何其他长期 Python overlap command。~~ 证据：没有 `agentmesh-py` package/bin/script。
- [x] ~~用测试或 lint guard 保持 `core` IO-free。~~ 证据：`tests-node/package-structure.test.ts`。
- [x] ~~让 generated build output 不进 git。~~ 证据：`dist-node/` 在 `git status` 中仍为 untracked/ignored。

### S4. Python Decommission

目标：删除 Python 实现，而不是维护双栈。

- [x] ~~创建 `docs/python-decommission.md`。~~ 证据：`docs/python-decommission.md`。
- [x] ~~把所有现有 Python CLI surface 盘点成删除清单，不把它们写成兼容承诺。~~ 证据：`docs/python-decommission.md` 中的 S4 replacement/deferred matrix。
- [x] ~~把每个仍有用的命令映射到 TS replacement。~~ 证据：`docs/python-decommission.md` 和 `tests-node/cli-surface.test.ts`。
- [x] ~~为每行跟踪状态：not_started、read_only、write_side、dogfooded、replacement_ready。~~ 证据：S4 matrix 使用 `replacement_ready` 和 `write_side`。
- [x] ~~为每个保留行为列出 verification command。~~ 证据：`docs/python-decommission.md` verification column。
- [x] ~~某个行为的 TS replacement dogfood 通过后，移除对应 Python command surface。~~ 证据：`make check` 和 `make smoke`。
- [x] ~~删除 `src/agentmesh`。~~ 证据：`tests-node/decommission.test.ts`。
- [x] ~~等价 Node tests 存在后，删除 `tests/` 下的 Python tests。~~ 证据：`tests-node/decommission.test.ts` 和 `tests-node/cli-surface.test.ts`。
- [x] ~~删除 `pyproject.toml`。~~ 证据：`tests-node/decommission.test.ts`。
- [x] ~~从 `Makefile` 移除 Python steps。~~ 证据：`make check` 只跑 TS/Node tests，`make smoke` 使用编译后的 TS CLI。
- [x] ~~更新 README 和 Skill docs，让 `agentmesh` 表示 TS CLI。~~ 证据：`README.md` 和 `agentmesh-skill/SKILL.md`。

初始 rows：

- [x] ~~`agentmesh init`~~
- [x] ~~`agentmesh agents list`~~
- [x] ~~`agentmesh agents add`~~
- [x] ~~`agentmesh adapters list`~~
- [x] ~~`agentmesh workflows list`~~
- [x] ~~`agentmesh workflows show`~~
- [x] ~~`agentmesh skill show`~~
- [x] ~~`agentmesh skill export`~~
- [x] ~~`agentmesh skill install`~~
- [x] ~~`agentmesh skill verify`~~
- [x] ~~`agentmesh call`~~
- [x] ~~`agentmesh run`~~
- [x] ~~`agentmesh doctor`~~
- [x] ~~`agentmesh flow run`~~
- [x] ~~`agentmesh flow status`~~
- [x] ~~`agentmesh flow events`~~
- [x] ~~`agentmesh flow prompt`~~
- [x] ~~`agentmesh flow attach`~~
- [x] ~~release-check workflow verdict handling~~
- [x] ~~`agentmesh packet validate`~~

这些 rows 的证据：`docs/python-decommission.md`、`npm test`、`make check` 和 `make smoke`。

从 S4 延后到 TS write-side runtime 的内容：

- [x] ~~`agentmesh flow dispatch`~~ 证据：S5 `tests-node/write-side-runtime.test.ts` 和 `make smoke`。
- [x] ~~`agentmesh flow retry`~~ 证据：S5 `tests-node/write-side-runtime.test.ts`。
- [x] ~~`agentmesh flow resume`~~ 证据：S5 `tests-node/write-side-runtime.test.ts`。
- [x] ~~automatic context pack inputs~~ 证据：S5 `tests-node/write-side-runtime.test.ts`。
- [x] ~~MCP resource ingestion~~ 已从短期范围迁出；TS-on-Node 版本归长期 L3 MCP Client Hardening 重新落地。

### S5. P1 TS Write-Side Runtime

目标：TS 负责状态变更，不只是 read/validate/report。

- [x] ~~在 `packages/runtime` 实现 atomic write helper。~~ 证据：`packages/runtime/src/packet/io.ts` 中的 `writeFileAtomic`。
- [x] ~~实现从 request + workflow assignment 创建 packet。~~ 证据：`createFlowRun` 和 `tests-node/write-side-runtime.test.ts`。
- [x] ~~实现 status write/update。~~ 证据：`packages/runtime/src/flow.ts` 中的 stage lifecycle helpers。
- [x] ~~实现 event append。~~ 证据：dispatch/retry/resume tests 断言 stage 和 retry events。
- [x] ~~实现 artifact manifest write/update。~~ 证据：context、prompt、review、handoff、decision 和 release-summary artifact recording。
- [x] ~~实现 stage lifecycle transitions。~~ 证据：`stage_state`、`completed_stages` 和 `failed_stage` tests。
- [x] ~~实现 worker dispatch semantics。~~ 证据：`agentmesh flow dispatch <run> --stage all` smoke。
- [x] ~~实现从 failed 或指定 stage retry 的语义。~~ 证据：retry regression 保护 completed artifacts。
- [x] ~~实现 resume semantics。~~ 证据：resume regression 从 `--stage review` dispatch 剩余 stages。
- [x] ~~实现 handoff packet generation。~~ 证据：execute dispatch 写入并注册 `handoff.md`。
- [x] ~~实现 release-check write mode。~~ 证据：release-check dispatch 写入 `release-summary.md` 并记录 `release_verdict`。
- [x] ~~重新引入 context、diff、verification 和 scoped git diff 的 context pack inputs。~~ 证据：context packet regression 和 release-check dispatch regression。
- [x] ~~为 write-side packet mutation 增加 fixture-based regression tests。~~ 证据：`tests-node/write-side-runtime.test.ts`。
- [x] ~~至少用一个真实本地 run packet dogfood。~~ 证据：`make smoke` 创建 `make-smoke`，dispatch plan/execute/review/decide，并以 `Status: decide_completed` 结束。

### S6. Doctor 和 Skill Lifecycle 加固

目标：让 host readiness 和 Skill installation 显式可靠。

- [x] ~~保持 doctor probes 与 adapter invocation contracts 分离。~~ 证据：`packages/runtime/src/doctor/readiness.ts` 仍独立于 adapter invocation schemas。
- [x] ~~Probe CLI 是否存在。~~ 证据：missing-command classification test。
- [x] ~~Probe `--help` 或等价 help output。~~ 证据：`doctor report probes AI CLI help, version, and auth readiness`。
- [x] ~~可用时 probe version output。~~ 证据：`version_probe` regression coverage。
- [x] ~~Probe auth readiness。~~ 证据：auth probe pass/skip/failure coverage。
- [x] ~~Probe non-interactive readiness。~~ 证据：`non_interactive` readiness field 和 tests。
- [x] ~~Verify Skill install path 和 expected files。~~ 证据：`skill install writes host files and verify reports ok`。
- [x] ~~用 machine-readable JSON 和 human-readable text 报告 readiness。~~ 证据：`doctor --json`、`skill verify --json` 和 CLI human output。
- [x] ~~增加带 remediation hints 的 failure classifications。~~ 证据：doctor `classification`、skill file `classification` 和 hint tests。

### S7. 最终本地 Release Gate

目标：证明 TS target 可以治理自己的改动。

- [x] ~~运行完整本地 check command。~~ 证据：`make check` 通过 57 个 Node tests。
- [x] ~~用真实 AgentMesh packet 运行 release-check dogfood。~~ 证据：packet `final-release-check-20260514-0315`。
- [x] ~~对 S2-S6 合并实现 diff 做 code self-review。~~ 证据：最终 review 前，自审修复了 doctor default arg duplication 和 OpenCode adapter shorthand normalization。
- [x] ~~当实现跨 package/runtime 边界时，发送 final code review 给外部 reviewer。~~ 证据：`.review-state/multi-review/final-s7-mimo/codex55.out`；MiMo 不可访问，Claude Opus 4.7 受 quota 限制。
- [x] ~~核对 accepted findings 并 patch。~~ 证据：Codex GPT-5.5 High 的 2 个 Must Fix 和 4 个 Should Fix findings 全部 accepted、patched，并由 regression tests 覆盖。
- [x] ~~产出最终 `Verdict: ready`、`Verdict: not_ready` 或 `Verdict: needs_decision`。~~ 证据：`.agentmesh/runs/final-release-check-20260514-0315/decision.md` 记录 `Verdict: ready`；packet validation 返回 `ok: true`。
