import {
  Alert,
  Button,
  Code,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useState, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import type {
  StudioMutationAction,
  StudioMutationRequest,
  StudioMutationResponse,
} from "../../api/mutations.js";

export type SafeActionMutationState =
  | { status: "idle" }
  | { status: "running"; action: StudioMutationAction }
  | { status: "result"; response: StudioMutationResponse }
  | { status: "error"; message: string };

export interface SafeActionsPanelProps {
  selectedRunId?: string;
  state?: SafeActionMutationState;
  onSubmit: (request: StudioMutationRequest) => Promise<StudioMutationResponse>;
  onSettled?: (response: StudioMutationResponse) => void;
}

interface BuildSafeActionRequestInput {
  action: StudioMutationAction;
  selectedRunId?: string;
  actionStage: string;
  attachStage: string;
  attachText: string;
}

export function SafeActionsPanel({
  selectedRunId,
  state,
  onSubmit,
  onSettled,
}: SafeActionsPanelProps): ReactElement {
  const { t } = useStudioCopy();
  const [actionStage, setActionStage] = useState("all");
  const [attachStage, setAttachStage] = useState("decide");
  const [attachText, setAttachText] = useState("");
  const [internalState, setInternalState] = useState<SafeActionMutationState>({ status: "idle" });
  const mutationState = state ?? internalState;
  const isBusy = mutationState.status === "running";

  async function submitAction(action: StudioMutationAction): Promise<void> {
    let request: StudioMutationRequest;
    try {
      request = buildSafeActionRequest({
        action,
        selectedRunId,
        actionStage,
        attachStage,
        attachText,
      });
    } catch (error) {
      setInternalState({ status: "error", message: errorMessage(error) });
      return;
    }

    setInternalState({ status: "running", action });
    try {
      const response = await onSubmit(request);
      setInternalState({ status: "result", response });
      onSettled?.(response);
    } catch (error) {
      setInternalState({ status: "error", message: errorMessage(error) });
    }
  }

  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-safe-actions" withBorder radius="md" p="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Title order={2} size="h3">{t("action")}</Title>
        <Text size="sm" c="dimmed" fw={700}>{safeActionStatusLabel(mutationState, t)}</Text>
      </Group>
      <Stack mt="md" gap="md">
        <Alert variant="light">{safeActionContext(selectedRunId, actionStage, attachStage, t)}</Alert>
        <TextInput
          id="mutation-stage"
          label={t("actionStage")}
          value={actionStage}
          autoComplete="off"
          onChange={(event) => setActionStage(event.currentTarget.value)}
        />
        <Group grow aria-label={t("flowActions")}>
          {(["dispatch", "retry", "resume"] as const).map((action) => (
            <Button
              key={action}
              type="button"
              data-mutation-action={action}
              disabled={isBusy}
              onClick={() => void submitAction(action)}
            >
              {actionLabel(action, t)}
            </Button>
          ))}
        </Group>
        <TextInput
          id="attach-stage"
          label={t("attachStage")}
          value={attachStage}
          autoComplete="off"
          onChange={(event) => setAttachStage(event.currentTarget.value)}
        />
        <Textarea
          id="attach-text"
          minRows={3}
          label={t("textArtifact")}
          placeholder={t("textArtifact")}
          value={attachText}
          onChange={(event) => setAttachText(event.currentTarget.value)}
        />
        <Button
          id="attach-submit"
          type="button"
          disabled={isBusy}
          onClick={() => void submitAction("attach")}
        >
          {t("attach")}
        </Button>
        <Code id="mutation-output" block className="studio-code-block">
          {safeActionOutput(mutationState, t) || t("noMutationOutput")}
        </Code>
      </Stack>
    </Paper>
  );
}

export function buildSafeActionRequest({
  action,
  selectedRunId,
  actionStage,
  attachStage,
  attachText,
}: BuildSafeActionRequestInput): StudioMutationRequest {
  if (!selectedRunId) {
    throw new Error("Select a run first.");
  }
  const stage = actionStage.trim();
  if (action === "dispatch") {
    return {
      action,
      run_id: selectedRunId,
      stage: stage || "all",
    };
  }
  if (action === "retry" || action === "resume") {
    return stage && stage !== "all"
      ? { action, run_id: selectedRunId, stage }
      : { action, run_id: selectedRunId };
  }
  return {
    action: "attach",
    run_id: selectedRunId,
    stage: attachStage.trim(),
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

function safeActionStatusLabel(state: SafeActionMutationState, t: (key: StudioCopyKey) => string): string {
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
  return t("idle");
}

function safeActionContext(
  selectedRunId: string | undefined,
  actionStage: string,
  attachStage: string,
  t: (key: StudioCopyKey) => string,
): string {
  const stage = actionStage.trim() || "all";
  const attach = attachStage.trim() || t("unknown");
  return selectedRunId
    ? `${t("currentStatus")} ${t("run")} · ${selectedRunId} · ${t("actionStage")} · ${stage} · ${t("attachStage")} · ${attach}`
    : `${t("selectRun")} · ${t("actionStage")} · ${stage} · ${t("attachStage")} · ${attach}`;
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
