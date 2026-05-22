import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import { formatLocalDateTime } from "../../app/time.js";
import type {
  StudioRunDetail,
  StudioRunDetailSummary,
  StudioStageTimingSummary,
} from "../../api/runs.js";

export type RunOverviewState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; detail: StudioRunDetail }
  | { status: "error"; message: string };

export type WorkflowStageStatus = "pending" | "current" | "completed" | "failed";

export interface RunOverviewProps {
  state: RunOverviewState;
  view?: "all" | "details" | "summary" | "stages" | "diagnostics";
}

export function RunOverview({ state, view = "all" }: RunOverviewProps): ReactElement {
  const { t } = useStudioCopy();
  if (state.status === "ready") {
    return <ReadyRunOverview detail={state.detail} view={view} />;
  }
  const message = runOverviewMessage(state, t);
  return (
    <Stack data-studio-section="react-run-overview" gap="md">
      {shouldRenderRunPanel(view, "stages") ? (
        <Paper className="studio-panel" data-studio-section="workflow-flow" withBorder radius="md" p="lg">
          <PanelHeader title={t("workflowFlow")} meta={state.status === "error" ? "Error" : ""} />
          <Alert mt="md" color={state.status === "error" ? "red" : "gray"} variant="light">
            {message}
          </Alert>
        </Paper>
      ) : null}
      {shouldRenderRunPanel(view, "summary") ? (
        <Paper className="studio-panel" data-studio-section="current-run-overview" withBorder radius="md" p="lg">
          <Alert color={state.status === "error" ? "red" : "gray"} title={state.status === "error" ? t("runDetailsFailed") : undefined} variant="light">
            {message}
          </Alert>
        </Paper>
      ) : null}
      {shouldRenderRunPanel(view, "diagnostics") ? (
        <Paper className="studio-panel" data-studio-section="run-diagnostics" withBorder radius="md" p="lg">
          <PanelHeader title={t("runDiagnostics")} meta={state.status === "error" ? "Error" : ""} />
          <Alert mt="md" color={state.status === "error" ? "red" : "gray"} variant="light">
            {message}
          </Alert>
        </Paper>
      ) : null}
    </Stack>
  );
}

function ReadyRunOverview({
  detail,
  view,
}: {
  detail: StudioRunDetail;
  view: NonNullable<RunOverviewProps["view"]>;
}): ReactElement {
  const { t } = useStudioCopy();
  const summary = detail.summary;
  const stages = useMemo(() => workflowStageIds(summary), [summary]);
  const preferredStage = useMemo(() => preferredWorkflowStage(summary), [summary]);
  const [selectedStage, setSelectedStage] = useState<string | null>(preferredStage);

  useEffect(() => {
    setSelectedStage((current) => current && stages.includes(current) ? current : preferredStage);
  }, [preferredStage, stages]);

  const activeStage = selectedStage && stages.includes(selectedStage) ? selectedStage : preferredStage;
  const activeStatus = activeStage ? workflowStageStatus(summary, activeStage) : undefined;

  return (
    <Stack data-studio-section="react-run-overview" gap="md">
      {shouldRenderRunPanel(view, "stages") ? (
        <Paper className="studio-panel" data-studio-section="workflow-flow" withBorder radius="md" p="lg">
          <PanelHeader
            title={t("workflowFlow")}
            meta={activeStage && activeStatus ? `${activeStage} · ${stageStatusLabel(activeStatus, t)}` : ""}
          />
          <div className="workflow-nodes" aria-label={t("workflowNodes")}>
            {stages.length > 0 ? stages.map((stage, index) => (
              <div className="workflow-step" key={stage}>
                <WorkflowStageButton
                  summary={summary}
                  stage={stage}
                  selected={stage === activeStage}
                  onSelectStage={setSelectedStage}
                />
                {index < stages.length - 1 ? (
                  <span className="workflow-connector" aria-hidden="true" />
                ) : null}
              </div>
            )) : <Alert color="gray" variant="light">{t("noWorkflow")}</Alert>}
          </div>
          {activeStage && activeStatus ? (
            <WorkflowStageDetail summary={summary} stage={activeStage} status={activeStatus} />
          ) : null}
        </Paper>
      ) : null}
      {shouldRenderRunPanel(view, "summary") ? (
        <RunSummaryPanel detail={detail} stages={stages} />
      ) : null}
      {shouldRenderRunPanel(view, "diagnostics") ? (
        <RunDiagnosticsPanel detail={detail} stages={stages} />
      ) : null}
    </Stack>
  );
}

function shouldRenderRunPanel(
  view: NonNullable<RunOverviewProps["view"]>,
  panel: "summary" | "stages" | "diagnostics",
): boolean {
  return view === "all" || view === panel || (view === "details" && (panel === "summary" || panel === "stages"));
}

function RunSummaryPanel({
  detail,
  stages,
}: {
  detail: StudioRunDetail;
  stages: string[];
}): ReactElement {
  const { t } = useStudioCopy();
  const summary = detail.summary;
  return (
    <Paper className="studio-panel" data-studio-section="current-run-overview" withBorder radius="md" p="lg">
      <PanelHeader title={t("overview")} meta={summary.status} />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm" mt="md">
        <OverviewMetric label={t("run")} value={summary.run_id} />
        <OverviewMetric label={t("status")} value={summary.status} className={`status ${summary.status}`} />
        <OverviewMetric label={t("workflow")} value={summary.workflow ?? t("unknown")} />
        <OverviewMetric label={t("stage")} value={`${summary.completed_stages.length}/${stages.length}`} />
        <OverviewMetric label={t("latestEvent")} value={summary.latest_event ?? t("latestEventFallback")} />
        <OverviewMetric label={t("createdAt")} value={formatTimestamp(summary.created_at)} />
        <OverviewMetric label={t("updatedAt")} value={formatTimestamp(summary.updated_at)} />
      </SimpleGrid>
    </Paper>
  );
}

function RunDiagnosticsPanel({
  detail,
  stages,
}: {
  detail: StudioRunDetail;
  stages: string[];
}): ReactElement {
  const { t } = useStudioCopy();
  const summary = detail.summary;
  const skippedChecks = detail.review_release.skipped_checks;
  const residualRisk = detail.review_release.residual_risk;
  return (
    <Paper className="studio-panel" data-studio-section="run-diagnostics" withBorder radius="md" p="lg">
      <PanelHeader title={t("runDiagnostics")} meta={summary.run_dir ?? ""} />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm" mt="md">
        <OverviewMetric label={t("runDirectory")} value={summary.run_dir ?? t("unknown")} />
        <OverviewMetric label={t("eventCount")} value={String(detail.events_page?.total ?? detail.events.length)} />
        <OverviewMetric label={t("artifactCount")} value={String(detail.artifacts.length)} />
        <OverviewMetric label={t("stage")} value={`${summary.completed_stages.length}/${stages.length}`} />
        <OverviewMetric label={t("contextPolicy")} value={summary.resolved_context_policy ? t("policyConfigured") : t("policyNotRecorded")} />
        <OverviewMetric label={t("executionPolicy")} value={summary.resolved_execution_policy ? t("policyConfigured") : t("policyNotRecorded")} />
        <OverviewMetric label={t("skippedChecks")} value={String(skippedChecks.length)} />
        <OverviewMetric label={t("residualRisk")} value={String(residualRisk.length)} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" mt="md">
        <DiagnosticList title={t("skippedChecks")} items={skippedChecks} emptyLabel={t("noRelatedItems")} />
        <DiagnosticList title={t("residualRisk")} items={residualRisk} emptyLabel={t("noRelatedItems")} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" mt="md">
        <DiagnosticPolicy title={t("contextPolicy")} value={summary.resolved_context_policy} emptyLabel={t("policyNotRecorded")} />
        <DiagnosticPolicy title={t("executionPolicy")} value={summary.resolved_execution_policy} emptyLabel={t("policyNotRecorded")} />
      </SimpleGrid>
    </Paper>
  );
}

function DiagnosticList({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}): ReactElement {
  return (
    <Card withBorder radius="md" p="md">
      <Text fw={800} mb="xs">{title}</Text>
      {items.length > 0 ? (
        <List size="sm">
          {items.map((item) => <List.Item key={item}>{item}</List.Item>)}
        </List>
      ) : (
        <Text size="sm" c="dimmed">{emptyLabel}</Text>
      )}
    </Card>
  );
}

function DiagnosticPolicy({
  title,
  value,
  emptyLabel,
}: {
  title: string;
  value: Record<string, unknown> | undefined;
  emptyLabel: string;
}): ReactElement {
  return (
    <Card withBorder radius="md" p="md">
      <Text fw={800} mb="xs">{title}</Text>
      {value ? (
        <Code block className="studio-code-block">{JSON.stringify(value, null, 2)}</Code>
      ) : (
        <Text size="sm" c="dimmed">{emptyLabel}</Text>
      )}
    </Card>
  );
}

function WorkflowStageButton({
  summary,
  stage,
  selected,
  onSelectStage,
}: {
  summary: StudioRunDetailSummary;
  stage: string;
  selected: boolean;
  onSelectStage: (stage: string) => void;
}): ReactElement {
  const { t } = useStudioCopy();
  const status = workflowStageStatus(summary, stage);
  const timing = workflowStageTiming(summary, stage);
  const duration = formatDuration(timing?.duration_ms) || t("unknown");
  const attemptCount = formatAttemptCount(timing?.attempt_count, t);
  const timingSummary = `${duration} · ${attemptCount}`;
  return (
    <Button
      className={`workflow-stage-card ${status}${selected ? " selected" : ""}`}
      variant={selected ? "light" : "default"}
      color={selected ? "agentmesh" : "gray"}
      h="auto"
      p="xs"
      data-workflow-stage={stage}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelectStage(stage)}
    >
      <Stack gap={6} align="center" w="100%">
        <Text size="sm" fw={800} ta="center" w="100%" truncate="end">{stage}</Text>
        <Badge size="xs" color={stageColor(status)}>{stageStatusLabel(status, t)}</Badge>
        <Text className="workflow-node-metric" data-studio-section="workflow-flow-node-metrics" size="xs" c="dimmed" fw={700}>
          {timingSummary}
        </Text>
      </Stack>
    </Button>
  );
}

function WorkflowStageDetail({
  summary,
  stage,
  status,
}: {
  summary: StudioRunDetailSummary;
  stage: string;
  status: WorkflowStageStatus;
}): ReactElement {
  const { t } = useStudioCopy();
  const timing = workflowStageTiming(summary, stage);
  return (
    <Card className="workflow-stage-detail" withBorder radius="md" mt="md" p="md">
      <Group justify="space-between" mb="sm">
        <Text fw={800}>{stage}</Text>
        <Badge color={stageColor(status)}>{stageStatusLabel(status, t)}</Badge>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
        <OverviewMetric label={t("stage")} value={stage} />
        <OverviewMetric label={t("type")} value={workflowStageType(summary, stage)} />
        <OverviewMetric label={t("status")} value={stageStatusLabel(status, t)} />
        <OverviewMetric label={t("startedAt")} value={formatTimestamp(timing?.started_at)} />
        <OverviewMetric label={timing?.failed_at ? t("statusFailed") : t("completedAt")} value={formatTimestamp(timing?.failed_at ?? timing?.completed_at)} />
        <OverviewMetric label={t("duration")} value={formatDuration(timing?.duration_ms) || t("unknown")} />
        <OverviewMetric label={t("attemptCount")} value={formatAttemptCount(timing?.attempt_count, t)} />
        <OverviewMetric label={t("exit")} value={timing?.exit_code === undefined || timing.exit_code === null ? t("unknown") : `exit=${timing.exit_code}`} />
      </SimpleGrid>
    </Card>
  );
}

function OverviewMetric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}): ReactElement {
  return (
    <Card className="studio-metric" withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text fw={800} className={className}>{value}</Text>
    </Card>
  );
}

export function workflowStageIds(summary: StudioRunDetailSummary): string[] {
  const nodeIds = Array.isArray(summary.stage_nodes)
    ? summary.stage_nodes
      .map((node) => node.id)
      .filter((id) => typeof id === "string" && id.length > 0)
    : [];
  return nodeIds.length > 0 ? nodeIds : summary.stages;
}

export function preferredWorkflowStage(summary: StudioRunDetailSummary): string | null {
  const stages = workflowStageIds(summary);
  if (summary.current_stage && stages.includes(summary.current_stage)) {
    return summary.current_stage;
  }
  const completed = new Set(summary.completed_stages);
  return stages.find((stage) => !completed.has(stage)) ?? stages[stages.length - 1] ?? null;
}

export function workflowStageStatus(
  summary: StudioRunDetailSummary,
  stage: string,
): WorkflowStageStatus {
  const timing = workflowStageTiming(summary, stage);
  if (timing?.failed_at) {
    return "failed";
  }
  if (summary.completed_stages.includes(stage) || timing?.completed_at) {
    return "completed";
  }
  return preferredWorkflowStage(summary) === stage ? "current" : "pending";
}

function workflowStageTiming(
  summary: StudioRunDetailSummary,
  stage: string,
): StudioStageTimingSummary | undefined {
  return summary.stage_timing.find((timing) => timing.stage === stage);
}

function workflowStageType(summary: StudioRunDetailSummary, stage: string): string {
  return summary.stage_nodes?.find((node) => node.id === stage)?.type ?? stage;
}

function stageStatusLabel(status: WorkflowStageStatus, t: (key: StudioCopyKey) => string): string {
  return {
    completed: t("statusCompleted"),
    current: t("currentStatus"),
    failed: t("statusFailed"),
    pending: t("pendingStatus"),
  }[status];
}

function stageColor(status: WorkflowStageStatus): string {
  return {
    completed: "green",
    current: "blue",
    failed: "red",
    pending: "gray",
  }[status];
}

function PanelHeader({ title, meta }: { title: string; meta: string }): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      {meta ? <Text size="sm" c="dimmed" fw={700}>{meta}</Text> : null}
    </Group>
  );
}

function stageTimingSummary(
  timing: StudioStageTimingSummary | undefined,
  t: (key: StudioCopyKey) => string,
): string {
  return [
    formatDuration(timing?.duration_ms),
    timing?.attempt_count === undefined ? "" : formatAttemptCount(timing.attempt_count, t),
    timing?.exit_code === undefined || timing.exit_code === null ? "" : `exit=${timing.exit_code}`,
  ].filter(Boolean).join(" · ");
}

function stageTimestampSummary(timing: StudioStageTimingSummary | undefined): string {
  return [
    formatTimestamp(timing?.started_at),
    formatTimestamp(timing?.failed_at ?? timing?.completed_at),
  ].filter((value) => value !== "unknown").join(" → ");
}

function runOverviewMessage(
  state: Exclude<RunOverviewState, { status: "ready" }>,
  t: (key: StudioCopyKey) => string,
): string {
  if (state.status === "loading") {
    return t("loadingRunDetails");
  }
  if (state.status === "error") {
    return state.message;
  }
  return t("selectRun");
}

function formatTimestamp(value: string | undefined): string {
  return formatLocalDateTime(value);
}

function formatDuration(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatAttemptCount(value: number | undefined, t: (key: StudioCopyKey) => string): string {
  return value === undefined ? t("unknown") : `${value} ${t("attemptUnit")}`;
}
