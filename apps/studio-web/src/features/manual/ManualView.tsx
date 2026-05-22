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

type ManualSectionId = "intro" | "install" | "quickstart" | "concepts" | "howto" | "architecture" | "reference" | "troubleshooting";

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
    id: "intro",
    label: "介绍",
    title: "介绍",
    items: [
      {
        title: "AgentMesh 是什么",
        body: "AgentMesh 是本地优先的 AI coding agent 编排工具，用来把 Codex、Claude、Antigravity、Cursor、OpenCode 等外部工具组织成可追踪的协作流程。",
        details: [
          "核心目标是让 plan、execute、verify、review、decide 等阶段可分派、可复盘、可恢复。",
          "每次运行都会落成 Packet、事件、产物和底层 Call 证据，便于审查和交接。",
          "AgentMesh 不托管模型、不保存外部工具登录态；账号和 session 仍由对应 CLI 或宿主自己维护。",
        ],
      },
      {
        title: "适合什么时候用",
        body: "当一个任务需要多阶段推进、多 Agent 审查、可重复验证或本地证据留存时，AgentMesh 会比一次性 prompt 更稳。",
        details: [
          "适合代码变更前先产出方案，再执行、验证、审查和 release gate。",
          "适合把常用协作模式做成 Preset，避免每次重新写一套 stage assignments。",
          "适合需要保留 stdout、stderr、exit code、review findings 和 release verdict 的本地工程流程。",
        ],
      },
      {
        title: "Studio 做什么",
        body: "Studio 是 AgentMesh 的本地控制台，用来查看资源、运行、调用、产物、审查结论、环境集成和版本兼容状态。",
        details: [
          "资源页管理 Agents、Workflows、Presets 和 MCP 的可见状态。",
          "运行页查看 Workflow Flow、阶段详情、操作、审查发布、产物和日志事件。",
          "设置页处理高级默认值、命令行工具、Agent Skill、工作区兼容性和版本信息。",
        ],
      },
    ],
  },
  {
    id: "install",
    label: "安装使用",
    title: "安装使用指引",
    items: [
      {
        title: "安装 AgentMesh",
        body: "如果使用已发布的 CLI 包，优先全局安装；如果在源码仓库里开发，则先安装依赖并构建。",
        details: [
          "发布包安装：npm install -g agentmesh。",
          "源码开发：npm install，然后 npm run build。",
          "仓库内调试 CLI：npm run agentmesh -- --help；已 link 或全局安装后直接使用 agentmesh --help。",
        ],
      },
      {
        title: "启动 Studio",
        body: "Studio 是本地 Web 控制台，启动后会打印一个本机 URL，用浏览器打开即可。",
        details: [
          "已安装 CLI：agentmesh studio --port 4777。",
          "源码仓库：npm run agentmesh -- studio --port 4777。",
          "指定工作区：agentmesh studio --workspace /path/to/project --port 4777。",
        ],
      },
      {
        title: "接入宿主工具",
        body: "Agent Skill 会把 AgentMesh 的使用规则安装到 Codex、Claude、Cursor、Antigravity、OpenCode 等宿主的规则目录里。",
        details: [
          "Codex 示例：agentmesh skill install --target codex。",
          "其他宿主把 target 换成 claude、cursor、antigravity、opencode 或 copilot。",
          "安装 Skill 不等于安装底层 AI CLI；对应 CLI 的账号、授权和 PATH 仍需按各家工具自己的方式准备。",
        ],
      },
      {
        title: "配置第一个 Agent 和 Preset",
        body: "Agent 描述可调用的工具和模型，Preset 描述一次常用运行应该怎样分配阶段和 fallback。",
        details: [
          "添加 Agent：agentmesh agents add --adapter codex --model gpt-5.5。",
          "从 Workflow 初始化 Preset：agentmesh preset init --workflow w-1ab330ed > verified.toml。",
          "注册 Preset：agentmesh preset add verified.toml，然后用 agentmesh preset doctor <preset-id> --json 检查。",
        ],
      },
      {
        title: "开始一次运行",
        body: "日常入口建议走 preset-first UX：先选 Preset，再给任务文本或任务文件。",
        details: [
          "运行 Preset：agentmesh run <preset-id> --task \"描述要完成的任务\"。",
          "需要指定工作区时，先切到项目目录，或在 Studio 启动时传入 --workspace。",
          "运行后到 Studio 的运行页查看详情、审查发布、产物、日志事件和诊断。",
        ],
      },
    ],
  },
  {
    id: "quickstart",
    label: "快速开始",
    title: "快速开始",
    items: [
      {
        title: "推荐路径",
        body: "第一次使用时，先把可用 Agent 和常用 Preset 配好，再从 Runs 里观察一次完整执行。",
        details: [
          "在设置 / 资源里确认 Agents、Workflows、Presets 和 MCP 是否被 runtime 解析到。",
          "优先用 Preset 启动常用协作模式，减少每次手写 stage assignments。",
          "运行后先看详情，再进入审查发布、产物和日志事件。",
        ],
      },
      {
        title: "首次配置",
        body: "环境页处理本机命令行工具和 Agent Skill，资源页处理可复用运行配置。",
        details: [
          "命令行工具只负责把 agentmesh 暴露到 PATH，不保存外部 AI 工具的登录态。",
          "Agent Skill 是给 Codex、Cursor、Antigravity、OpenCode 等宿主使用的项目规则入口。",
          "资源创建默认写入 project scope，个人通用配置再放 user scope。",
        ],
      },
      {
        title: "看一次运行",
        body: "选择左侧 run 后，右侧按详情、审查发布、产物、日志事件逐层深入。",
        details: [
          "详情回答这次 run 是什么、当前状态是什么，以及 Workflow 走到哪一步。",
          "阶段节点会标出哪个 stage 失败、完成或等待当前入口接手。",
          "产物和日志事件提供可追溯证据，排障时优先看这里。",
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
        title: "Agent",
        body: "Agent 是本机可复用的执行配置，描述调用哪个工具、哪个模型以及具备哪些 stage capabilities。",
        details: [
          "adapter 指向 Codex CLI、Claude Code CLI、Cursor Agent、Antigravity CLI 或 OpenCode CLI 等工具。",
          "model、reasoning effort、timeout 和 capabilities 都属于 Agent 配置，不保存底层工具登录态。",
          "capabilities 用来匹配 plan、execute、verify、review、decide 等 stage。",
        ],
      },
      {
        title: "Tool Adapter",
        body: "Tool Adapter 是 AgentMesh 调用外部 coding 工具的适配层，把统一 Agent 配置映射成各工具自己的 CLI 参数。",
        details: [
          "Codex、Claude、Antigravity、Cursor、OpenCode 的非交互调用方式在这里收敛。",
          "不同工具的推理等级、模型参数和 prompt 传参差异由 adapter 处理。",
          "adapter 只负责调用约定，账号、token 和 session 仍由对应工具自己维护。",
        ],
      },
      {
        title: "Workflow",
        body: "Workflow 定义一次协作的形状：有哪些 stage node、需要哪些 artifacts、通过什么 gate 继续。",
        details: [
          "Workflow 不绑定具体 Agent，真正执行者来自 direct run 参数、Preset 或默认分配。",
          "stage 序列会派生稳定 node id，例如 review、decide、review_2。",
          "decision gate 会汇总证据并决定继续、返工或暂停。",
        ],
      },
      {
        title: "Preset",
        body: "Preset 是 Workflow 的常用运行模板，固定 stage assignments、fallback routing、failure policy 和 run defaults。",
        details: [
          "日常运行优先使用 preset-first UX，减少每次手写一串 stage 参数。",
          "Preset 可以存到 user 或 project scope。",
          "重复 stage 必须使用 Workflow 派生出的 node id 做分配。",
        ],
      },
      {
        title: "Stage Node",
        body: "Stage Node 是 Workflow 中可执行的一个节点，当前支持 plan、execute、verify、review、decide。",
        details: [
          "一个 stage node 可以分配一个或多个 Agents。",
          "review 和 verify 支持 fanout 并行收集 per-agent evidence。",
          "current 表示当前入口 Agent 自己处理该节点，不会作为外部 worker 调用。",
        ],
      },
      {
        title: "Run",
        body: "Run 是一次 Workflow 执行实例，拥有自己的 run id、状态、事件、产物和 Packet 目录。",
        details: [
          "Run list 读取的是当前工作区 .agentmesh/runs 下的可追踪记录。",
          "retry、resume、dispatch 和 attach 都是针对某个 run 的受控 mutation。",
          "Studio 左侧 Runs / Calls 用来快速定位最近执行和底层调用。",
        ],
      },
      {
        title: "Call",
        body: "Call 是一次底层 Agent 调用记录，用来保存 prompt、output、stderr、退出码和本地采纳状态。",
        details: [
          "Call 可以独立于 Run 存在，也可以关联到某个 Run。",
          "采纳状态只标记本地审查结论，不会修改原始 prompt 或 output。",
          "当 review/verify fanout 调用多个 Agent 时，Call 是追踪每个外部工具输出的入口。",
        ],
      },
      {
        title: "Context Pack",
        body: "Context Pack 是创建 Run 时注入的上下文包，最终写入 context.md 并保留 provenance。",
        details: [
          "支持 context file、diff file、verification file、scoped git diff、MCP resource 和 active corrections。",
          "来源失败会记录 failed provenance，不会假装上下文已成功捕获。",
          "上下文策略会限制文件数量、字节数和敏感路径。",
        ],
      },
      {
        title: "MCP Resource",
        body: "MCP Resource 是从 MCP server 捕获进 Run 的外部上下文来源。",
        details: [
          "MCP server 定义在项目或用户配置里。",
          "每次 Run 会限制可捕获资源数量，避免上下文失控。",
          "捕获结果会写入 Context Pack，并保留 server/resource provenance。",
        ],
      },
      {
        title: "Project Spec",
        body: "Project Spec 是项目事实文件，用来给入口 Agent 和 AgentMesh 共享稳定约束。",
        details: [
          "默认位置是 .agentmesh/spec/project.toml。",
          "可以通过 spec check 校验，并在创建 Run 时用 include-spec 注入上下文。",
          "适合放项目边界、验证方式、禁改路径和长期约定。",
        ],
      },
    ],
  },
  {
    id: "howto",
    label: "操作指南",
    title: "操作指南",
    items: [
      {
        title: "创建资源",
        body: "资源页负责创建和查看 Agents、Workflows、Presets、MCP，适合先把常用组合固化下来。",
        details: [
          "Agent 创建参考工具、模型和名称三要素。",
          "Workflow 和 Preset 统一注册到用户配置，创建后可在所有项目里复用。",
          "创建后 catalog 会重新读取 runtime 解析结果，而不是前端自己缓存业务状态。",
        ],
      },
      {
        title: "接手运行",
        body: "Run 页面操作 tab 提供 dispatch、retry、resume 和 attach，用来推进或修复当前 run。",
        details: [
          "dispatch 用来派发可自动执行的 stage。",
          "retry 和 resume 受 run lock、失败状态和 execution policy 约束。",
          "attach 用来给 current stage 写入当前入口 Agent 的文本产物。",
        ],
      },
      {
        title: "处理审查发布",
        body: "审查发布 tab 把 release verdict、findings、raw reviews 和 release summary 放在一起。",
        details: [
          "先看结论和需要决策的问题，再读原始审查。",
          "skipped checks 和 residual risk 适合进入诊断 tab 做后续排查。",
          "本地采纳证据在 Calls 页面处理，避免把底层调用记录和 Run 结论混在一起。",
        ],
      },
      {
        title: "安装与集成",
        body: "环境页只处理本机集成：命令行工具包装器和 Agent Skill 安装状态。",
        details: [
          "PATH shadowing 需要明确确认，避免替换或遮蔽已有 agentmesh 命令。",
          "Skill 安装按宿主目标选择，失败时优先看 missing/不同文件提示。",
          "外部 AI 工具的账号登录态仍由各自工具维护。",
        ],
      },
    ],
  },
  {
    id: "architecture",
    label: "架构设计",
    title: "架构设计",
    items: [
      {
        title: "Studio 边界",
        body: "Studio 是本地读取和轻量控制台，用来查看 runs、calls、Packet、资源配置和审查证据。",
        details: [
          "读模型从 Packet 文件和 catalog 输出重建。",
          "写入入口只保留 dispatch、retry、resume、attach 和资源 lifecycle。",
          "所有写入继续走 App Server 受控入口，再进入 runtime API。",
        ],
      },
      {
        title: "App Server",
        body: "App Server 把本地文件投影成读取 API，并在 mutation 与资源 lifecycle 前做兼容性、锁和输入校验。",
        details: [
          "/api/runs、/api/calls、/api/catalog 和 /api/compatibility 负责读取投影。",
          "dispatch、retry、resume、attach 走受控 runtime mutation。",
          "Agent、Workflow 和 Preset 创建等 lifecycle 保留 command、exit code、stdout 和 stderr。",
        ],
      },
    ],
  },
  {
    id: "reference",
    label: "数据与参考",
    title: "数据与参考",
    items: [
      {
        title: "Packet",
        body: "Packet 是 Run 的文件事实源，所有状态、事件、上下文和产物都落在 .agentmesh/runs/<run-id>/ 里。",
        details: [
          "status.json 是当前快照，events.jsonl 是不可变时间线。",
          "assignment.toml 固化 Workflow、stage assignments、fallbacks 和 provenance。",
          "Packet 可被人读、CLI validate，也能让另一个 Agent 接手。",
        ],
      },
      {
        title: "Artifact",
        body: "Artifact 是 Run 过程中产生或附加的文件，例如 request、context、plan、findings、reviews 和 release summary。",
        details: [
          "artifacts.toml 记录 artifact id、kind、stage、agent 和 Packet 相对路径。",
          "Studio 产物页会按 manifest 展示 flow、元信息和安全预览。",
          "预览路径会限制在 run 目录内，避免读取 Packet 外部文件。",
        ],
      },
      {
        title: "Event",
        body: "Event 是 Run 里的不可变事实，用来解释什么时候发生了什么。",
        details: [
          "事件不会因为 status 更新而被覆盖。",
          "Workflow Flow、时间线和 release/review 证据都从事件补充上下文。",
          "worker stdout/stderr、attempt、failure 和 reuse 都会尽量结构化记录。",
        ],
      },
      {
        title: "Registry",
        body: "Registry 记录可复用资源，包含 agents、workflows、presets 和 MCP server 配置。",
        details: [
          "project registry 跟随当前工作区，适合团队共享。",
          "user registry 属于个人机器，适合跨项目复用。",
          "catalog 读取时会合并 scope 并输出冲突或解析诊断。",
        ],
      },
      {
        title: "Locks & Compatibility",
        body: "Locks 和 compatibility metadata 保护本地文件事实源，避免并发写入和旧 runtime 误写。",
        details: [
          "run mutation 会持有 .agentmesh.lock 下的 lease。",
          "compatibility.json 记录最低可读/可写 runtime 版本。",
          "Studio 只在 runtime 允许时开放写入操作。",
        ],
      },
    ],
  },
  {
    id: "troubleshooting",
    label: "排障",
    title: "排障",
    items: [
      {
        title: "资源 missing",
        body: "资源或 Skill 显示 missing 时，先确认对应文件是否在当前 scope，或宿主目标是否安装。",
        details: [
          "资源页诊断会说明 agents、workflows、presets 或 MCP 的解析问题。",
          "环境页的 Skill missing 只代表宿主规则文件缺失，不代表 Agent 不可用。",
          "优先用创建弹窗或安装按钮修复，不要直接猜路径。",
        ],
      },
      {
        title: "PATH shadowing",
        body: "命令行工具显示 external 或 shadowing 时，说明 PATH 里的 agentmesh 不是当前 App 管理的包装器。",
        details: [
          "如果要替换或遮蔽已有命令，需要勾选确认。",
          "自定义 Bin 目录会在安装时检查目标文件。",
          "版本 unknown 常见于 PATH 命令不是 AgentMesh wrapper。",
        ],
      },
      {
        title: "Run locked",
        body: "Run locked 表示另一个 mutation 正在写这个 run，或者旧 lease 尚未过期。",
        details: [
          "先等待当前操作完成，避免并发写同一个 Packet。",
          "详情里会包含 operation、entrypoint、runtime、pid 和 expires_at。",
          "确认是 stale lock 后再按提示清理。",
        ],
      },
      {
        title: "Read-only workspace",
        body: "工作区只读通常来自 compatibility metadata，说明当前 runtime 可以读但不应该写。",
        details: [
          "关于页会显示 compatibility decision 和 last writer。",
          "升级 AgentMesh 后再执行写操作。",
          "读路径仍可用于查看历史 runs、calls 和 artifacts。",
        ],
      },
      {
        title: "TOML 或 stage id 错误",
        body: "Workflow/Preset TOML 注册失败时，优先检查版本字段、重复 id、未知 top-level 字段和 stage node id。",
        details: [
          "重复 stage 需要使用派生 node id，例如 review_2。",
          "Preset assignment 必须引用 Workflow 中真实存在的 node id。",
          "失败输出会保留 command、stdout、stderr 和 exit code。",
        ],
      },
    ],
  },
];

export function ManualView(): ReactElement {
  const [selectedSectionId, setSelectedSectionId] = useState<ManualSectionId>("intro");
  const selectedSection = MANUAL_SECTIONS.find((section) => section.id === selectedSectionId)
    ?? MANUAL_SECTIONS[0];

  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-manual" withBorder radius="md" p="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Title order={2} size="h3">手册</Title>
        <Text size="sm" c="dimmed" fw={700}>{MANUAL_SECTIONS.length} 个章节</Text>
      </Group>
      <Tabs mt="md" value={selectedSectionId} onChange={(value) => setSelectedSectionId(isManualSection(value) ? value : "intro")} keepMounted={false}>
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
        {MANUAL_SECTIONS.map((section) => (
          <Tabs.Panel value={section.id} pt="md" key={section.id}>
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
      </Tabs>
    </Paper>
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
      aria-label="AgentMesh Studio 架构拓扑"
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
            title="Studio UI"
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
              "与 Studio 共享同一工作区文件模型",
            ]}
          />
        </ArchitectureLayer>
        <ArchitectureLayer
          title="App Server 本地 API 层"
          description="Studio 的本地投影层和写入门禁。"
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
          description="AgentMesh 的业务内核，CLI 与 Studio 共享同一套 API。"
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
            value="Studio UI -> App Server Read APIs -> Runtime readers -> .agentmesh files"
          />
          <ArchitecturePath
            label="写路径"
            value="Studio UI -> Mutation Guard -> Runtime mutation/lifecycle -> lock + packet/call evidence"
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
