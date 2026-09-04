import {
  Alert,
  Button,
  Code,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { useEffect, useState, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import { workflowStageLabel } from "../../app/stages.js";
import {
  showStudioError,
  showStudioSuccess,
  studioMutationError,
  studioMutationSucceeded,
} from "../../app/mutation-feedback.js";
import type {
  StudioMutationAction,
  StudioMutationRequest,
  StudioMutationResponse,
} from "../../api/mutations.js";
import type { StudioRunAction, StudioRunDetail } from "../../api/runs.js";

export type SafeActionMutationState =
  | { status: "idle" }
  | { status: "running"; action: StudioMutationAction }
  | { status: "result"; response: StudioMutationResponse }
  | { status: "error"; message: string };

export interface SafeActionsPanelProps {
  detail?: StudioRunDetail;
  unavailableMessage?: string;
  state?: SafeActionMutationState;
  onSubmit: (request: StudioMutationRequest) => Promise<StudioMutationResponse>;
  onSettled?: (response: StudioMutationResponse) => void;
}

interface BuildSafeActionRequestInput {
  action: StudioMutationAction;
  selectedRunId?: string;
  stage: string;
  attachText: string;
}

export function SafeActionsPanel({
  detail,
  unavailableMessage,
  state,
  onSubmit,
  onSettled,
}: SafeActionsPanelProps): ReactElement {
  const { t } = useStudioCopy();
  const [attachText, setAttachText] = useState("");
  const [internalState, setInternalState] = useState<SafeActionMutationState>({ status: "idle" });
  const mutationState = state ?? internalState;
  const isBusy = mutationState.status === "running";

  useEffect(() => {
    setAttachText("");
    setInternalState({ status: "idle" });
  }, [detail?.summary.run_id]);

  async function submitAction(capability: StudioRunAction): Promise<void> {
    let request: StudioMutationRequest;
    try {
      request = buildSafeActionRequest({
        action: capability.action,
        selectedRunId: detail?.summary.run_id,
        stage: capability.stage,
        attachText,
      });
    } catch (error) {
      const message = errorMessage(error);
      setInternalState({ status: "error", message });
      showStudioError("运行操作失败", message);
      return;
    }

    setInternalState({ status: "running", action: capability.action });
    try {
      const response = await onSubmit(request);
      setInternalState({ status: "result", response });
      onSettled?.(response);
      if (studioMutationSucceeded(response)) {
        if (capability.action === "attach") {
          setAttachText("");
        }
        showStudioSuccess("运行操作成功", actionLabel(capability.action, t));
      } else {
        showStudioError("运行操作失败", studioMutationError(response, `${actionLabel(capability.action, t)}失败`));
      }
    } catch (error) {
      const message = errorMessage(error);
      setInternalState({ status: "error", message });
      showStudioError("运行操作失败", message);
    }
  }

  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-safe-actions" withBorder radius="md" p="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Title order={2} size="h3">{t("action")}</Title>
        <Text size="sm" c="dimmed" fw={700}>{safeActionStatusLabel(mutationState, detail, t)}</Text>
      </Group>
      <Stack mt="md" gap="md">
        <Alert variant="light">{safeActionContext(detail, unavailableMessage, t)}</Alert>
        {detail?.run_actions.actions.some((item) => item.action === "attach") ? (
          <Stack gap="sm">
            <Textarea
              id="attach-text"
              minRows={5}
              autosize
              maxRows={14}
              label={t("actionResult")}
              placeholder="填写当前阶段的结论或产物内容"
              value={attachText}
              onChange={(event) => setAttachText(event.currentTarget.value)}
            />
            {detail.run_actions.actions.filter((item) => item.action === "attach").map((capability) => (
              <Button
                key={`${capability.action}:${capability.stage}`}
                type="button"
                data-mutation-action={capability.action}
                disabled={isBusy || attachText.trim().length === 0}
                onClick={() => void submitAction(capability)}
              >
                {actionCapabilityLabel(capability, t)}
              </Button>
            ))}
          </Stack>
        ) : null}
        {detail?.run_actions.actions.some((item) => item.action !== "attach") ? (
          <Group grow aria-label={t("flowActions")}>
            {detail.run_actions.actions.filter((item) => item.action !== "attach").map((capability) => (
              <Button
                key={`${capability.action}:${capability.stage}`}
                type="button"
                data-mutation-action={capability.action}
                disabled={isBusy}
                onClick={() => void submitAction(capability)}
              >
                {actionCapabilityLabel(capability, t)}
              </Button>
            ))}
          </Group>
        ) : null}
        {mutationState.status !== "idle" ? (
          <details className="safe-action-details">
            <summary>{t("actionExecutionDetails")}</summary>
            <Code id="mutation-output" block className="studio-code-block">
              {safeActionOutput(mutationState, t) || t("noMutationOutput")}
            </Code>
          </details>
        ) : null}
      </Stack>
    </Paper>
  );
}

export function buildSafeActionRequest({
  action,
  selectedRunId,
  stage,
  attachText,
}: BuildSafeActionRequestInput): StudioMutationRequest {
  if (!selectedRunId) {
    throw new Error("Select a run first.");
  }
  const targetStage = stage.trim();
  if (!targetStage) {
    throw new Error("Action stage is required.");
  }
  if (action === "dispatch") {
    return {
      action,
      run_id: selectedRunId,
      stage: targetStage,
    };
  }
  if (action === "retry" || action === "resume") {
    return { action, run_id: selectedRunId, stage: targetStage };
  }
  if (!attachText.trim()) {
    throw new Error("请输入阶段结果。");
  }
  return {
    action: "attach",
    run_id: selectedRunId,
    stage: targetStage,
    text: attachText,
  };
}

export function formatStudioMutationResult(response: StudioMutationResponse): string {
  const payload = response.payload;
  const lines = [
    `$ ${Array.isArray(payload.command) ? payload.command.join(" ") : payload.action ?? "mutation"}`,
    `exit_code: ${payload.exit_code ?? "n/a"}`,
    payload.error_code ? `error_code: ${payload.error_code}` : "",
    payload.retryable !== undefined ? `retryable: ${payload.retryable}` : "",
    payload.lock ? formatLockDetails(payload.lock) : "",
    payload.stdout ? `\nstdout:\n${payload.stdout.trimEnd()}` : "",
    payload.stderr ? `\nstderr:\n${payload.stderr.trimEnd()}` : "",
    payload.error ? `\nerror:\n${payload.error}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function formatLockDetails(lock: NonNullable<StudioMutationResponse["payload"]["lock"]>): string {
  return [
    "lock:",
    `  operation: ${lock.operation ?? "unknown"}`,
    `  entrypoint ${lock.entrypoint ?? "unknown"}`,
    `  runtime: ${lock.runtime_version ?? "unknown"}`,
    `  pid: ${lock.pid ?? "unknown"}`,
    `  operation_id: ${lock.operation_id ?? "unknown"}`,
    `  command: ${lock.command ?? "unknown"}`,
    `  heartbeat_at: ${lock.heartbeat_at ?? "unknown"}`,
    `  expires_at: ${lock.expires_at ?? "unknown"}`,
  ].join("\n");
}

function safeActionOutput(state: SafeActionMutationState, t: (key: StudioCopyKey) => string): string {
  if (state.status === "running") {
    return `${t("running")} ${actionLabel(state.action, t)}...`;
  }
  if (state.status === "result") {
    return formatStudioMutationResult(state.response);
  }
  if (state.status === "error") {
    return state.message;
  }
  return "";
}

function safeActionStatusLabel(
  state: SafeActionMutationState,
  detail: StudioRunDetail | undefined,
  t: (key: StudioCopyKey) => string,
): string {
  if (state.status === "running") {
    return t("running");
  }
  if (state.status === "result" && state.response.payload.error_code === "run_locked") {
    return t("locked");
  }
  if (state.status === "result" && (!state.response.ok || state.response.payload.exit_code !== 0)) {
    return t("needsAttention");
  }
  if (state.status === "error") {
    return t("needsAttention");
  }
  if (detail?.run_actions.state === "completed") {
    return t("completed");
  }
  if (detail?.run_actions.state === "running") {
    return t("running");
  }
  if (detail?.run_actions.state === "failed") {
    return t("statusFailed");
  }
  if (detail?.run_actions.state === "awaiting_current") {
    return t("needsAttention");
  }
  return t("idle");
}

function safeActionContext(
  detail: StudioRunDetail | undefined,
  unavailableMessage: string | undefined,
  t: (key: StudioCopyKey) => string,
): string {
  if (!detail) {
    return unavailableMessage ?? t("selectRun");
  }
  const actions = detail.run_actions;
  const stage = workflowStageLabel(actions.current_stage ?? actions.next_stage ?? t("unknown"));
  if (actions.state === "completed") {
    return t("actionCompleted");
  }
  if (actions.state === "running") {
    return `${stage}阶段正在执行，请等待完成。`;
  }
  if (actions.blocked_reason === "auto_dispatch_disabled") {
    return `${stage}阶段的自动执行已被运行策略关闭。`;
  }
  if (actions.blocked_reason === "retry_limit_reached") {
    return `${stage}阶段已达到最大重试次数。`;
  }
  if (actions.blocked_reason === "unassigned_stage") {
    return `${stage}阶段尚未分配 Agent，请先调整 Workflow 配置。`;
  }
  if (actions.state === "failed") {
    return `${stage}阶段执行失败，可以重试该阶段或从这里继续运行。`;
  }
  if (actions.state === "awaiting_current") {
    return `等待提交${stage}阶段结果，提交后将继续更新运行状态。`;
  }
  return actions.actions.some((item) => item.action === "dispatch")
    ? `已准备好从${stage}阶段开始运行。`
    : `可以从${stage}阶段继续运行。`;
}

function actionCapabilityLabel(action: StudioRunAction, t: (key: StudioCopyKey) => string): string {
  if (action.action === "dispatch") {
    return t("startRun");
  }
  if (action.action === "retry") {
    return t("retryFailedStage");
  }
  if (action.action === "resume") {
    return t("continueRun");
  }
  return t("submitStageResult");
}

function actionLabel(action: StudioMutationAction, t: (key: StudioCopyKey) => string): string {
  return {
    dispatch: t("dispatch"),
    retry: t("retry"),
    resume: t("resume"),
    attach: t("attach"),
  }[action];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
