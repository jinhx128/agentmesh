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
import { workflowStageLabel } from "../../app/stages.js";
import { formatLocalDateTime, formatLocalTime } from "../../app/time.js";
import type {
  StudioRunDetail,
  StudioRunDetailSummary,
  StudioReviewerSessionSummary,
  StudioStageTimingSummary,
} from "../../api/runs.js";
import { ReviewReleaseStageEvidence } from "../review-release/ReviewReleaseView.js";

export type RunOverviewState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; detail: StudioRunDetail }
  | { status: "error"; message: string };

export type WorkflowStageStatus = "pending" | "current" | "completed" | "failed";
export type AgentDisplayNames = Record<string, string>;
export type WorkflowDisplayNames = Record<string, string>;
export { workflowStageLabel };

export interface RunOverviewProps {
  state: RunOverviewState;
  view?: "all" | "details" | "summary" | "stages" | "diagnostics";
  agentLabels?: AgentDisplayNames;
  workflowLabels?: WorkflowDisplayNames;
  onCloseReviewerSession?: (sessionRef: string) => Promise<void>;
  onPurgeExpiredReviewerSessions?: () => Promise<void>;
}

export function RunOverview({
  state,
  view = "all",
  agentLabels,
  workflowLabels,
  onCloseReviewerSession,
  onPurgeExpiredReviewerSessions,
}: RunOverviewProps): ReactElement {
  const { t } = useStudioCopy();
  if (state.status === "ready") {
    return (
      <ReadyRunOverview
        detail={state.detail}
        view={view}
        agentLabels={agentLabels}
        workflowLabels={workflowLabels}
        onCloseReviewerSession={onCloseReviewerSession}
        onPurgeExpiredReviewerSessions={onPurgeExpiredReviewerSessions}
      />
    );
  }
  const message = runOverviewMessage(state, t);
  return (
    <Stack data-studio-section="react-run-overview" gap="md">
      {shouldRenderRunPanel(view, "summary") ? (
        <Paper className="studio-panel" data-studio-section="current-run-overview" withBorder radius="md" p="lg">
          <Alert color={state.status === "error" ? "red" : "gray"} title={state.status === "error" ? t("runDetailsFailed") : undefined} variant="light">
            {message}
          </Alert>
        </Paper>
      ) : null}
      {shouldRenderRunPanel(view, "stages") ? (
        <Paper className="studio-panel" data-studio-section="workflow-flow" withBorder radius="md" p="lg">
          <PanelHeader title={t("workflowFlow")} meta={state.status === "error" ? "Error" : ""} />
          <Alert mt="md" color={state.status === "error" ? "red" : "gray"} variant="light">
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
  agentLabels,
  workflowLabels,
  onCloseReviewerSession,
  onPurgeExpiredReviewerSessions,
}: {
  detail: StudioRunDetail;
  view: NonNullable<RunOverviewProps["view"]>;
  agentLabels?: AgentDisplayNames;
  workflowLabels?: WorkflowDisplayNames;
  onCloseReviewerSession?: (sessionRef: string) => Promise<void>;
  onPurgeExpiredReviewerSessions?: () => Promise<void>;
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
      {shouldRenderRunPanel(view, "summary") ? (
        <>
          <RunSummaryPanel detail={detail} stages={stages} workflowLabels={workflowLabels} />
          <ReviewerSessionsPanel
            sessions={detail.summary.reviewer_sessions ?? []}
            agentLabels={agentLabels}
            onClose={onCloseReviewerSession}
            onPurgeExpired={onPurgeExpiredReviewerSessions}
          />
        </>
      ) : null}
      {shouldRenderRunPanel(view, "stages") ? (
        <Paper className="studio-panel" data-studio-section="workflow-flow" withBorder radius="md" p="lg">
          <PanelHeader
            title={t("workflowFlow")}
            meta={activeStage && activeStatus ? `${workflowStageLabel(activeStage)} · ${stageStatusLabel(activeStatus, t)}` : ""}
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
            <>
              <WorkflowStageDetail
                detail={detail}
                stage={activeStage}
                status={activeStatus}
                agentLabels={agentLabels}
              />
              <ReviewReleaseStageEvidence
                view={detail.review_release}
                stageType={workflowStageType(summary, activeStage)}
              />
            </>
          ) : null}
        </Paper>
      ) : null}
      {shouldRenderRunPanel(view, "diagnostics") ? (
        <RunDiagnosticsPanel detail={detail} stages={stages} />
      ) : null}
    </Stack>
  );
}

function ReviewerSessionsPanel({
  sessions,
  agentLabels,
  onClose,
  onPurgeExpired,
}: {
  sessions: StudioReviewerSessionSummary[];
  agentLabels?: AgentDisplayNames;
  onClose?: (sessionRef: string) => Promise<void>;
  onPurgeExpired?: () => Promise<void>;
}): ReactElement {
  const { t } = useStudioCopy();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: string, operation: (() => Promise<void>) | undefined): Promise<void> {
    if (!operation) {
      return;
    }
    setPendingAction(action);
    setActionError(null);
    try {
      await operation();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Paper className="studio-panel" data-studio-section="reviewer-sessions" withBorder radius="md" p="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Title order={2} size="h3">{t("reviewerSessions")}</Title>
        <Button
          size="xs"
          variant="light"
          disabled={!onPurgeExpired || pendingAction !== null}
          loading={pendingAction === "purge"}
          onClick={() => void runAction("purge", onPurgeExpired)}
        >
          {t("purgeExpiredReviewerSessions")}
        </Button>
      </Group>
      {actionError ? <Alert mt="md" color="red" variant="light">{actionError}</Alert> : null}
      <Stack mt="md" gap="sm">
        {sessions.length > 0 ? sessions.map((session) => (
          <Card key={session.session_ref} data-reviewer-session={session.session_ref} withBorder radius="md" p="md">
            <Group justify="space-between" align="flex-start" gap="md">
              <Stack gap={2}>
                <Text fw={800}>{agentDisplayName(session.agent_id, agentLabels)}</Text>
                <Text size="xs" c="dimmed">{session.session_ref}</Text>
              </Stack>
              <Button
                size="xs"
                color="red"
                variant="light"
                disabled={!onClose || pendingAction !== null}
                loading={pendingAction === session.session_ref}
                onClick={() => void runAction(
                  session.session_ref,
                  onClose ? () => onClose(session.session_ref) : undefined,
                )}
              >
                {t("closeReviewerSession")}
              </Button>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" mt="md">
              <OverviewMetric label={t("host")} value={reviewerSessionHostLabel(session.host_kind)} />
              <OverviewMetric label={t("sessionMode")} value={session.mode} />
              <OverviewMetric label={t("hermetic")} value={session.hermetic ? t("yes") : t("no")} />
              <OverviewMetric label={t("lastUsedAt")} value={formatTimestamp(session.last_used_at)} />
              <OverviewMetric label={t("expiresAt")} value={formatTimestamp(session.expires_at)} />
            </SimpleGrid>
          </Card>
        )) : <Alert color="gray" variant="light">{t("noReviewerSessions")}</Alert>}
      </Stack>
    </Paper>
  );
}

function reviewerSessionHostLabel(hostKind: string): string {
  return {
    codex: "Codex",
    cursor: "Cursor",
    "claude-code": "Claude Code",
    antigravity: "Antigravity",
    opencode: "OpenCode",
    "studio-desktop": "Studio Desktop",
    "headless-cli": "Headless CLI",
  }[hostKind] ?? hostKind;
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
  workflowLabels,
}: {
  detail: StudioRunDetail;
  stages: string[];
  workflowLabels?: WorkflowDisplayNames;
}): ReactElement {
  const { t } = useStudioCopy();
  const summary = detail.summary;
  const summaryItems = [
    { field: "workspace", label: t("workspace"), value: summary.workspace.label },
    { field: "status", label: t("status"), value: summary.status },
    { field: "run", label: t("run"), value: summary.run_id },
    { field: "workflow", label: t("workflow"), value: workflowDisplayName(summary.workflow, workflowLabels, t) },
    { field: "stage", label: t("stage"), value: `${summary.completed_stages.length}/${stages.length}` },
    { field: "latestEvent", label: t("latestEvent"), value: summary.latest_event ?? t("latestEventFallback") },
    { field: "createdAt", label: t("createdAt"), value: formatTimestamp(summary.created_at) },
    { field: "updatedAt", label: t("updatedAt"), value: formatTimestamp(summary.updated_at) },
  ];
  return (
    <Paper className="studio-panel" data-studio-section="current-run-overview" withBorder radius="md" p="lg">
      <PanelHeader title={t("overview")} meta={summary.status} />
      <div className="run-summary-row" data-studio-section="run-summary-row">
        {summaryItems.map((item) => (
          <CompactDetailItem field={item.field} key={item.field} label={item.label} value={item.value} />
        ))}
      </div>
    </Paper>
  );
}

function CompactDetailItem({
  field,
  label,
  value,
  fieldKind = "summary",
}: {
  field: string;
  label: string;
  value: string;
  fieldKind?: "summary" | "stage";
}): ReactElement {
  const fieldAttribute = fieldKind === "stage"
    ? { "data-stage-field": field }
    : { "data-summary-field": field };
  const wrapValue = fieldKind === "stage" && field === "agent";
  return (
    <div className="run-summary-item" {...fieldAttribute}>
      <Text className="run-summary-label" component="span" size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text
        className={wrapValue ? "run-summary-value wrap" : "run-summary-value"}
        component="span"
        size="xs"
        fw={800}
        truncate={wrapValue ? undefined : "end"}
        title={value}
      >
        {value}
      </Text>
    </div>
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
  const timeSummary = workflowStageNodeTimeLabel(summary, stage, t);
  const stageLabel = workflowStageLabel(stage);
  return (
    <Button
      className={`workflow-stage-card ${status}${selected ? " selected" : ""}`}
      variant={selected ? "light" : "default"}
      color={selected ? "agentmesh" : "gray"}
      h="auto"
      p={6}
      data-workflow-stage={stage}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelectStage(stage)}
    >
      <Stack gap={3} align="center" w="100%">
        <Text size="xs" fw={800} ta="center" w="100%" truncate="end" title={stageLabel}>{stageLabel}</Text>
        <Badge size="xs" color={stageColor(status)}>{stageStatusLabel(status, t)}</Badge>
        <Text className="workflow-node-metric" data-studio-section="workflow-flow-node-metrics" size="xs" c="dimmed" fw={700}>
          {timingSummary}
        </Text>
        <Text className="workflow-node-time" data-studio-section="workflow-flow-node-time" size="xs" c="dimmed" fw={700} truncate="end">
          {timeSummary}
        </Text>
      </Stack>
    </Button>
  );
}

function WorkflowStageDetail({
  detail,
  stage,
  status,
  agentLabels,
}: {
  detail: StudioRunDetail;
  stage: string;
  status: WorkflowStageStatus;
  agentLabels?: AgentDisplayNames;
}): ReactElement {
  const { t } = useStudioCopy();
  const summary = detail.summary;
  const stageType = workflowStageType(summary, stage);
  const stageLabel = workflowStageLabel(stage);
  const stageTypeLabel = workflowStageLabel(stageType);
  const timing = workflowStageTiming(summary, stage);
  const agentLabel = workflowStageAgentLabel(summary, stage, t, agentLabels);
  const exitLabel = workflowStageExitLabel(summary, stage, t);
  const stageItems = [
    { field: "stage", label: t("stage"), value: stageLabel },
    { field: "status", label: t("status"), value: stageStatusLabel(status, t) },
    { field: "type", label: t("type"), value: stageTypeLabel },
    { field: "agent", label: t("agent"), value: agentLabel },
    { field: "startedAt", label: t("startedAt"), value: formatTimestamp(timing?.started_at) },
    { field: timing?.failed_at ? "failedAt" : "completedAt", label: timing?.failed_at ? t("statusFailed") : t("completedAt"), value: formatTimestamp(timing?.failed_at ?? timing?.completed_at) },
    { field: "duration", label: t("duration"), value: formatDuration(timing?.duration_ms) || t("unknown") },
    { field: "attemptCount", label: t("attemptCount"), value: formatAttemptCount(timing?.attempt_count, t) },
    { field: "exit", label: t("exit"), value: exitLabel },
  ];
  return (
    <Card className="workflow-stage-detail" data-studio-section="workflow-stage-detail" withBorder radius="md" p="md">
      <Group justify="space-between">
        <Text fw={800}>{stageLabel}</Text>
        <Badge color={stageColor(status)}>{stageStatusLabel(status, t)}</Badge>
      </Group>
      <div className="run-summary-row workflow-stage-summary-row" data-studio-section="workflow-stage-summary-row">
        {stageItems.map((item) => (
          <CompactDetailItem field={item.field} fieldKind="stage" key={item.field} label={item.label} value={item.value} />
        ))}
      </div>
    </Card>
  );
}

function OverviewMetric({
  label,
  value,
  className,
  lineClamp,
}: {
  label: string;
  value: string;
  className?: string;
  lineClamp?: number;
}): ReactElement {
  return (
    <Card className="studio-metric" withBorder radius="md" p="sm">
      <Text size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text fw={800} className={className} lineClamp={lineClamp} title={value}>{value}</Text>
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

function workflowStageInvocations(summary: StudioRunDetailSummary, stage: string) {
  return summary.stage_invocations?.[stage] ?? [];
}

function workflowStageAttempts(summary: StudioRunDetailSummary, stage: string) {
  return summary.stage_attempts?.[stage] ?? [];
}

function workflowStageAgents(summary: StudioRunDetailSummary, stage: string): string[] {
  const agents = [
    ...workflowStageInvocations(summary, stage)
      .map((invocation) => typeof invocation.agent === "string" ? invocation.agent : undefined),
    ...(summary.stage_assignments?.[stage] ?? []),
    ...workflowStageAttempts(summary, stage)
      .flatMap((attempt) => [attempt.actual_agent, attempt.requested_agent, attempt.primary_agent]),
  ].filter(isNonEmptyString);
  return [...new Set(agents)];
}

export function workflowStageAgentLabel(
  summary: StudioRunDetailSummary,
  stage: string,
  t: (key: StudioCopyKey) => string,
  agentLabels?: AgentDisplayNames,
): string {
  const agents = workflowStageAgents(summary, stage);
  return agents.length > 0
    ? agents.map((agent) => agentDisplayName(agent, agentLabels)).join(", ")
    : t("unknown");
}

export function workflowStageNodeAgentLabel(
  summary: StudioRunDetailSummary,
  stage: string,
  t: (key: StudioCopyKey) => string,
  agentLabels?: AgentDisplayNames,
): string {
  const agents = workflowStageAgents(summary, stage);
  if (agents.length === 0) {
    return t("unknown");
  }
  return agents.length === 1 ? agentDisplayName(agents[0], agentLabels) : `${agents.length} ${t("agents")}`;
}

export function workflowStageNodeTimeLabel(
  summary: StudioRunDetailSummary,
  stage: string,
  t: (key: StudioCopyKey) => string,
): string {
  const timing = workflowStageTiming(summary, stage);
  const label = formatLocalTime(timing?.started_at);
  return label || t("unknown");
}

function agentDisplayName(agent: string, agentLabels?: AgentDisplayNames): string {
  const label = agentLabels?.[agent]?.trim();
  return label && label !== agent ? label : agent;
}

function workflowDisplayName(
  workflow: string | undefined,
  workflowLabels: WorkflowDisplayNames | undefined,
  t: (key: StudioCopyKey) => string,
): string {
  if (!workflow) {
    return t("unknown");
  }
  const label = workflowLabels?.[workflow]?.trim();
  return label && label !== workflow ? label : workflow;
}

export function workflowStageExitLabel(
  summary: StudioRunDetailSummary,
  stage: string,
  t: (key: StudioCopyKey) => string,
): string {
  const timing = workflowStageTiming(summary, stage);
  if (typeof timing?.exit_code === "number") {
    return `exit=${timing.exit_code}`;
  }
  const attemptExitCodes = workflowStageAttempts(summary, stage)
    .map((attempt) => attempt.exit_code)
    .filter((exitCode): exitCode is number => typeof exitCode === "number");
  if (attemptExitCodes.length > 0) {
    const uniqueExitCodes = [...new Set(attemptExitCodes)];
    return uniqueExitCodes.length === 1
      ? `exit=${uniqueExitCodes[0]}`
      : uniqueExitCodes.map((exitCode) => `exit=${exitCode}`).join(", ");
  }
  return workflowStageIsCurrentOnly(summary, stage) ? t("noExternalProcess") : t("exitCodeNotRecorded");
}

function workflowStageIsCurrentOnly(summary: StudioRunDetailSummary, stage: string): boolean {
  const invocations = workflowStageInvocations(summary, stage);
  if (workflowStageAttempts(summary, stage).some(hasExternalStageAttemptAgent)) {
    return false;
  }
  if (invocations.length > 0) {
    return invocations.every((invocation) =>
      invocation.kind === "current" || invocation.agent === "current"
    );
  }
  const agents = workflowStageAgents(summary, stage);
  return agents.length === 1 && agents[0] === "current";
}

function hasExternalStageAttemptAgent(attempt: {
  actual_agent?: string;
  requested_agent?: string;
  primary_agent?: string;
}): boolean {
  return [attempt.actual_agent, attempt.requested_agent, attempt.primary_agent]
    .some((agent) => isNonEmptyString(agent) && agent !== "current");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
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
