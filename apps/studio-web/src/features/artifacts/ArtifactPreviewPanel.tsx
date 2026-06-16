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
import type { ReactElement } from "react";
import type {
  StudioArtifactPreview,
  StudioArtifactSummary,
  StudioRunDetail,
  StudioRunEvent,
} from "../../api/runs.js";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import { formatLocalDateTime } from "../../app/time.js";
import {
  preferredWorkflowStage,
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
  onClose: () => void;
}

export function ArtifactPreviewPanel({
  detail,
  selectedArtifactName,
  previewState,
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
                        <Badge size="xs">{artifact.kind}</Badge>
                        <Badge size="xs" variant="light">{artifact.stage}</Badge>
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
            <ArtifactInfoBlock state={previewState} t={t} />
            <Title className="artifact-preview-title" order={3} size="h4" mt="md">
              {previewTitle(previewState, t)}
            </Title>
          </>
        ) : (
          <PanelHeader title={previewTitle(previewState, t)} meta="" />
        )}
        <Code block className="studio-code-block" mt={previewState.status === "ready" ? "sm" : "md"}>
          {previewContent(previewState, t)}
        </Code>
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
        <Stack gap={6}>
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
        <Stack gap="xs">
          <Group justify="space-between" align="center" gap="xs">
            <Text size="sm" fw={800}>{t("artifacts")}</Text>
            <Badge size="xs" variant="light">{artifacts.length}</Badge>
          </Group>
          {artifacts.length > 0 ? (
            <Stack className="artifact-sidebar-list" gap={8} aria-label={t("artifacts")}>
              {artifacts.map((artifact) => (
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
                    <Badge className="artifact-sidebar-item-status" size="xs" color="green" variant="light">{t("generated")}</Badge>
                  </Group>
                </Button>
              ))}
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
          {previewState.status === "ready" ? <ArtifactInfoBlock state={previewState} t={t} /> : null}
          <Code block className="studio-code-block">
            {previewContent(previewState, t)}
          </Code>
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

function ArtifactInfoBlock({
  state,
  t,
}: {
  state: ArtifactPreviewState;
  t: (key: StudioCopyKey) => string;
}): ReactElement | null {
  if (state.status !== "ready") {
    return null;
  }
  const { preview } = state;
  return (
    <div className="artifact-info-panel" data-studio-section="artifact-info">
      <Group justify="space-between" gap="xs" mb="xs">
        <Text size="sm" fw={800}>{t("artifactInfo")}</Text>
        {preview.truncated ? <Badge size="sm" color="yellow" variant="light">{t("truncated")}</Badge> : null}
      </Group>
      <div className="artifact-info-grid">
        <ArtifactInfoItem label={t("name")} value={artifactDisplayName(preview)} />
        <ArtifactInfoItem label={t("type")} value={preview.kind} />
        <ArtifactInfoItem label={t("stage")} value={preview.stage} />
        <ArtifactInfoItem label={t("agent")} value={preview.agent ?? t("unknown")} />
        <ArtifactInfoItem label={t("path")} value={preview.path} wide />
      </div>
    </div>
  );
}

function ArtifactInfoItem({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}): ReactElement {
  return (
    <div className={wide ? "artifact-info-item wide" : "artifact-info-item"}>
      <Text size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text className="artifact-info-value" size="sm" fw={700}>{value}</Text>
    </div>
  );
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
