import {
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useEffect, useState, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import {
  callErrorKindLabel,
  callStatusLabel,
  viewStateLabel,
} from "../../app/status-labels.js";
import { formatLocalDateTime, formatLocalTime } from "../../app/time.js";
import type {
  StudioCallDetail,
  StudioCallPreview,
  StudioCallSummary,
  StudioCallWarning,
} from "../../api/calls.js";
import { renderMarkdownBlocks } from "../artifacts/ArtifactPreviewPanel.js";

export type CallDetailState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; detail: StudioCallDetail }
  | { status: "error"; message: string };

export interface CallDetailViewProps {
  state: CallDetailState;
  runLabels?: Record<string, string>;
  agentLabels?: Record<string, string>;
}

export function CallDetailView({ state, runLabels, agentLabels }: CallDetailViewProps): ReactElement {
  const { t } = useStudioCopy();
  if (state.status === "ready") {
    return <ReadyCallDetail detail={state.detail} runLabels={runLabels} agentLabels={agentLabels} />;
  }
  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-call-detail" withBorder radius="md" p="lg">
      <PanelHeader title="Calls" meta={state.status === "error" ? viewStateLabel(state.status) : ""} />
      <Alert mt="md" color={state.status === "error" ? "red" : "gray"} title={state.status === "error" ? t("callDetailsFailed") : undefined} variant="light">
        {callDetailMessage(state, t)}
      </Alert>
    </Paper>
  );
}

function ReadyCallDetail({
  detail,
  runLabels,
  agentLabels,
}: {
  detail: StudioCallDetail;
  runLabels?: Record<string, string>;
  agentLabels?: Record<string, string>;
}): ReactElement {
  const { t } = useStudioCopy();
  const call = detail.call;
  const statusLabel = callStatusLabel(call.status);
  const artifacts = callArtifactItems(detail, t);
  const artifactKey = artifacts.map((artifact) => artifact.id).join(":");
  const [selectedArtifactId, setSelectedArtifactId] = useState<CallArtifactId | null>(
    () => preferredCallArtifactId(artifacts),
  );

  useEffect(() => {
    setSelectedArtifactId((current) =>
      current && artifacts.some((artifact) => artifact.id === current)
        ? current
        : preferredCallArtifactId(artifacts));
  }, [call.id, artifactKey]);

  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId)
    ?? artifacts.find((artifact) => artifact.id === preferredCallArtifactId(artifacts));
  return (
    <section className="call-detail-layout" data-studio-section="react-call-detail">
      <div className="call-workspace-layout" data-studio-section="call-workspace-layout">
        <Stack className="call-workspace-main" gap="md">
          <Tabs
            key={call.id}
            defaultValue="details"
            className="call-detail-tabs"
            data-studio-section="call-detail-tabs"
          >
            <Tabs.List aria-label={t("callsSubtitle")} grow>
              <Tabs.Tab value="details">{t("details")}</Tabs.Tab>
              <Tabs.Tab value="related">{t("related")}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="details" pt="md" keepMounted>
              <Paper className="studio-panel" data-studio-section="call-detail-summary-panel" withBorder radius="md" p="lg">
                <PanelHeader title={t("overview")} meta="" />
                <div className="call-detail-summary" data-studio-section="call-detail-summary">
                  <div className="run-summary-row">
                    <div className="run-summary-column" data-summary-column="left">
                      <CallMetric label={t("title")} value={call.title ?? t("unknown")} field="title" />
                      <CallMetric label={t("call")} value={call.id} field="call" />
                      <CallMetric label={t("purpose")} value={call.purpose} field="purpose" />
                      <CallMetric label={t("startedAt")} value={formatTimestamp(call.started_at)} field="startedAt" />
                      <CallMetric label={t("completedAt")} value={formatTimestamp(call.completed_at)} field="completedAt" />
                      <CallMetric label={t("duration")} value={formatDuration(call.duration_ms, t)} field="duration" />
                    </div>
                    <div className="run-summary-column" data-summary-column="right">
                      <CallMetric label={t("workspace")} value={call.workspace.label} field="workspace" />
                      <CallMetric label={t("status")} value={statusLabel} className={`status ${call.status}`} field="status" />
                      <CallMetric label={t("agent")} value={callAgentDisplayName(call.agent_id, agentLabels, t)} field="agent" />
                      <CallMetric label={t("adapter")} value={call.adapter} field="adapter" />
                      <CallMetric label={t("executionDirectory")} value={call.cwd} field="cwd" />
                    </div>
                  </div>
                </div>
              </Paper>
            </Tabs.Panel>
            <Tabs.Panel value="related" pt="md" keepMounted>
              <Paper className="studio-panel call-detail-related-panel" data-studio-section="call-detail-related" withBorder radius="md" p="lg">
                <PanelHeader title={t("related")} meta="" />
                <CallRelated call={call} runLabels={runLabels} />
              </Paper>
            </Tabs.Panel>
          </Tabs>
          <CallWarnings warnings={detail.warnings} />
          <CallEvidencePanel detail={detail} artifact={selectedArtifact} />
        </Stack>
        <CallArtifactSidebar
          artifacts={artifacts}
          selectedArtifactId={selectedArtifact?.id ?? null}
          onSelectArtifact={setSelectedArtifactId}
        />
      </div>
    </section>
  );
}

function CallMetric({
  label,
  value,
  className,
  field,
}: {
  label: string;
  value: string;
  className?: string;
  field: string;
}): ReactElement {
  return (
    <div className="run-summary-item call-detail-field" data-call-field={field}>
      <Text className="run-summary-label" component="span" size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text className={`run-summary-value wrap${className ? ` ${className}` : ""}`} component="span" size="xs" fw={800} title={value}>{value}</Text>
    </div>
  );
}

function CallWarnings({ warnings }: { warnings: StudioCallWarning[] }): ReactElement | null {
  const { t } = useStudioCopy();
  if (warnings.length === 0) {
    return null;
  }
  return (
    <Stack mt="md" gap="xs" aria-label={t("callWarnings")}>
      {warnings.map((warning) => (
        <Alert color="yellow" variant="light" key={`${warning.code}:${warning.path ?? warning.message}`}>
          <Text fw={800}>{warningLabel(warning, t)}</Text>
          <Text size="sm">{warning.message}</Text>
          {warning.path ? <Text size="xs" c="dimmed">{warning.path}</Text> : null}
        </Alert>
      ))}
    </Stack>
  );
}

function CallRelated({
  call,
  runLabels,
}: {
  call: StudioCallSummary;
  runLabels?: Record<string, string>;
}): ReactElement {
  const { t } = useStudioCopy();
  return (
    <div className="call-detail-related">
      <div className="run-summary-row call-related-row">
        <RelatedList title={t("runs")} values={call.related_run_ids} kind="run" labels={runLabels} />
        <RelatedList title={t("calls")} values={call.related_call_ids} kind="call" />
      </div>
    </div>
  );
}

function RelatedList({
  title,
  values,
  kind,
  labels,
}: {
  title: string;
  values: string[];
  kind: "run" | "call";
  labels?: Record<string, string>;
}): ReactElement {
  const { t } = useStudioCopy();
  return (
    <div className="run-summary-item call-related-item">
      <Text className="run-summary-label" component="span" size="xs" c="dimmed" fw={700}>{title}</Text>
      {values.length > 0 ? (
        <Stack className="call-related-values" gap={4}>
          {values.map((value) => (
            <div key={value}>
              <Anchor href={`#${kind}-${value}`}>{labels?.[value] ?? value}</Anchor>
            </div>
          ))}
        </Stack>
      ) : (
        <Text className="run-summary-value" component="span" size="xs" c="dimmed">{t("noRelatedItems")}</Text>
      )}
    </div>
  );
}

function CallPreviewPanel({
  anchorId,
  title,
  preview,
  emptyMessage,
}: {
  anchorId: string;
  title: string;
  preview: StudioCallPreview;
  emptyMessage: string;
}): ReactElement {
  const { t } = useStudioCopy();
  const content = preview.present ? stripAnsiEscapeSequences(preview.content) : emptyMessage;
  const meta = [
    preview.path,
    preview.truncated ? t("truncated") : "",
  ].filter(Boolean).join(" · ");
  return (
    <div id={anchorId} className="call-content-preview">
      <Group justify="space-between" align="flex-start" mb="sm">
        <Title order={3} size="h4">{title}</Title>
        <Text size="xs" c="dimmed">{meta}</Text>
      </Group>
      {preview.present && isMarkdownCallPreview(preview) ? (
        <div className="artifact-markdown call-artifact-markdown" data-studio-section="call-markdown-preview">
          {renderMarkdownBlocks(content)}
        </div>
      ) : (
        <Code block className="studio-code-block">{content}</Code>
      )}
    </div>
  );
}

function isMarkdownCallPreview(preview: StudioCallPreview): boolean {
  return /\.(?:md|markdown)$/i.test(preview.path ?? "");
}

type CallArtifactId = "prompt" | "output" | "stderr";

interface CallArtifactItem {
  id: CallArtifactId;
  title: string;
  path: string;
  hasContent: boolean;
  timestamp: string | null;
  preview: StudioCallPreview;
  emptyMessage: string;
}

function CallArtifactSidebar({
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
}: {
  artifacts: CallArtifactItem[];
  selectedArtifactId: CallArtifactId | null;
  onSelectArtifact: (artifactId: CallArtifactId) => void;
}): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Paper
      component="aside"
      className="studio-panel artifact-sidebar-panel call-artifact-sidebar-panel"
      data-studio-section="call-artifact-sidebar"
      withBorder
      radius="md"
      p="md"
    >
      <Stack gap="sm">
        <Group className="artifact-sidebar-list-heading" justify="space-between" align="center" gap="xs">
          <Text size="sm" fw={800}>{t("artifacts")}</Text>
          <Badge size="xs" variant="light">{artifacts.length} {t("artifactTotal")}</Badge>
        </Group>
        {artifacts.length > 0 ? (
          <Stack className="artifact-sidebar-list" gap={8} aria-label={t("artifacts")}>
            {artifacts.map((artifact) => (
              <Button
                className="artifact-sidebar-item call-artifact-sidebar-item"
                variant={artifact.id === selectedArtifactId ? "light" : "default"}
                color={artifact.id === selectedArtifactId ? "agentmesh" : "gray"}
                h="auto"
                p={0}
                key={artifact.id}
                data-call-artifact-sidebar-item={artifact.id}
                aria-current={artifact.id === selectedArtifactId ? "true" : undefined}
                onClick={() => onSelectArtifact(artifact.id)}
              >
                <Group className="artifact-sidebar-item-row" justify="space-between" gap="xs" wrap="nowrap" w="100%">
                  <Stack className="artifact-sidebar-item-main" gap={2} miw={0} align="flex-start">
                    <Text size="sm" fw={800}>{artifact.title}</Text>
                    <Text size="xs" c="dimmed" truncate="end" title={artifact.path}>{artifact.path}</Text>
                  </Stack>
                  <Stack className="call-artifact-sidebar-meta" gap={4} align="flex-end">
                    <Badge
                      className="call-artifact-sidebar-status"
                      size="xs"
                      variant="light"
                      color={artifact.hasContent ? "agentmesh" : "gray"}
                    >
                      {artifact.hasContent ? t("generated") : t("noContent")}
                    </Badge>
                    <Text
                      className="artifact-sidebar-item-time"
                      component="time"
                      dateTime={artifact.timestamp ?? undefined}
                      size="xs"
                      c="dimmed"
                      fw={700}
                      title={artifact.timestamp ? formatLocalDateTime(artifact.timestamp) : t("noTiming")}
                    >
                      {artifact.timestamp ? formatLocalTime(artifact.timestamp) : "--:--:--"}
                    </Text>
                  </Stack>
                </Group>
              </Button>
            ))}
          </Stack>
        ) : <Alert variant="light">{t("noArtifacts")}</Alert>}
      </Stack>
    </Paper>
  );
}

function callArtifactItems(
  detail: StudioCallDetail,
  t: (key: StudioCopyKey) => string,
): CallArtifactItem[] {
  const candidates: Array<{
    id: CallArtifactItem["id"];
    title: string;
    defaultPath: string;
    timestamp: string | null;
    preview: StudioCallPreview;
    emptyMessage: string;
  }> = [
    {
      id: "prompt",
      title: t("prompt"),
      defaultPath: "prompt.md",
      timestamp: detail.call.created_at,
      preview: detail.prompt,
      emptyMessage: t("noPromptRecorded"),
    },
    {
      id: "output",
      title: t("output"),
      defaultPath: "output.md",
      timestamp: detail.call.completed_at,
      preview: detail.output,
      emptyMessage: t("noOutputFile"),
    },
    {
      id: "stderr",
      title: t("stderr"),
      defaultPath: "stderr.txt",
      timestamp: detail.call.completed_at,
      preview: detail.stderr,
      emptyMessage: t("noStderrRecorded"),
    },
  ];
  return candidates.map(({ id, title, defaultPath, timestamp, preview, emptyMessage }) => ({
    id,
    title,
    path: preview.path ?? defaultPath,
    hasContent: preview.present && preview.content.length > 0,
    timestamp,
    preview,
    emptyMessage,
  }));
}

function preferredCallArtifactId(artifacts: CallArtifactItem[]): CallArtifactId | null {
  for (const id of ["output", "prompt", "stderr"] as const) {
    if (artifacts.some((artifact) => artifact.id === id && artifact.hasContent)) {
      return id;
    }
  }
  return artifacts[0]?.id ?? null;
}

const ANSI_ESCAPE_SEQUENCE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function stripAnsiEscapeSequences(value: string): string {
  return value.replace(ANSI_ESCAPE_SEQUENCE, "");
}

function CallEvidencePanel({
  detail,
  artifact,
}: {
  detail: StudioCallDetail;
  artifact: CallArtifactItem | undefined;
}): ReactElement {
  const { t } = useStudioCopy();
  const call = detail.call;
  const failed = isFailedCall(call);
  const exit = call.exit_code === null ? `exit=${t("unknown")}` : `exit=${call.exit_code}`;
  const hasStderr = detail.stderr.present && detail.stderr.content.trim().length > 0;
  const errorContent = hasStderr
    ? stripAnsiEscapeSequences(detail.stderr.content)
    : call.error_summary ?? t("noRelatedItems");
  return (
    <Paper
      className={`studio-panel call-detail-evidence-panel${failed ? " call-detail-failure-panel" : ""}`}
      data-studio-section="call-detail-evidence"
      data-selected-call-artifact={artifact?.id}
      withBorder
      radius="md"
      p="lg"
    >
      <PanelHeader title={t("content")} meta={failed ? `${callErrorKindLabel(call.error_kind)} · ${exit}` : ""} />
      {failed && !hasStderr ? <Code block mt="md" className="studio-code-block">{errorContent}</Code> : null}
      {artifact ? (
        <CallPreviewPanel
          anchorId={`call-content-${artifact.id}`}
          title={artifact.title}
          preview={artifact.preview}
          emptyMessage={artifact.emptyMessage}
        />
      ) : <Alert mt="md" variant="light">{t("noArtifacts")}</Alert>}
    </Paper>
  );
}

function isFailedCall(call: StudioCallSummary): boolean {
  return call.error_kind !== "none" || Boolean(call.error_summary) || (
    call.exit_code !== null && call.exit_code !== 0
  );
}

function warningLabel(warning: StudioCallWarning, t: (key: StudioCopyKey) => string): string {
  if (warning.code === "unsupported_schema") {
    return "Unsupported schema";
  }
  if (warning.code === "dangling_output_path") {
    return t("danglingOutput");
  }
  return warning.code;
}

function callDetailMessage(
  state: Exclude<CallDetailState, { status: "ready" }>,
  t: (key: StudioCopyKey) => string,
): string {
  if (state.status === "loading") {
    return t("loadingCallDetails");
  }
  if (state.status === "error") {
    return state.message;
  }
  return t("selectCall");
}

function formatTimestamp(value: string | null | undefined): string {
  return formatLocalDateTime(value);
}

function formatDuration(
  durationMs: number | null,
  t: (key: StudioCopyKey) => string,
): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return t("noTiming");
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}分${String(seconds).padStart(2, "0")}秒`;
  }
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}小时${String(minutes).padStart(2, "0")}分${String(seconds).padStart(2, "0")}秒`;
}

function callAgentDisplayName(
  agentId: string | null,
  agentLabels: Record<string, string> | undefined,
  t: (key: StudioCopyKey) => string,
): string {
  if (!agentId) {
    return t("unknown");
  }
  return agentLabels?.[agentId]?.trim() || agentId;
}

function PanelHeader({ title, meta }: { title: string; meta: string }): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      {meta ? <Text size="sm" c="dimmed" fw={700}>{meta}</Text> : null}
    </Group>
  );
}
