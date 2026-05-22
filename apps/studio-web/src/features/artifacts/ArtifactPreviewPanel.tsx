import {
  Alert,
  Badge,
  Button,
  Code,
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
        <PanelHeader title={t("artifacts")} meta={`共 ${artifacts.length} 个`} />
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
                      <Text size="sm" fw={800} truncate="end">{artifact.name}</Text>
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

function previewTitle(state: ArtifactPreviewState, t: (key: StudioCopyKey) => string): string {
  if (state.status === "ready") {
    return `${t("preview")}: ${state.preview.name}`;
  }
  if (state.status === "loading") {
    return `${t("preview")}: ${state.artifactName}`;
  }
  if (state.status === "error") {
    return `${t("preview")}: ${state.artifactName}`;
  }
  return t("preview");
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
        <ArtifactInfoItem label={t("name")} value={preview.name} />
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
