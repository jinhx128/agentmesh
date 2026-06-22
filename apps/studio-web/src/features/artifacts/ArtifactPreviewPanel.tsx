import {
  Alert,
  Badge,
  Button,
  Code,
  Drawer,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { ReactElement, ReactNode } from "react";
import { parse as parseToml } from "smol-toml";
import type {
  StudioArtifactPreview,
  StudioArtifactSummary,
  StudioRunDetail,
  StudioRunEvent,
} from "../../api/runs.js";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import { workflowStageLabel } from "../../app/stages.js";
import { formatLocalDateTime, formatLocalTime } from "../../app/time.js";
import {
  preferredWorkflowStage,
  type AgentDisplayNames,
  workflowStageStatus,
} from "../runs/RunOverview.js";

export type ArtifactPreviewState =
  | { status: "idle" }
  | { status: "loading"; artifactName: string }
  | { status: "ready"; preview: StudioArtifactPreview }
  | { status: "error"; artifactName: string; message: string };

export interface ArtifactPreviewPanelProps {
  detail: StudioRunDetail;
  selectedArtifactName?: string;
  previewState: ArtifactPreviewState;
  agentLabels?: AgentDisplayNames;
  onSelectArtifact: (artifactName: string) => void;
}

export interface ArtifactSidebarPanelProps {
  detail: StudioRunDetail;
  selectedArtifactName?: string;
  onSelectArtifact: (artifactName: string) => void;
}

export interface ArtifactPreviewDrawerProps {
  opened: boolean;
  previewState: ArtifactPreviewState;
  agentLabels?: AgentDisplayNames;
  onClose: () => void;
}

export function ArtifactPreviewPanel({
  detail,
  selectedArtifactName,
  previewState,
  agentLabels,
  onSelectArtifact,
}: ArtifactPreviewPanelProps): ReactElement {
  const { t } = useStudioCopy();
  const artifacts = sortStudioArtifacts(detail);
  return (
    <Stack gap="md" data-studio-section="react-artifact-preview">
      <Paper
        component="section"
        className="studio-panel artifact-list-panel"
        data-studio-section="packet-artifacts"
        withBorder
        radius="md"
        px="md"
        pt="xs"
        pb="md"
      >
        <PanelHeader title={t("artifacts")} meta={artifactCountLabel(artifacts.length, t)} />
        {artifacts.length > 0 ? (
          <div className="artifact-flow" aria-label={t("artifacts")}>
            {artifacts.map((artifact, index) => {
              const generatedAt = formatLocalDateTime(artifactTimelineTimestamp(artifact, detail));
              return (
                <div className="artifact-step" key={artifact.name}>
                  <Button
                    className={`artifact-node${artifact.name === selectedArtifactName ? " selected" : ""}`}
                    variant={artifact.name === selectedArtifactName ? "light" : "default"}
                    color={artifact.name === selectedArtifactName ? "agentmesh" : "gray"}
                    h="auto"
                    p="xs"
                    data-artifact={artifact.name}
                    aria-current={artifact.name === selectedArtifactName ? "true" : undefined}
                    onClick={() => onSelectArtifact(artifact.name)}
                  >
                    <Stack gap={6} align="flex-start" w="100%">
                      <Text size="sm" fw={800} truncate="end">{artifactDisplayName(artifact)}</Text>
                      <Group gap={4} wrap="nowrap">
                        <Badge size="xs">{artifactKindLabel(artifact.kind)}</Badge>
                        <Badge size="xs" variant="light">{artifactStageLabel(artifact.stage)}</Badge>
                      </Group>
                      <Text
                        className="artifact-node-generated-at"
                        data-studio-section="artifact-generated-at"
                        size="xs"
                        c="dimmed"
                        fw={700}
                      >
                        {generatedAt}
                      </Text>
                    </Stack>
                  </Button>
                  {index < artifacts.length - 1 ? (
                    <span className="artifact-connector" aria-hidden="true" />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <Alert mt="md" variant="light">{t("noArtifacts")}</Alert>
        )}
      </Paper>
      <Paper
        component="section"
        className="studio-panel artifact-preview-panel"
        data-studio-section="artifact-preview"
        withBorder
        radius="md"
        px="md"
        pt="sm"
        pb="md"
      >
        {previewState.status === "ready" ? (
          <>
            <ArtifactInfoBlock state={previewState} t={t} agentLabels={agentLabels} />
            <Title className="artifact-preview-title" order={3} size="h4" mt="md">
              {previewTitle(previewState, t)}
            </Title>
          </>
        ) : (
          <PanelHeader title={previewTitle(previewState, t)} meta="" />
        )}
        <ArtifactPreviewContent
          state={previewState}
          t={t}
          agentLabels={agentLabels}
          codeMarginTop={previewState.status === "ready" ? "sm" : "md"}
        />
      </Paper>
    </Stack>
  );
}

export function ArtifactSidebarPanel({
  detail,
  selectedArtifactName,
  onSelectArtifact,
}: ArtifactSidebarPanelProps): ReactElement {
  const { t } = useStudioCopy();
  const artifacts = sortStudioArtifacts(detail);
  const currentStage = preferredWorkflowStage(detail.summary);
  const currentStatus = currentStage ? workflowStageStatus(detail.summary, currentStage) : undefined;
  const currentStageArtifacts = currentStage
    ? artifacts.filter((artifact) => artifact.stage === currentStage)
    : [];
  return (
    <Paper
      component="aside"
      className="studio-panel artifact-sidebar-panel"
      data-studio-section="current-node-artifacts"
      withBorder
      radius="md"
      p="md"
    >
      <Stack gap="md">
        <Stack className="artifact-sidebar-summary" gap={6}>
          <Group justify="space-between" align="center" gap="xs">
            <Text size="sm" fw={800}>{t("currentNode")}</Text>
            {currentStatus ? <Badge size="xs" color={stageColor(currentStatus)}>{stageStatusLabel(currentStatus, t)}</Badge> : null}
          </Group>
          <div className="artifact-sidebar-current-node">
            <Text size="sm" fw={800} truncate="end" title={currentStage ?? t("noCurrentNode")}>
              {currentStage ?? t("noCurrentNode")}
            </Text>
            <Text size="xs" c="dimmed" fw={700}>
              {currentStageArtifacts.length > 0
                ? `${currentStageArtifacts.length} ${t("artifacts")}`
                : t("noArtifactsForCurrentNode")}
            </Text>
          </div>
        </Stack>
        <Stack className="artifact-sidebar-artifacts" gap="xs">
          <Group className="artifact-sidebar-list-heading" justify="space-between" align="center" gap="xs">
            <Text size="sm" fw={800}>{t("artifacts")}</Text>
            <Badge size="xs" variant="light">{artifacts.length}</Badge>
          </Group>
          {artifacts.length > 0 ? (
            <Stack className="artifact-sidebar-list" gap={8} aria-label={t("artifacts")}>
              {artifacts.map((artifact) => {
                const timestamp = artifactTimelineTimestamp(artifact, detail);
                return (
                  <Button
                    className="artifact-sidebar-item"
                    variant={artifact.name === selectedArtifactName ? "light" : "default"}
                    color={artifact.name === selectedArtifactName ? "agentmesh" : "gray"}
                    h="auto"
                    p={0}
                    key={artifact.name}
                    data-artifact-sidebar-item={artifact.name}
                    aria-current={artifact.name === selectedArtifactName ? "true" : undefined}
                    onClick={() => onSelectArtifact(artifact.name)}
                  >
                    <Group className="artifact-sidebar-item-row" justify="space-between" gap="xs" wrap="nowrap" w="100%">
                      <Stack className="artifact-sidebar-item-main" gap={2} miw={0}>
                        <Text size="sm" fw={800} truncate="end" title={artifactDisplayName(artifact)}>
                          {artifactDisplayName(artifact)}
                        </Text>
                        <Text size="xs" c="dimmed" truncate="end" title={artifact.path}>
                          {artifact.path}
                        </Text>
                      </Stack>
                      {timestamp ? (
                        <Text
                          className="artifact-sidebar-item-time"
                          component="time"
                          dateTime={timestamp}
                          size="xs"
                          c="dimmed"
                          fw={700}
                          title={formatLocalDateTime(timestamp)}
                        >
                          {formatLocalTime(timestamp)}
                        </Text>
                      ) : null}
                    </Group>
                  </Button>
                );
              })}
            </Stack>
          ) : (
            <Alert color="gray" variant="light">{t("noArtifacts")}</Alert>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

export function ArtifactPreviewDrawer({
  opened,
  previewState,
  agentLabels,
  onClose,
}: ArtifactPreviewDrawerProps): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="50vw"
      offset="clamp(16px, 1.5vw, 32px)"
      classNames={{ content: "artifact-preview-drawer" }}
      title={<Text fw={800}>{drawerTitle(previewState, t)}</Text>}
      padding="md"
    >
      <div className="artifact-preview-drawer-layout" data-studio-section="artifact-preview-drawer">
        <div className="artifact-preview-drawer-main">
          {previewState.status === "ready" ? <ArtifactInfoBlock state={previewState} t={t} agentLabels={agentLabels} /> : null}
          <ArtifactPreviewContent state={previewState} t={t} agentLabels={agentLabels} />
        </div>
      </div>
    </Drawer>
  );
}

export function sortStudioArtifacts(detail: StudioRunDetail): StudioArtifactSummary[] {
  return [...detail.artifacts]
    .map((artifact, index) => ({
      artifact,
      index,
      time: artifactTimelineMillis(artifact, detail),
    }))
    .sort((left, right) => {
      if (left.time !== null && right.time !== null && left.time !== right.time) {
        return left.time - right.time;
      }
      if (left.time !== null && right.time === null) {
        return -1;
      }
      if (left.time === null && right.time !== null) {
        return 1;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.artifact);
}

export function artifactDisplayName(artifact: Pick<StudioArtifactSummary, "name" | "path" | "kind" | "stage">): string {
  const candidates = [artifact.path, artifact.name]
    .map(artifactBaseName)
    .filter((candidate) => candidate.length > 0);
  for (const candidate of candidates) {
    const translated = translateArtifactBaseName(candidate);
    if (translated) {
      return translated;
    }
  }
  if (artifact.kind === "prompt") {
    return "提示词";
  }
  if (artifact.kind === "request") {
    return "请求";
  }
  if (artifact.kind === "context") {
    return "上下文";
  }
  if (artifact.kind === "review-output") {
    return "审查输出";
  }
  if (artifact.kind === "release-summary") {
    return "发布摘要";
  }
  return candidates[0] ?? artifact.name;
}

function previewTitle(state: ArtifactPreviewState, t: (key: StudioCopyKey) => string): string {
  if (state.status === "ready") {
    return `${t("preview")}: ${artifactDisplayName(state.preview)}`;
  }
  if (state.status === "loading") {
    return `${t("preview")}: ${artifactNameLabel(state.artifactName)}`;
  }
  if (state.status === "error") {
    return `${t("preview")}: ${artifactNameLabel(state.artifactName)}`;
  }
  return t("preview");
}

function drawerTitle(state: ArtifactPreviewState, t: (key: StudioCopyKey) => string): string {
  if (state.status === "ready") {
    return artifactDisplayName(state.preview);
  }
  if (state.status === "loading") {
    return `${t("preview")}: ${artifactNameLabel(state.artifactName)}`;
  }
  if (state.status === "error") {
    return `${t("preview")}: ${artifactNameLabel(state.artifactName)}`;
  }
  return t("preview");
}

function artifactNameLabel(artifactName: string): string {
  return artifactDisplayName({
    name: artifactName,
    path: artifactName,
    kind: "artifact",
    stage: "",
  });
}

function artifactCountLabel(count: number, t: (key: StudioCopyKey) => string): string {
  return `${count} ${t("artifactTotal")}`;
}

function previewContent(state: ArtifactPreviewState, t: (key: StudioCopyKey) => string): string {
  if (state.status === "loading") {
    return `${t("preview")}...`;
  }
  if (state.status === "error") {
    return `${t("previewLoadFailed")}: ${state.message}`;
  }
  if (state.status === "ready") {
    return state.preview.content.length > 0 ? state.preview.content : t("noPreviewContent");
  }
  return t("selectArtifact");
}

function ArtifactPreviewContent({
  state,
  t,
  agentLabels,
  codeMarginTop,
}: {
  state: ArtifactPreviewState;
  t: (key: StudioCopyKey) => string;
  agentLabels?: AgentDisplayNames;
  codeMarginTop?: "sm" | "md";
}): ReactElement {
  const content = previewContent(state, t);
  if (state.status === "ready") {
    const assignmentSummary = assignmentArtifactSummaryMarkdown(state.preview, agentLabels);
    if (assignmentSummary) {
      return (
        <div className="artifact-markdown" data-studio-section="artifact-assignment-summary">
          {renderMarkdownBlocks(assignmentSummary)}
        </div>
      );
    }
    const statusSummary = statusArtifactSummaryMarkdown(state.preview, agentLabels);
    if (statusSummary) {
      return (
        <div className="artifact-markdown" data-studio-section="artifact-status-summary">
          {renderMarkdownBlocks(statusSummary)}
        </div>
      );
    }
    const contextSummary = contextArtifactSummaryMarkdown(state.preview);
    if (contextSummary) {
      return (
        <div className="artifact-markdown" data-studio-section="artifact-context-summary">
          {renderMarkdownBlocks(contextSummary)}
        </div>
      );
    }
  }
  if (state.status === "ready" && state.preview.content.length > 0 && isMarkdownArtifact(state.preview)) {
    return (
      <div className="artifact-markdown" data-studio-section="artifact-markdown-preview">
        {renderMarkdownBlocks(content)}
      </div>
    );
  }
  return (
    <Code block className="studio-code-block" mt={codeMarginTop}>
      {content}
    </Code>
  );
}

function isMarkdownArtifact(artifact: Pick<StudioArtifactPreview, "name" | "path" | "kind">): boolean {
  return [artifact.path, artifact.name].some((value) => /\.(?:md|markdown)$/i.test(value))
    || artifact.kind === "markdown";
}

function assignmentArtifactSummaryMarkdown(
  preview: StudioArtifactPreview,
  agentLabels?: AgentDisplayNames,
): string | null {
  if (!isAssignmentArtifact(preview) || preview.content.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parseToml(preview.content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const workflow = stringValue(parsed.workflow);
  const stages = stringArray(parsed.stages);
  const stageNodes = recordArray(parsed.stage_nodes);
  const assignments = isRecord(parsed.stage_assignments) ? parsed.stage_assignments : {};
  const stageOrder = assignmentStageOrder(stages, stageNodes, assignments);
  const lines = [
    "## 任务分配摘要",
    "",
    "这是一份运行调度生成的任务分配文件，不属于单个 Agent。",
  ];
  if (workflow) {
    lines.push("", `- Workflow：${workflow}`);
  }
  if (stages.length > 0) {
    lines.push(`- 阶段顺序：${stages.map(workflowStageLabel).join(" -> ")}`);
  }
  if (stageNodes.length > 0) {
    lines.push("", "### 节点");
    for (const node of stageNodes) {
      const id = stringValue(node.id);
      const type = stringValue(node.type);
      const occurrence = occurrenceValue(node.occurrence);
      const nodeLabel = workflowStageLabel(id ?? type ?? "节点");
      const typeLabel = workflowStageLabel(type ?? id ?? "未记录");
      lines.push(`- ${nodeLabel}：类型：${typeLabel}${occurrence ? `，第 ${occurrence} 次` : ""}`);
    }
  }
  if (stageOrder.length > 0) {
    lines.push("", "### Agent 分配");
    for (const stage of stageOrder) {
      const agents = stringArray(assignments[stage]);
      const agentNames = agents.map((agent) => agentDisplayName(agent, agentLabels));
      lines.push(`- ${workflowStageLabel(stage)}：${agentNames.length > 0 ? agentNames.join("、") : "未指定"}`);
    }
  }
  return lines.join("\n");
}

function assignmentStageOrder(
  stages: string[],
  stageNodes: Record<string, unknown>[],
  assignments: Record<string, unknown>,
): string[] {
  const ordered = new Set<string>();
  for (const stage of stages) {
    ordered.add(stage);
  }
  for (const node of stageNodes) {
    const id = stringValue(node.id);
    if (id) {
      ordered.add(id);
    }
  }
  for (const stage of Object.keys(assignments)) {
    ordered.add(stage);
  }
  return Array.from(ordered);
}

function isAssignmentArtifact(artifact: Pick<StudioArtifactPreview, "name" | "path" | "kind">): boolean {
  if (artifact.kind === "assignment") {
    return true;
  }
  return [artifact.path, artifact.name].some((value) => artifactBaseName(value).toLowerCase() === "assignment");
}

function statusArtifactSummaryMarkdown(
  preview: StudioArtifactPreview,
  agentLabels?: AgentDisplayNames,
): string | null {
  if (!isStatusArtifact(preview) || preview.content.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(preview.content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const runId = stringValue(parsed.run_id);
  const status = stringValue(parsed.status);
  const assignments = isRecord(parsed.stage_assignments) ? parsed.stage_assignments : {};
  const invocations = isRecord(parsed.stage_invocations) ? parsed.stage_invocations : {};
  const attempts = isRecord(parsed.stage_attempts) ? parsed.stage_attempts : {};
  const stageOrder = statusStageOrder(assignments, invocations, attempts);
  const lines = [
    "## 运行状态摘要",
    "",
    "这是一份运行过程的当前状态快照，用来记录 run 走到哪里、哪些 Agent 被分配、哪些尝试正在执行。",
  ];
  if (runId) {
    lines.push("", `- 运行 ID：${runId}`);
  }
  if (status) {
    lines.push(`- 当前状态：${runStatusLabel(status)}`);
  }
  const createdAt = dateTimeValue(parsed.created_at);
  if (createdAt) {
    lines.push(`- 创建时间：${createdAt}`);
  }
  const updatedAt = dateTimeValue(parsed.updated_at);
  if (updatedAt) {
    lines.push(`- 更新时间：${updatedAt}`);
  }
  if (stageOrder.length > 0) {
    lines.push("", "### 阶段分配");
    for (const stage of stageOrder) {
      const agents = stringArray(assignments[stage]).map((agent) => agentDisplayName(agent, agentLabels));
      lines.push(`- ${workflowStageLabel(stage)}：${agents.length > 0 ? agents.join("、") : "未指定"}`);
    }
  }
  const invocationLines = stageOrder.flatMap((stage) => {
    const rows = recordArray(invocations[stage]);
    return rows.map((row) => {
      const kind = invocationKindLabel(stringValue(row.kind));
      const agent = stringValue(row.actual_agent) ?? stringValue(row.agent);
      const label = agent ? agentDisplayName(agent, agentLabels) : "未记录 Agent";
      return `- ${workflowStageLabel(stage)}：${kind}，${label}`;
    });
  });
  if (invocationLines.length > 0) {
    lines.push("", "### 调用记录", ...invocationLines);
  }
  const attemptLines = stageOrder.flatMap((stage) => {
    const rows = recordArray(attempts[stage]);
    return rows.map((row) => {
      const attemptStatus = attemptStatusLabel(stringValue(row.status));
      const agent = stringValue(row.actual_agent) ?? stringValue(row.agent);
      const label = agent ? agentDisplayName(agent, agentLabels) : "未记录 Agent";
      const startedAt = dateTimeValue(row.started_at);
      return `- ${workflowStageLabel(stage)}：${attemptStatus}，${label}${startedAt ? `，开始 ${startedAt}` : ""}`;
    });
  });
  if (attemptLines.length > 0) {
    lines.push("", "### 尝试记录", ...attemptLines);
  }
  return lines.join("\n");
}

function isStatusArtifact(artifact: Pick<StudioArtifactPreview, "name" | "path" | "kind">): boolean {
  if (artifact.kind === "status") {
    return true;
  }
  return [artifact.path, artifact.name].some((value) => artifactBaseName(value).toLowerCase() === "status");
}

function contextArtifactSummaryMarkdown(preview: StudioArtifactPreview): string | null {
  if (!isContextArtifact(preview) || preview.content.trim().length === 0) {
    return null;
  }
  const entries = contextEntries(preview.content);
  if (entries.length === 0) {
    return null;
  }
  const lines = [
    "## 上下文摘要",
    "",
    "这是本次运行给 Agent 准备的输入材料，通常包含代码差异、项目事实、必读文件和校验信息。",
    "",
    "### 来源",
  ];
  for (const entry of entries) {
    const sourceType = stringValue(entry.provenance.source_type);
    const source = stringValue(entry.provenance.source);
    const command = stringValue(entry.provenance.source_command);
    const capturedAt = dateTimeValue(entry.provenance.capture_timestamp);
    const error = stringValue(entry.provenance.ingestion_error);
    lines.push(`- ${contextSourceLabel(sourceType, entry.title)}：${contextValidationLabel(stringValue(entry.provenance.validation_state))}${source ? `，来源：${source}` : ""}`);
    if (command) {
      lines.push(`- 命令：\`${command}\``);
    }
    if (capturedAt) {
      lines.push(`- 抓取时间：${capturedAt}`);
    }
    if (error) {
      lines.push(`- 失败原因：${contextIngestionErrorLabel(error)}`);
    }
    const previewLine = contextContentPreview(entry.content);
    if (previewLine) {
      lines.push(`- 内容预览：${previewLine}`);
    }
  }
  return lines.join("\n");
}

function isContextArtifact(artifact: Pick<StudioArtifactPreview, "name" | "path" | "kind">): boolean {
  if (artifact.kind === "context") {
    return true;
  }
  return [artifact.path, artifact.name].some((value) => artifactBaseName(value).toLowerCase() === "context");
}

function contextEntries(content: string): Array<{
  content: string;
  provenance: Record<string, unknown>;
  title: string;
}> {
  const entries: Array<{ content: string; provenance: Record<string, unknown>; title: string }> = [];
  const pattern = /^##\s+(.+?)\s*\n+###\s+Provenance\s*\n+```(?:toml)?\n([\s\S]*?)\n```\s*\n+###\s+Content\s*\n([\s\S]*?)(?=\n##\s+|\s*$)/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const title = match[1]?.trim() ?? "上下文";
    const provenanceText = match[2]?.trim() ?? "";
    const entryContent = match[3]?.trim() ?? "";
    let parsed: unknown;
    try {
      parsed = parseToml(provenanceText);
    } catch {
      continue;
    }
    if (isRecord(parsed)) {
      entries.push({ content: entryContent, provenance: parsed, title });
    }
  }
  return entries;
}

function contextSourceLabel(sourceType: string | null, fallbackTitle: string): string {
  if (sourceType) {
    const labels: Record<string, string> = {
      diff_file: "Diff 文件",
      file: "文件",
      mcp_resource: "MCP 资源",
      project_correction: "项目纠偏",
      project_spec: "项目说明",
      scoped_git_diff: "范围 Git Diff",
      verification_file: "验证文件",
    };
    return labels[sourceType] ?? sourceType;
  }
  return localizeMixedArtifactName(fallbackTitle);
}

function contextValidationLabel(value: string | null): string {
  if (value === "ok") {
    return "已抓取";
  }
  if (value === "failed") {
    return "抓取失败";
  }
  if (value === "skipped") {
    return "已跳过";
  }
  return value ?? "状态未知";
}

function contextIngestionErrorLabel(error: string): string {
  const gitDiff = error.match(/^git diff failed with exit code (\d+)\s*([\s\S]*)$/);
  if (gitDiff) {
    const details = gitDiff[2]?.trim();
    return `git diff 执行失败（exit code ${gitDiff[1]}）${details ? `：${details}` : ""}`;
  }
  return error;
}

function contextContentPreview(content: string): string | null {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const firstUseful = lines.find((line) => !/^\(no .+ captured\)$/i.test(line));
  if (!firstUseful) {
    return null;
  }
  return firstUseful.length > 160 ? `${firstUseful.slice(0, 157)}...` : firstUseful;
}

function statusStageOrder(
  assignments: Record<string, unknown>,
  invocations: Record<string, unknown>,
  attempts: Record<string, unknown>,
): string[] {
  return Array.from(new Set([
    ...Object.keys(assignments),
    ...Object.keys(invocations),
    ...Object.keys(attempts),
  ]));
}

function runStatusLabel(status: string): string {
  const exact: Record<string, string> = {
    completed: "已完成",
    failed: "失败",
    pending: "待开始",
    running: "运行中",
  };
  if (exact[status]) {
    return exact[status];
  }
  const match = status.match(/^([A-Za-z0-9_-]+)_(running|completed|failed|pending)$/);
  if (!match) {
    return status;
  }
  const stage = workflowStageLabel(match[1] ?? "");
  const suffix = {
    completed: "完成",
    failed: "失败",
    pending: "待开始",
    running: "中",
  }[match[2] as "running" | "completed" | "failed" | "pending"];
  return `${stage}${suffix}`;
}

function invocationKindLabel(kind: string | null): string {
  if (!kind) {
    return "调用";
  }
  return {
    current: "当前入口",
    fallback: "备用分配",
    primary: "主分配",
  }[kind] ?? kind;
}

function attemptStatusLabel(status: string | null): string {
  if (!status) {
    return "未记录状态";
  }
  return {
    completed: "已完成",
    failed: "失败",
    pending: "待开始",
    running: "运行中",
  }[status] ?? status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function occurrenceValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return stringValue(value);
}

function dateTimeValue(value: unknown): string | null {
  return timestampMillis(value) !== null ? formatLocalDateTime(value as string) : null;
}

function renderMarkdownBlocks(content: string): ReactElement[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactElement[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(
        <pre className="artifact-markdown-code" key={`code:${blocks.length}`}>
          <code data-language={fence[1] || undefined}>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push(renderMarkdownHeading(heading[1].length, heading[2], `heading:${blocks.length}`));
      index += 1;
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const tableRows = [lines[index] ?? ""];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index] ?? "")) {
        tableRows.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push(renderMarkdownTable(tableRows, `table:${blocks.length}`));
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul:${blocks.length}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item, `ul:${blocks.length}:${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol:${blocks.length}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(item, `ol:${blocks.length}:${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`quote:${blocks.length}`}>
          {renderInlineMarkdown(quoteLines.join(" "), `quote:${blocks.length}`)}
        </blockquote>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim().length > 0 &&
      !startsMarkdownBlock(lines, index)
    ) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(
      <p key={`p:${blocks.length}`}>
        {renderInlineMarkdown(paragraphLines.join(" "), `p:${blocks.length}`)}
      </p>,
    );
  }

  return blocks.length > 0 ? blocks : [<p key="empty">{content}</p>];
}

function startsMarkdownBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return /^\s*```/.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^\s*[-*+]\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || isMarkdownTableStart(lines, index);
}

function renderMarkdownHeading(level: number, text: string, key: string): ReactElement {
  const children = renderInlineMarkdown(text, key);
  if (level === 1) {
    return <h1 key={key}>{children}</h1>;
  }
  if (level === 2) {
    return <h2 key={key}>{children}</h2>;
  }
  if (level === 3) {
    return <h3 key={key}>{children}</h3>;
  }
  if (level === 4) {
    return <h4 key={key}>{children}</h4>;
  }
  if (level === 5) {
    return <h5 key={key}>{children}</h5>;
  }
  return <h6 key={key}>{children}</h6>;
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  return isMarkdownTableRow(lines[index] ?? "") && isMarkdownTableDivider(lines[index + 1] ?? "");
}

function isMarkdownTableRow(line: string): boolean {
  return /^\s*\|?.+\|.+\|?\s*$/.test(line);
}

function isMarkdownTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function renderMarkdownTable(rows: string[], key: string): ReactElement {
  const [header = [], ...body] = rows.map(splitMarkdownTableRow);
  return (
    <table key={key}>
      <thead>
        <tr>
          {header.map((cell, index) => (
            <th key={index}>{renderInlineMarkdown(cell, `${key}:h:${index}`)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {body.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{renderInlineMarkdown(cell, `${key}:r:${rowIndex}:${cellIndex}`)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}:${nodes.length}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

function ArtifactInfoBlock({
  state,
  t,
  agentLabels,
}: {
  state: ArtifactPreviewState;
  t: (key: StudioCopyKey) => string;
  agentLabels?: AgentDisplayNames;
}): ReactElement | null {
  if (state.status !== "ready") {
    return null;
  }
  const { preview } = state;
  return (
    <div className="artifact-info-panel" data-studio-section="artifact-info">
      <Group justify="space-between" gap="xs" mb="xs">
        <Text className="artifact-info-title" size="sm" fw={800}>{t("artifactInfo")}</Text>
        {preview.truncated ? <Badge size="sm" color="yellow" variant="light">{t("truncated")}</Badge> : null}
      </Group>
      <div className="artifact-info-grid">
        <ArtifactInfoItem label={t("name")} value={artifactDisplayName(preview)} />
        <ArtifactInfoItem label={t("type")} value={artifactKindLabel(preview.kind)} />
        <ArtifactInfoItem label={t("stage")} value={artifactStageLabel(preview.stage)} />
        <ArtifactInfoItem label={t("agent")} value={artifactAgentLabel(preview, t, agentLabels)} />
        <ArtifactInfoItem label={t("path")} value={preview.path} />
      </div>
    </div>
  );
}

function ArtifactInfoItem({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="artifact-info-item">
      <Text className="artifact-info-label" size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text className="artifact-info-value" size="sm" fw={700}>{value}</Text>
    </div>
  );
}

function artifactKindLabel(kind: string): string {
  const normalized = kind.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return ARTIFACT_DISPLAY_NAMES[normalized] ?? kind;
}

function artifactStageLabel(stage: string): string {
  return workflowStageLabel(stage);
}

function artifactAgentLabel(
  preview: StudioArtifactPreview,
  t: (key: StudioCopyKey) => string,
  agentLabels?: AgentDisplayNames,
): string {
  const agent = preview.agent?.trim();
  if (agent) {
    return agentDisplayName(agent, agentLabels);
  }
  return isRunLevelArtifact(preview) ? "运行级产物" : t("unknown");
}

function agentDisplayName(agent: string, agentLabels?: AgentDisplayNames): string {
  const label = agentLabels?.[agent]?.trim();
  return label && label.length > 0 ? label : agent;
}

function isRunLevelArtifact(preview: StudioArtifactPreview): boolean {
  return preview.stage === "run" || isAssignmentArtifact(preview);
}

function artifactTimelineMillis(artifact: StudioArtifactSummary, detail: StudioRunDetail): number | null {
  const timestamp = artifactTimelineTimestamp(artifact, detail);
  return timestamp ? timestampMillis(timestamp) : null;
}

function artifactTimelineTimestamp(
  artifact: StudioArtifactSummary,
  detail: StudioRunDetail,
): string | null {
  const event = artifactWrittenEvents(artifact, detail.events)
    .map((candidate) => ({
      event: candidate,
      time: timestampMillis(candidate.timestamp),
    }))
    .filter((candidate) => candidate.time !== null)
    .sort((left, right) => Number(left.time) - Number(right.time))[0]?.event;
  if (typeof event?.timestamp === "string") {
    return event.timestamp;
  }
  for (const field of ["written_at", "created_at", "timestamp", "updated_at"]) {
    const value = artifact[field];
    if (typeof value === "string" && timestampMillis(value) !== null) {
      return value;
    }
  }
  if (artifact.stage === "run") {
    return runCreatedTimestamp(detail);
  }
  if (isPromptArtifact(artifact)) {
    return stageEventTimestamp(artifact.stage, "stage.started", detail)
      ?? stageTimingTimestamp(artifact.stage, "started_at", detail);
  }
  return stageEventTimestamp(artifact.stage, "stage.completed", detail)
    ?? stageTimingTimestamp(artifact.stage, "completed_at", detail)
    ?? stageEventTimestamp(artifact.stage, "stage.started", detail)
    ?? stageTimingTimestamp(artifact.stage, "started_at", detail);
}

function artifactWrittenEvents(
  artifact: StudioArtifactSummary,
  events: StudioRunEvent[],
): StudioRunEvent[] {
  return events.filter((event) =>
    event.event === "artifact.written" &&
    (String(event.artifact ?? "") === artifact.name || String(event.path ?? "") === artifact.path)
  );
}

function runCreatedTimestamp(detail: StudioRunDetail): string | null {
  return firstEventTimestamp("run.created", detail.events) ?? detail.summary.created_at ?? null;
}

function firstEventTimestamp(eventName: string, events: StudioRunEvent[]): string | null {
  return events
    .filter((event) => event.event === eventName)
    .map((event) => event.timestamp)
    .filter((timestamp): timestamp is string => typeof timestamp === "string" && timestampMillis(timestamp) !== null)
    .sort((left, right) => Number(timestampMillis(left)) - Number(timestampMillis(right)))[0] ?? null;
}

function stageEventTimestamp(
  stage: string,
  eventName: string,
  detail: StudioRunDetail,
): string | null {
  return detail.events
    .filter((event) => event.event === eventName && event.stage === stage)
    .map((event) => event.timestamp)
    .filter((timestamp): timestamp is string => typeof timestamp === "string" && timestampMillis(timestamp) !== null)
    .sort((left, right) => Number(timestampMillis(left)) - Number(timestampMillis(right)))[0] ?? null;
}

function stageTimingTimestamp(
  stage: string,
  field: "started_at" | "completed_at" | "failed_at",
  detail: StudioRunDetail,
): string | null {
  const value = detail.summary.stage_timing.find((candidate) => candidate.stage === stage)?.[field];
  return value && timestampMillis(value) !== null ? value : null;
}

function isPromptArtifact(artifact: StudioArtifactSummary): boolean {
  return artifact.kind === "prompt" || artifact.path.startsWith("prompts/");
}

function artifactBaseName(value: string): string {
  const fileName = value.split(/[\\/]/).filter(Boolean).pop() ?? value;
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+[\s._-]*/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

function translateArtifactBaseName(value: string): string | null {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  const exact = ARTIFACT_DISPLAY_NAMES[normalized];
  if (exact) {
    return exact;
  }
  if (/[\u3400-\u9fff]/.test(value)) {
    return localizeMixedArtifactName(value);
  }
  return null;
}

function localizeMixedArtifactName(value: string): string {
  return value
    .replace(/\bScope\b/gi, "范围")
    .replace(/\bGate\b/gi, "门禁")
    .replace(/\bReview\b/gi, "审查")
    .replace(/\bRelease\b/gi, "发布")
    .replace(/\bSummary\b/gi, "摘要")
    .replace(/\bArchive\b/gi, "归档")
    .replace(/\bOutput\b/gi, "输出")
    .replace(/\bPrompt\b/gi, "提示词")
    .replace(/\bPlan\b/gi, "计划")
    .replace(/\s+/g, " ")
    .trim();
}

const ARTIFACT_DISPLAY_NAMES: Record<string, string> = {
  assignment: "任务分配",
  context: "上下文",
  decision: "决策",
  "execution plan": "执行计划",
  "execute plan": "执行计划",
  findings: "审查发现",
  "gate report": "门禁报告",
  handoff: "交接",
  output: "输出",
  plan: "计划",
  prompt: "提示词",
  request: "请求",
  "release summary": "发布摘要",
  "release verdict": "发布结论",
  review: "审查",
  "review output": "审查输出",
  "scope confirm": "范围确认",
  "scope confirmation": "范围确认",
  status: "运行状态",
  "technical plan": "技术方案",
  "technical solution": "技术方案",
  verification: "验证结果",
};

function stageStatusLabel(status: "pending" | "current" | "completed" | "failed", t: (key: StudioCopyKey) => string): string {
  return {
    completed: t("statusCompleted"),
    current: t("currentStatus"),
    failed: t("statusFailed"),
    pending: t("pendingStatus"),
  }[status];
}

function stageColor(status: "pending" | "current" | "completed" | "failed"): string {
  return {
    completed: "green",
    current: "blue",
    failed: "red",
    pending: "gray",
  }[status];
}

function timestampMillis(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

function PanelHeader({ title, meta }: { title: string; meta: string }): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      {meta ? <Text size="sm" c="dimmed" fw={700}>{meta}</Text> : null}
    </Group>
  );
}
