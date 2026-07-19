import {
  Badge,
  Card,
  Group,
  List,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useState, type ReactElement } from "react";

type ManualSectionId = "overview" | "setup" | "quickstart" | "concepts" | "operations" | "architecture";

interface ManualSection {
  id: ManualSectionId;
  label: string;
  title: string;
  items: Array<{
    title: string;
    body: string;
    details: string[];
  }>;
}

export const MANUAL_SECTIONS: ManualSection[] = [
  {
    id: "overview",
    label: "概览",
    title: "概览",
    items: [
      {
        title: "AgentMesh 是什么",
        body: "AgentMesh 是本地优先的 AI coding agent 编排工具，把 Codex、Claude、Antigravity、Cursor、OpenCode 等外部工具组织成可追踪、可恢复的协作流程。",
        details: [
          "把一次任务拆成 plan、execute、verify、review、decide 等阶段，每个阶段可以由不同 Agent 或当前入口处理。",
          "每次运行都会落成 Packet、事件、产物和底层 Call 证据，便于复盘、审查和交接。",
          "本地控制台只读取和触发受控操作，真正的写入仍走 runtime API、锁和兼容性检查。",
        ],
      },
      {
        title: "适合的任务",
        body: "当一个任务需要多阶段推进、多 Agent 审查、可重复验证或本地证据留存时，AgentMesh 会比一次性 prompt 更稳。",
        details: [
          "代码变更前先产出方案，再执行、验证、审查和 release gate。",
          "常用协作模式可以固化成 Preset，避免每次重新写 stage assignments。",
          "需要保留 stdout、stderr、exit code、review findings、release verdict 的本地工程流程。",
        ],
      },
      {
        title: "AgentMesh 不做什么",
        body: "AgentMesh 不托管模型、不保存外部工具登录态，也不替各家 CLI 管理账号授权。",
        details: [
          "Codex、Claude、Antigravity、Cursor、OpenCode 的登录、订阅、session 仍由各自工具维护。",
          "AgentMesh 只检测支持的 CLI 是否可调用、能否列出模型，以及当前配置是否能被 runtime 使用。",
          "不会把任意 shell command 暴露成 HTTP API；控制台写入入口只保留明确的 runtime mutation 和资源 lifecycle。",
        ],
      },
    ],
  },
  {
    id: "setup",
    label: "安装与环境",
    title: "安装与环境",
    items: [
      {
        title: "安装渠道",
        body: "AgentMesh 有 CLI 和桌面端两个使用入口；两者读写同一套工作区文件，但安装和更新渠道分开。",
        details: [
          "CLI 发布包：npm install -g agentmesh；源码调试：npm install 后 npm run build，再用 npm run agentmesh -- --help。",
          "桌面端：安装 AgentMesh.app，启动后会自带 app-managed runtime，不依赖全局 agentmesh CLI 执行控制台操作。",
          "指定项目时可以从项目目录启动，或使用 agentmesh studio --workspace /path/to/project / 桌面端 --workspace 参数。",
        ],
      },
      {
        title: "CLI 检测与底层工具",
        body: "AgentMesh 支持的外部 AI CLI 需要各自安装和登录；AgentMesh 负责用统一 resolver 检测它们是否可用。",
        details: [
          "命令行检测：agentmesh cli detect --json；桌面端在设置 / 环境 / CLI 检测展示同一份结果。",
          "检测会查 PATH、app preference 和常见安装路径，不把某个人机器上的绝对路径写死到逻辑里。",
          "检测到 CLI 不等于已授权成功；模型列表、help/version、auth 状态仍以对应工具实际返回为准。",
        ],
      },
      {
        title: "Agent Skill",
        body: "Agent Skill 会把 AgentMesh 的使用规则安装到 Codex、Claude、Cursor、Antigravity、OpenCode 等宿主的规则目录里。",
        details: [
          "Codex 示例：agentmesh skill install --target codex。",
          "其他宿主把 target 换成 claude、cursor、antigravity 或 opencode。",
          "安装 Skill 只是同步使用说明和能力声明，不会安装底层 AI CLI，也不会复制你的账号状态。",
        ],
      },
      {
        title: "版本检查与更新",
        body: "CLI 和桌面端都会显示当前版本、远程最新版本和可用更新方式；桌面端当前仍需要手动替换 DMG。",
        details: [
          "检查版本：agentmesh update check --json；CLI dry-run：agentmesh update install --target cli --dry-run --json。",
          "桌面端更新会返回 DMG 下载地址，下载后退出 AgentMesh.app，再用新 app 完整替换旧 app。",
          "GitHub API 限流时会退到 release 页面解析 latest tag；控制台也提供重新检查按钮。",
        ],
      },
    ],
  },
  {
    id: "quickstart",
    label: "快速上手",
    title: "快速上手",
    items: [
      {
        title: "1. 确认环境",
        body: "先确认 AgentMesh 自己可用，再确认外部 AI CLI、Agent Skill 和工作区兼容性。",
        details: [
          "agentmesh --version 确认当前 runtime 版本；agentmesh update check --json 确认是否有新版本。",
          "agentmesh cli detect --json 或设置 / 环境 / CLI 检测确认 Codex、Claude、Cursor、Antigravity、OpenCode 的可见状态。",
          "关于页确认当前工作区是可读写，旧工作区会在下一次成功写入后补齐兼容性元数据。",
        ],
      },
      {
        title: "2. 配置 Agent 与 Preset",
        body: "Agent 描述能调用哪个工具和模型；Preset 描述一次常用运行怎样分配阶段、fallback 和失败策略。",
        details: [
          "资源页可以创建 Agents、Workflows 和 Presets；CLI 也可用 agents add、workflow add、preset add 管理。",
          "添加 Agent 前先确保对应 adapter 的 CLI 可检测并能返回模型或明确诊断。",
          "常用流程优先注册成 Preset，这样运行时只需要选择 preset 和任务文本。",
        ],
      },
      {
        title: "3. 启动一次运行",
        body: "日常入口建议走 preset-first：先选 Preset，再给任务文本或任务文件。",
        details: [
          "CLI 示例：agentmesh run <preset-id> --task \"描述要完成的任务\"。",
          "运行会生成 .agentmesh/runs/<run-id>/，里面包含 assignment、status、events、context 和 artifacts。",
          "需要当前入口自己处理的节点会显示 current，可以在操作页 attach 文本产物。",
        ],
      },
      {
        title: "4. 查看结果",
        body: "选择左侧 run 后，从详情、审查发布、产物、日志事件逐层深入。",
        details: [
          "详情页看 Workflow Flow、阶段状态、实际 Agent、耗时、尝试次数和退出码。",
          "审查发布页看 release verdict、findings、raw reviews、skipped checks 和 residual risk。",
          "产物和日志事件提供可追溯证据；排障时先看失败阶段、底层 Call 和 stderr。",
        ],
      },
    ],
  },
  {
    id: "concepts",
    label: "核心概念",
    title: "核心概念",
    items: [
      {
        title: "Agent 与 Tool Adapter",
        body: "Agent 是本机可复用的执行配置；Tool Adapter 把统一配置映射成 Codex、Claude、Cursor、Antigravity、OpenCode 各自的 CLI 调用。",
        details: [
          "Agent 保存 adapter、model、reasoning effort、timeout 和 stage capabilities，不保存底层工具登录态。",
          "Adapter 负责处理模型参数、prompt 传参、timeout、输出文件和退出码等工具差异。",
          "capabilities 用来匹配 plan、execute、verify、review、decide 等 stage。",
        ],
      },
      {
        title: "Workflow、Stage 与 Preset",
        body: "Workflow 定义协作形状，Stage 是可执行节点，Preset 固化某个 Workflow 的常用分配和运行策略。",
        details: [
          "Workflow 声明 stage 序列、必需产物、quality gate 和失败策略。",
          "重复 stage 会派生稳定 node id，例如 review、review_2、decide。",
          "Preset 绑定 stage assignments、fallback routing 和 run defaults，适合日常复用。",
        ],
      },
      {
        title: "Stage 类型",
        body: "AgentMesh 内置 plan、execute、verify、review、decide 五类 stage；它们决定当前节点的 prompt contract、规范产物和 fanout 规则。",
        details: [
          "plan：把请求和上下文收敛成可执行方案，产出 plan.md；多 Agent plan 会先写独立候选，再合成为规范 plan。",
          "execute：按 plan 执行实际变更或交付，产出 handoff.md；运行时只允许一个主控 Agent，避免多个 worker 同时改同一批文件。",
          "verify：运行测试、构建、smoke 或回归检查，产出 verification.md；记录 skipped checks 和 residual risk，但不写 release verdict。",
          "review：审查 diff、产物和 verification evidence，保留 reviews/<reviewer>.md 原始证据，再汇总 controller-visible findings.md。",
          "decide：基于前序证据做工程或发布决策，产出 decision.md；在 release workflow 里也是 release verdict 的来源。",
        ],
      },
      {
        title: "Run、Packet 与 Artifact",
        body: "Run 是一次执行实例；Packet 是它的文件事实源；Artifact 是运行过程中生成、附加或汇总的交付物。",
        details: [
          "status.json 是当前快照，events.jsonl 是不可变时间线，assignment.toml 固化 workflow 和分配来源。",
          "artifacts.toml 记录 artifact id、kind、stage、agent 和 Packet 相对路径。",
          "产物预览限制在 run 目录内，避免读取 Packet 外部文件。",
        ],
      },
      {
        title: "Call、Context 与 MCP",
        body: "Call 保存底层工具调用证据；Context Pack 保存本次任务注入的上下文；MCP Resource 是可捕获的外部上下文来源。",
        details: [
          "Call 记录 prompt、stdout、stderr、exit code、output file 和本地采纳状态。",
          "Context 支持 task file、context file、scoped git diff、verification file、project spec、active corrections 和 MCP resources。",
          "上下文来源失败会记录 failed provenance，不会假装已经成功捕获。",
          "当 review/verify fanout 调用多个 Agent 时，Call 是追踪每个外部工具输出的入口。",
        ],
      },
      {
        title: "Run Resume 与 Reviewer Session Resume",
        body: "flow resume 恢复 AgentMesh Run 中断或待处理的 workflow stage；Reviewer Session resume 在多次 Run 之间恢复底层 reviewer provider 会话，两者不会互相替代。",
        details: [
          "interactive_continuous 用于同一个入口宿主对话里的普通连续 review；每轮仍重发当前 packet、diff、verification 和 corrections。",
          "auto 遵循 workflow policy；scope、adapter 能力或安全 registry 不满足时 fresh，且不能弱化 independent workflow。",
          "independent 始终 fresh 并绕过 session registry；release、安全、合规、审批和首次冷读等正式 gate 必须使用。",
          "恢复成功的证据标记为 non-hermetic，provider 历史只作辅助上下文，不能代替当前 Packet 证据。",
          "默认生命周期为空闲 2 小时、绝对最多 12 小时、最多 8 次成功 resume；更短的 provider retention 优先。",
          "过期、不存在、context overflow 或不支持的 adapter 最多一次有界 fresh recovery；认证、权限或 trust 失败不会被静默伪装成 fresh 成功。",
        ],
      },
    ],
  },
  {
    id: "operations",
    label: "操作与排障",
    title: "操作与排障",
    items: [
      {
        title: "资源管理",
        body: "资源页负责创建和查看 Agents、Workflows、Presets、MCP，适合先把常用组合固化下来。",
        details: [
          "Agent 创建参考工具、模型和名称三要素。",
          "Workflow 和 Preset 统一注册到用户配置，创建后可在所有项目里复用。",
          "创建后 catalog 会重新读取 runtime 解析结果，而不是前端自己缓存业务状态。",
        ],
      },
      {
        title: "推进运行",
        body: "Run 页面操作 tab 提供 dispatch、retry、resume 和 attach，用来推进或修复当前 run。",
        details: [
          "dispatch 用来派发可自动执行的 stage。",
          "retry 和 resume 受 run lock、失败状态和 execution policy 约束。",
          "attach 用来给 current stage 写入当前入口 Agent 的文本产物。",
        ],
      },
      {
        title: "审查发布",
        body: "审查发布 tab 把 release verdict、findings、raw reviews 和 release summary 放在一起。",
        details: [
          "先看结论和需要决策的问题，再读原始审查。",
          "skipped checks 和 residual risk 适合进入诊断 tab 做后续排查。",
          "本地采纳证据在 Calls 页面处理，避免把底层调用记录和 Run 结论混在一起。",
        ],
      },
      {
        title: "Reviewer Session 管理",
        body: "Reviewer Session registry 是本机用户级状态；CLI 和 Run 详情只展示不可逆 session_ref 与脱敏状态，可按 ref 或 scope 关闭，也可清理过期项。",
        details: [
          "首次 propagated scope：agentmesh sessions scope create --host codex --json；只在同一入口宿主对话内原样传递返回的 token。",
          "查看：agentmesh sessions list --json；详情：agentmesh sessions inspect <session-ref> --json。",
          "关闭：agentmesh sessions close <session-ref> --json，或 agentmesh sessions close --scope <scope-ref> --json。",
          "清理：agentmesh sessions purge --expired --json；Studio Run 详情也提供关闭当前会话和清理已过期会话。",
          "P5 A/B 未产生合格的 resumed arm，因此所有五个内置 reviewer provider 均保持 fresh-only；Claude Code/OpenCode 只保留底层 probe 供后续重验。",
          "入口宿主可传递安全 conversation scope，不代表对应 reviewer provider 已启用 resume。",
          "propagated token 丢失或无效时 fresh，不得从 workspace、repository、worktree、旧 packet、provider state 或其他宿主对话恢复 scope。",
          "原始 provider/native session ID 不进入 Packet、日志、错误或 Studio；AgentMesh 不读取 provider token、cookie、keychain、登录态或私有 session store。",
        ],
      },
      {
        title: "常见问题",
        body: "大多数问题先看三个地方：环境页 CLI 检测、Run 详情里的失败阶段、Call 里的 stdout/stderr/exit code。",
        details: [
          "CLI 不可选：先看 CLI 检测来源、路径和版本，再确认底层工具是否登录或能列出模型。",
          "Run locked：等待当前 mutation 完成；确认 stale lock 后再按诊断清理。",
          "只读工作区：关于页会显示 compatibility decision 和 last writer，升级 AgentMesh 后再写入。",
          "TOML 注册失败：优先检查 schema/version、重复 id、未知字段和重复 stage 的 node id。",
        ],
      },
    ],
  },
  {
    id: "architecture",
    label: "架构与数据",
    title: "架构与数据",
    items: [
      {
        title: "控制面边界",
        body: "本地控制台负责读取和轻量操作，用来查看 runs、calls、Packet、资源配置和审查证据。",
        details: [
          "读模型从 Packet 文件和 catalog 输出重建。",
          "写入入口只保留 dispatch、retry、resume、attach 和资源 lifecycle。",
          "所有写入继续走 App Server 受控入口，再进入 runtime API。",
        ],
      },
      {
        title: "文件事实源",
        body: "所有可恢复状态都落在本机文件系统，方便人读、CLI 校验和其他 Agent 接手。",
        details: [
          ".agentmesh/runs/<run-id>/ 保存 status、events、assignment、artifacts 和 context。",
          ".agentmesh/calls 保存底层工具调用证据和本地采纳状态。",
          "user/project registry 保存 agents、workflows、presets、MCP server、project spec 和 corrections。",
        ],
      },
      {
        title: "App Server 与 Runtime",
        body: "App Server 把本地文件投影成读取 API，并在 mutation 与资源 lifecycle 前做兼容性、锁和输入校验。",
        details: [
          "/api/runs、/api/calls、/api/catalog 和 /api/compatibility 负责读取投影。",
          "dispatch、retry、resume、attach 走受控 runtime mutation。",
          "Agent、Workflow 和 Preset 创建等 lifecycle 保留 command、exit code、stdout 和 stderr。",
        ],
      },
      {
        title: "安全边界",
        body: "AgentMesh 以 local-first 和最小写入口为边界，不把外部执行和本地控制台混成一个无限制 shell。",
        details: [
          "App Server 使用 per-launch token；桌面端通过 cookie 和首屏 token fallback 进入本地控制台。",
          "预览和读取 API 限制在 packet/call 目录内，不提供任意文件浏览。",
          "外部 AI CLI 的账号、token、session 和网络访问仍由各工具自己管理。",
        ],
      },
    ],
  },
];

export function ManualView(): ReactElement {
  const [selectedSectionId, setSelectedSectionId] = useState<ManualSectionId>("overview");

  return (
    <Tabs
      className="manual-section-tabs"
      value={selectedSectionId}
      onChange={(value) => setSelectedSectionId(isManualSection(value) ? value : "overview")}
      keepMounted={false}
    >
      <Tabs.List aria-label="手册章节" grow>
        {MANUAL_SECTIONS.map((section) => (
          <Tabs.Tab
            value={section.id}
            id={`definition-tab-${section.id}`}
            key={section.id}
          >
            {section.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Paper component="section" className="studio-panel" data-studio-section="react-manual" withBorder radius="md" p="lg" mt="md">
        {MANUAL_SECTIONS.map((section) => (
          <Tabs.Panel value={section.id} key={section.id}>
            <Stack gap="md">
              <Title order={3} size="h4">{section.title}</Title>
              {section.id === "architecture" ? <ArchitectureDiagram /> : null}
              {section.items.map((item) => (
                <Card withBorder radius="md" p="md" key={`${section.id}:${item.title}`}>
                  <Title order={4} size="h5" mb={4}>{item.title}</Title>
                  <Text size="sm" mb="sm">{item.body}</Text>
                  <List size="sm">
                    {item.details.map((detail) => <List.Item key={detail}>{detail}</List.Item>)}
                  </List>
                </Card>
              ))}
            </Stack>
          </Tabs.Panel>
        ))}
      </Paper>
    </Tabs>
  );
}

function ArchitectureDiagram(): ReactElement {
  return (
    <Card
      className="manual-architecture-diagram"
      data-studio-section="manual-architecture-diagram"
      withBorder
      radius="md"
      p="md"
      aria-label="AgentMesh 架构拓扑"
    >
      <Group justify="space-between" align="center" gap="sm" mb="md">
        <div>
          <Title order={4} size="h5">架构拓扑</Title>
          <Text size="sm" c="dimmed">本地分层架构</Text>
        </div>
        <Badge variant="light">local-first · file-backed</Badge>
      </Group>
      <div className="manual-architecture-map" aria-label="本地分层架构">
        <ArchitectureLayer
          title="入口层"
          description="用户看到的控制面，不复制业务状态。"
          tone="blue"
        >
          <ArchitectureNode
            title="AgentMesh UI"
            detail="Mantine React / Desktop WebView"
            tone="blue"
            items={[
              "通过 HTTP API 读取 runs、calls、catalog",
              "触发受控 mutation 与资源 lifecycle",
            ]}
          />
          <ArchitectureNode
            title="agentmesh CLI"
            detail="终端入口"
            tone="gray"
            items={[
              "直接调用 Runtime",
              "与本地控制台共享同一工作区文件模型",
            ]}
          />
        </ArchitectureLayer>
        <ArchitectureLayer
          title="App Server 本地 API 层"
          description="本地控制台的本地投影层和写入门禁。"
          tone="indigo"
        >
          <ArchitectureNode
            title="Read APIs"
            detail="/api/runs · /api/calls · /api/catalog"
            tone="indigo"
            items={[
              "只投影本地文件事实",
              "预览路径限制在 packet/call 目录内",
            ]}
          />
          <ArchitectureNode
            title="Mutation Guard"
            detail="dispatch · retry · resume · attach"
            tone="yellow"
            items={[
              "工作区兼容性检查",
              "run lock 与 stage 输入校验",
            ]}
          />
          <ArchitectureNode
            title="Lifecycle APIs"
            detail="agents · workflows · presets"
            tone="indigo"
            items={[
              "创建、启停、删除走 runtime lifecycle",
              "保留 command、exit code、stdout、stderr",
            ]}
          />
        </ArchitectureLayer>
        <ArchitectureLayer
          title="Runtime Core"
          description="AgentMesh 的业务内核，CLI 与本地控制台共享同一套 API。"
          tone="green"
        >
          <ArchitectureNode
            title="Catalog & Config"
            detail="agents · workflows · presets · MCP"
            tone="green"
            items={[
              "合并 user/project scope",
              "输出可展示的诊断",
            ]}
          />
          <ArchitectureNode
            title="Workflow Engine"
            detail="create · dispatch · fanout · retry"
            tone="green"
            items={[
              "物化 stage node 与 assignment",
              "review/verify fanout 收集证据",
            ]}
          />
          <ArchitectureNode
            title="Packet & Call Readers"
            detail="status · events · artifacts · calls"
            tone="green"
            items={[
              "按 schema 兼容读取 Packet",
              "读取 direct call history/adoption",
            ]}
          />
          <ArchitectureNode
            title="Adapter Runtime"
            detail="统一外部工具调用约定"
            tone="green"
            items={[
              "映射模型、prompt、timeout、reasoning",
              "账号和 session 仍由各工具维护",
            ]}
          />
        </ArchitectureLayer>
        <ArchitectureLayer
          title="本地文件事实源"
          description="所有可恢复状态都落在本机文件系统。"
          tone="gray"
        >
          <ArchitectureNode
            title="Registry & Config"
            detail=".agentmesh / user config"
            tone="gray"
            items={[
              "agents、workflows、presets、MCP",
              "project spec 与 corrections",
            ]}
          />
          <ArchitectureNode
            title="Runs & Packets"
            detail=".agentmesh/runs/<run-id>"
            tone="gray"
            items={[
              "status.json、events.jsonl、assignment",
              "artifacts 与 stage evidence",
            ]}
          />
          <ArchitectureNode
            title="Calls & Locks"
            detail=".agentmesh/calls · .agentmesh.lock"
            tone="gray"
            items={[
              "call.json、prompt、output、stderr",
              "compatibility metadata 与 mutation lease",
            ]}
          />
        </ArchitectureLayer>
        <ArchitectureLayer
          title="外部执行与上下文"
          description="Runtime 只编排边界，外部工具继续拥有自己的登录态和执行环境。"
          tone="yellow"
        >
          <ArchitectureNode
            title="AI CLI Tools"
            detail="Codex · Claude · Antigravity · Cursor · OpenCode"
            tone="yellow"
            items={[
              "由 Adapter Runtime 调用",
              "stdout/stderr/exit code 回写证据",
            ]}
          />
          <ArchitectureNode
            title="MCP Servers"
            detail="外部上下文来源"
            tone="yellow"
            items={[
              "资源捕获进入 Context Pack",
              "失败保留 provenance",
            ]}
          />
        </ArchitectureLayer>
        <div className="manual-architecture-paths" aria-label="关键路径">
          <ArchitecturePath
            label="读路径"
            value="AgentMesh UI -> App Server Read APIs -> Runtime readers -> .agentmesh files"
          />
          <ArchitecturePath
            label="写路径"
            value="AgentMesh UI -> Mutation Guard -> Runtime mutation/lifecycle -> lock + packet/call evidence"
          />
          <ArchitecturePath
            label="终端路径"
            value="agentmesh CLI -> Runtime Core -> 同一套 workspace 文件"
          />
        </div>
      </div>
    </Card>
  );
}

function ArchitectureLayer({
  title,
  description,
  tone,
  children,
}: {
  title: string;
  description: string;
  tone: "blue" | "green" | "gray" | "indigo" | "yellow";
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <section className={`manual-architecture-layer ${tone}`}>
      <div className="manual-architecture-layer-header">
        <Text fw={900}>{title}</Text>
        <Text size="xs" c="dimmed">{description}</Text>
      </div>
      <div className="manual-architecture-grid">
        {children}
      </div>
    </section>
  );
}

function ArchitectureNode({
  title,
  detail,
  tone,
  items,
}: {
  title: string;
  detail: string;
  tone: "blue" | "green" | "gray" | "indigo" | "yellow";
  items: string[];
}): ReactElement {
  return (
    <div className={`manual-architecture-node ${tone}`}>
      <Text fw={800}>{title}</Text>
      <Text size="xs" c="dimmed">{detail}</Text>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function ArchitecturePath({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="manual-architecture-path">
      <Text size="xs" fw={900}>{label}</Text>
      <Text size="xs" c="dimmed">{value}</Text>
    </div>
  );
}

function isManualSection(value: string | null): value is ManualSectionId {
  return MANUAL_SECTIONS.some((section) => section.id === value);
}
