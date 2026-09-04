import {
  Alert,
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
import { showStudioError, showStudioSuccess } from "../../app/mutation-feedback.js";
import { workflowStageLabel } from "../../app/stages.js";
import {
  reviewerSessionModeLabel,
  runStatusLabel,
  viewStateLabel,
} from "../../app/status-labels.js";
import { formatLocalDateTime, formatLocalTime } from "../../app/time.js";
import type {
  StudioRunDetail,
  StudioRunDetailSummary,
  StudioRunStatus,
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
export type AgentDisplayTools = Record<string, string>;
export type WorkflowDisplayNames = Record<string, string>;
export { workflowStageLabel };

export interface RunOverviewProps {
  state: RunOverviewState;
  view?: "all" | "details" | "summary" | "stages";
  agentLabels?: AgentDisplayNames;
  agentTools?: AgentDisplayTools;
  workflowLabels?: WorkflowDisplayNames;
  onCloseReviewerSession?: (sessionRef: string) => Promise<void>;
  onPurgeExpiredReviewerSessions?: () => Promise<void>;
}

export function RunOverview({
  state,
  view = "all",
  agentLabels,
  agentTools,
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
        agentTools={agentTools}
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
          <PanelHeader title={t("workflowFlow")} meta={state.status === "error" ? viewStateLabel(state.status) : ""} />
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
  agentTools,
  workflowLabels,
  onCloseReviewerSession,
  onPurgeExpiredReviewerSessions,
}: {
  detail: StudioRunDetail;
  view: NonNullable<RunOverviewProps["view"]>;
  agentLabels?: AgentDisplayNames;
  agentTools?: AgentDisplayTools;
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
                agentTools={agentTools}
              />
              <ReviewReleaseStageEvidence
                view={detail.review_release}
                stageType={workflowStageType(summary, activeStage)}
              />
            </>
          ) : null}
        </Paper>
      ) : null}
      {shouldRenderRunPanel(view, "signals") ? <RunReviewSignals detail={detail} /> : null}
      {shouldRenderRunPanel(view, "advanced") ? <RunAdvancedDetails detail={detail} /> : null}
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
      showStudioSuccess(action === "purge" ? "过期 reviewer session 已清理" : "Reviewer session 已关闭");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setActionError(message);
      showStudioError(action === "purge" ? "清理 reviewer session 失败" : "关闭 reviewer session 失败", message);
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
              <OverviewMetric label={t("sessionMode")} value={reviewerSessionModeLabel(session.mode)} />
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
  panel: "summary" | "stages" | "signals" | "advanced",
): boolean {
  return view === "all"
    || view === panel
    || (view === "details" && (panel === "summary" || panel === "stages" || panel === "signals" || panel === "advanced"));
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
  const currentNode = summary.current_stage ? workflowStageLabel(summary.current_stage) : t("noCurrentNode");
  const startedAt = runStartedAt(summary);
  const terminal = runStatusIsTerminal(summary.run_status);
  const completedAt = terminal ? summary.updated_at : undefined;
  const completedStageCount = Object.values(summary.stage_status)
    .filter((status) => status === "completed").length;
  const summaryItems = [
    { field: "title", label: t("title"), value: summary.title ?? t("unknown") },
    { field: "run", label: t("run"), value: summary.run_id },
    { field: "workflow", label: t("workflow"), value: workflowDisplayName(summary.workflow, workflowLabels, t) },
    { field: "startedAt", label: t("startedAt"), value: startedAt ? formatTimestamp(startedAt) : t("noTiming") },
    { field: "completedAt", label: t("completedAt"), value: completedAt ? formatTimestamp(completedAt) : t("noTiming") },
    { field: "duration", label: terminal ? t("duration") : "已历时", value: runDurationLabel(startedAt, summary.updated_at, t) },
  ];
  const rightSummaryItems = [
    { field: "workspace", label: t("workspace"), value: summary.workspace.label },
    { field: "status", label: t("status"), value: runStatusLabel(summary.run_status) },
    { field: "currentNode", label: t("currentNode"), value: currentNode },
    { field: "stage", label: t("stage"), value: `${completedStageCount}/${stages.length}` },
    { field: "runDirectory", label: t("runDirectory"), value: summary.run_dir ?? t("unknown") },
  ];
  return (
    <Paper className="studio-panel" data-studio-section="current-run-overview" withBorder radius="md" p="lg">
      <PanelHeader title={t("overview")} meta="" />
      <div className="run-summary-row" data-studio-section="run-summary-row">
        <div className="run-summary-column" data-summary-column="left">
          {summaryItems.map((item) => (
            <CompactDetailItem field={item.field} key={item.field} label={item.label} value={item.value} />
          ))}
        </div>
        <div className="run-summary-column" data-summary-column="right">
          {rightSummaryItems.map((item) => (
            <CompactDetailItem
              field={item.field}
              key={item.field}
              label={item.label}
              value={item.value}
              valueClassName={item.field === "status" ? `status ${summary.run_status}` : undefined}
            />
          ))}
        </div>
      </div>
    </Paper>
  );
}

function CompactDetailItem({
  field,
  label,
  value,
  fieldKind = "summary",
  valueClassName,
}: {
  field: string;
  label: string;
  value: string;
  fieldKind?: "summary" | "stage" | "policy";
  valueClassName?: string;
}): ReactElement {
  const fieldAttribute = fieldKind === "stage"
    ? { "data-stage-field": field }
    : fieldKind === "policy"
      ? { "data-policy-field": field }
      : { "data-summary-field": field };
  const wrapValue = (fieldKind === "stage" && (field === "agent" || field === "tool"))
    || field === "title"
    || field === "runDirectory"
    || fieldKind === "policy";
  const valueClasses = [
    "run-summary-value",
    wrapValue ? "wrap" : undefined,
    valueClassName,
  ].filter(Boolean).join(" ");
  return (
    <div className="run-summary-item" {...fieldAttribute}>
      <Text className="run-summary-label" component="span" size="xs" c="dimmed" fw={700}>{label}</Text>
      <Text
        className={valueClasses}
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

function RunReviewSignals({ detail }: { detail: StudioRunDetail }): ReactElement | null {
  const { t } = useStudioCopy();
  const skippedChecks = detail.review_release.skipped_checks;
  const residualRisk = detail.review_release.residual_risk;
  if (skippedChecks.length === 0 && residualRisk.length === 0) {
    return null;
  }
  return (
    <Paper className="studio-panel" data-studio-section="run-review-signals" withBorder radius="md" p="lg">
      <PanelHeader title={t("runSignals")} meta="" />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" mt="md">
        <DiagnosticList title={t("skippedChecks")} items={skippedChecks} emptyLabel={t("noRelatedItems")} />
        <DiagnosticList title={t("residualRisk")} items={residualRisk} emptyLabel={t("noRelatedItems")} />
      </SimpleGrid>
    </Paper>
  );
}

function RunAdvancedDetails({ detail }: { detail: StudioRunDetail }): ReactElement | null {
  const { t } = useStudioCopy();
  const summary = detail.summary;
  const contextPolicy = summary.resolved_context_policy;
  const executionPolicy = summary.resolved_execution_policy;
  const hasContextPolicy = hasRecordValues(contextPolicy);
  const hasExecutionPolicy = hasRecordValues(executionPolicy);
  if (!hasContextPolicy && !hasExecutionPolicy) {
    return null;
  }
  return (
    <Paper className="studio-panel run-advanced-details" data-studio-section="run-advanced-details" withBorder radius="md" p="lg">
      <PanelHeader title={t("advancedDetails")} meta="" />
      <Stack gap="md" mt="md">
        {hasRecordValues(contextPolicy) ? (
          <ReadablePolicyCard
            title={t("contextPolicy")}
            items={contextPolicySummary(contextPolicy, t)}
            value={contextPolicy}
          />
        ) : null}
        {hasRecordValues(executionPolicy) ? (
          <ReadablePolicyCard
            title={t("executionPolicy")}
            items={executionPolicySummary(executionPolicy, t)}
            value={executionPolicy}
          />
        ) : null}
      </Stack>
    </Paper>
  );
}

function hasRecordValues(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return Boolean(value && Object.keys(value).length > 0);
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

function ReadablePolicyCard({
  title,
  items,
  value,
}: {
  title: string;
  items: Array<{ field: string; label: string; value: string }>;
  value: Record<string, unknown>;
}): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Card className="run-policy-card" withBorder radius="md" p="md">
      <Text fw={800} mb="xs">{title}</Text>
      <div className="run-summary-row policy-summary-row">
        {items.map((item) => (
          <CompactDetailItem
            field={item.field}
            fieldKind="policy"
            key={item.field}
            label={item.label}
            value={item.value}
          />
        ))}
      </div>
      <details className="run-policy-raw-details">
        <summary>{t("rawData")}</summary>
        <Code block className="studio-code-block">{JSON.stringify(value, null, 2)}</Code>
      </details>
    </Card>
  );
}

function contextPolicySummary(
  value: Record<string, unknown>,
  t: (key: StudioCopyKey) => string,
): Array<{ field: string; label: string; value: string }> {
  const requiredSources = policyStringArray(value.required_sources);
  const deniedPaths = policyStringArray(value.denied_paths);
  const redactPatterns = policyStringArray(value.redact_patterns);
  return [
    ...(typeof value.max_files === "number"
      ? [{ field: "maxFiles", label: t("maxFiles"), value: `${value.max_files} 个` }]
      : []),
    ...(typeof value.max_bytes === "number"
      ? [{ field: "maxBytes", label: t("maxBytes"), value: formatBytes(value.max_bytes) }]
      : []),
    ...(requiredSources
      ? [{ field: "requiredSources", label: t("requiredSources"), value: formatPolicyList(requiredSources, t) }]
      : []),
    ...(deniedPaths
      ? [{ field: "deniedPaths", label: t("deniedPaths"), value: formatPolicyList(deniedPaths, t) }]
      : []),
    ...(redactPatterns
      ? [{ field: "redactPatterns", label: t("redactPatterns"), value: `${redactPatterns.length} 条` }]
      : []),
  ];
}

function executionPolicySummary(
  value: Record<string, unknown>,
  t: (key: StudioCopyKey) => string,
): Array<{ field: string; label: string; value: string }> {
  const sourceLayers = policySourceLayers(value.source_layers);
  return [
    ...(sourceLayers
      ? [{ field: "sourceLayers", label: t("configSource"), value: formatPolicyList(sourceLayers, t) }]
      : []),
    ...(typeof value.require_user_gate === "boolean"
      ? [{ field: "requireUserGate", label: t("requireUserGateSummary"), value: value.require_user_gate ? t("yes") : t("no") }]
      : []),
    ...(typeof value.allow_auto_dispatch === "boolean"
      ? [{ field: "allowAutoDispatch", label: t("allowAutoDispatchSummary"), value: value.allow_auto_dispatch ? t("yes") : t("no") }]
      : []),
    ...(typeof value.max_retry_attempts === "number"
      ? [{ field: "maxRetryAttempts", label: t("maxRetryAttempts"), value: `${value.max_retry_attempts} 次` }]
      : []),
  ];
}

function policyStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function policySourceLayers(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const source = (item as Record<string, unknown>).source;
    if (typeof source !== "string") {
      return [];
    }
    return [{
      user: "用户配置",
      project: "项目配置",
      explicit: "指定配置",
      environment: "环境配置",
    }[source] ?? source];
  });
}

function formatPolicyList(values: string[], t: (key: StudioCopyKey) => string): string {
  return values.length > 0 ? values.join("、") : t("none");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${formatCompactNumber(bytes / 1024)} KB`;
  }
  return `${formatCompactNumber(bytes / (1024 * 1024))} MB`;
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
  agentTools,
}: {
  detail: StudioRunDetail;
  stage: string;
  status: WorkflowStageStatus;
  agentLabels?: AgentDisplayNames;
  agentTools?: AgentDisplayTools;
}): ReactElement {
  const { t } = useStudioCopy();
  const summary = detail.summary;
  const stageType = workflowStageType(summary, stage);
  const stageLabel = workflowStageLabel(stage);
  const stageTypeLabel = workflowStageLabel(stageType);
  const timing = workflowStageTiming(summary, stage);
  const agentLabel = workflowStageAgentLabel(summary, stage, t, agentLabels);
  const toolLabel = workflowStageToolLabel(summary, stage, agentTools, t);
  const exitLabel = workflowStageExitLabel(summary, stage, t);
  const leftStageItems = [
    { field: "stage", label: t("stage"), value: stageLabel },
    { field: "type", label: t("type"), value: stageTypeLabel },
    { field: "startedAt", label: t("startedAt"), value: formatStageTimestamp(timing?.started_at, t) },
    { field: "completedAt", label: t("completedAt"), value: formatStageTimestamp(timing?.failed_at ?? timing?.completed_at, t) },
    { field: "duration", label: t("duration"), value: formatDuration(timing?.duration_ms) || t("unknown") },
    { field: "exit", label: t("exit"), value: exitLabel },
  ];
  const rightStageItems = [
    { field: "status", label: t("status"), value: stageStatusLabel(status, t), valueClassName: `status ${status}` },
    { field: "agent", label: t("agent"), value: agentLabel },
    { field: "tool", label: t("tool"), value: toolLabel },
    { field: "attemptCount", label: t("attemptCount"), value: formatAttemptCount(timing?.attempt_count, t) },
  ];
  return (
    <Card className="workflow-stage-detail" data-studio-section="workflow-stage-detail" withBorder radius="md" p="md">
      <Text fw={800}>{stageLabel}</Text>
      <div className="run-summary-row workflow-stage-summary-row" data-studio-section="workflow-stage-summary-row">
        <div className="run-summary-column" data-stage-column="left">
          {leftStageItems.map((item) => (
            <CompactDetailItem field={item.field} fieldKind="stage" key={item.field} label={item.label} value={item.value} />
          ))}
        </div>
        <div className="run-summary-column" data-stage-column="right">
          {rightStageItems.map((item) => (
            <CompactDetailItem
              field={item.field}
              fieldKind="stage"
              key={item.field}
              label={item.label}
              value={item.value}
              valueClassName={item.valueClassName}
            />
          ))}
        </div>
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
  return stages.find((stage) => summary.stage_status[stage] !== "completed") ?? stages[stages.length - 1] ?? null;
}

export function workflowStageStatus(
  summary: StudioRunDetailSummary,
  stage: string,
): WorkflowStageStatus {
  const status = summary.stage_status[stage];
  if (status === "failed" || status === "timed_out") {
    return "failed";
  }
  if (status === "completed") {
    return "completed";
  }
  if (summary.run_status === "awaiting_current" && summary.current_stage === stage) {
    return "current";
  }
  return "pending";
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

export function workflowStageToolLabel(
  summary: StudioRunDetailSummary,
  stage: string,
  agentTools: AgentDisplayTools | undefined,
  t: (key: StudioCopyKey) => string,
): string {
  const directTools = [
    ...workflowStageInvocations(summary, stage).flatMap((invocation) => [
      stringRecordValue(invocation, "tool"),
      stringRecordValue(invocation, "adapter"),
      stringRecordValue(invocation, "adapter_id"),
    ]),
    ...workflowStageAttempts(summary, stage).flatMap((attempt) => [
      stringRecordValue(attempt, "tool"),
      stringRecordValue(attempt, "adapter"),
      stringRecordValue(attempt, "adapter_id"),
    ]),
  ].filter(isNonEmptyString);
  const tools = directTools.length > 0
    ? directTools
    : workflowStageAgents(summary, stage)
      .map((agent) => agentTools?.[agent])
      .filter(isNonEmptyString);
  const uniqueTools = [...new Set(tools.map(displayToolName).filter(isNonEmptyString))];
  return uniqueTools.length > 0 ? uniqueTools.join(", ") : t("unknown");
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

function displayToolName(tool: string): string {
  return {
    command: "Command Agent",
    "codex-cli": "Codex CLI",
    codex: "Codex CLI",
    "claude-code-cli": "Claude Code CLI",
    claude: "Claude Code CLI",
    "cursor-agent": "Cursor Agent",
    cursor: "Cursor Agent",
    "antigravity-cli": "Antigravity CLI",
    antigravity: "Antigravity CLI",
    "opencode-cli": "OpenCode CLI",
    opencode: "OpenCode CLI",
  }[tool] ?? tool;
}

function stringRecordValue(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : undefined;
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
    current: "待提交",
    failed: t("statusFailed"),
    pending: t("pendingStatus"),
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

function runStatusIsTerminal(status: StudioRunStatus): boolean {
  return new Set<StudioRunStatus>([
    "aborted",
    "completed",
    "failed",
    "timed_out",
  ]).has(status);
}

function runStartedAt(summary: StudioRunDetailSummary): string | undefined {
  return summary.stage_timing
    .map((timing) => timing.started_at)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function runDurationLabel(
  startedAt: string | undefined,
  updatedAt: string | undefined,
  t: (key: StudioCopyKey) => string,
): string {
  if (!startedAt || !updatedAt) {
    return t("noTiming");
  }
  const startedMs = Date.parse(startedAt);
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(updatedMs) || updatedMs < startedMs) {
    return t("noTiming");
  }
  const totalSeconds = Math.floor((updatedMs - startedMs) / 1000);
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

function formatTimestamp(value: string | undefined): string {
  return formatLocalDateTime(value);
}

function formatStageTimestamp(value: string | undefined, t: (key: StudioCopyKey) => string): string {
  return value ? formatTimestamp(value) : t("noTiming");
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
