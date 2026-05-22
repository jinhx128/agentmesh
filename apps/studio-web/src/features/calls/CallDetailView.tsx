import {
  Alert,
  Anchor,
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
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useState, type ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import { formatLocalDateTime } from "../../app/time.js";
import type {
  StudioCallAdoptionEvent,
  StudioCallAdoptionRequest,
  StudioCallAdoptionResponse,
  StudioCallDetail,
  StudioCallPreview,
  StudioCallSummary,
  StudioCallWarning,
} from "../../api/calls.js";

export type CallDetailState =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "ready"; detail: StudioCallDetail }
  | { status: "error"; message: string };

export interface CallDetailViewProps {
  state: CallDetailState;
  onSubmitAdoption?: (request: StudioCallAdoptionRequest) => Promise<StudioCallAdoptionResponse>;
}

export function CallDetailView({ state, onSubmitAdoption }: CallDetailViewProps): ReactElement {
  const { t } = useStudioCopy();
  if (state.status === "ready") {
    return <ReadyCallDetail detail={state.detail} onSubmitAdoption={onSubmitAdoption} />;
  }
  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-call-detail" withBorder radius="md" p="lg">
      <PanelHeader title="Calls" meta={state.status === "error" ? "Error" : ""} />
      <Alert mt="md" color={state.status === "error" ? "red" : "gray"} title={state.status === "error" ? t("callDetailsFailed") : undefined} variant="light">
        {callDetailMessage(state, t)}
      </Alert>
    </Paper>
  );
}

function ReadyCallDetail({
  detail,
  onSubmitAdoption,
}: {
  detail: StudioCallDetail;
  onSubmitAdoption?: (request: StudioCallAdoptionRequest) => Promise<StudioCallAdoptionResponse>;
}): ReactElement {
  const { t } = useStudioCopy();
  const call = detail.call;
  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-call-detail" withBorder radius="md" p="lg">
      <PanelHeader title={t("directCall")} meta={`${call.status} · ${t("adoption")} · ${call.adoption_status}`} />
      <SimpleGrid mt="md" cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
        <CallMetric label={t("call")} value={call.id} />
        <CallMetric label={t("status")} value={call.status} className={`status ${call.status}`} />
        <CallMetric label={t("agent")} value={call.agent_id ?? t("unknown")} />
        <CallMetric label={t("adapter")} value={call.adapter} />
        <CallMetric label={t("purpose")} value={call.purpose} />
        <CallMetric label={t("adoption")} value={call.adoption_status} />
        <CallMetric label={t("createdAt")} value={formatTimestamp(call.created_at)} />
        <CallMetric label={t("completedAt")} value={formatTimestamp(call.completed_at)} />
      </SimpleGrid>
      {call.output_path ? (
        <Alert mt="md" variant="light">
          <Text size="sm" fw={800}>{t("output")}</Text>
          <Anchor href={`#${call.output_path}`} data-output-path={call.output_path}>{call.output_path}</Anchor>
        </Alert>
      ) : null}
      <CallWarnings warnings={detail.warnings} />
      <CallRelated call={call} />
      <SimpleGrid mt="md" cols={{ base: 1, lg: 3 }} spacing="md">
        <CallPreviewPanel title={t("prompt")} preview={detail.prompt} emptyMessage={t("noPromptRecorded")} />
        <CallPreviewPanel title={t("output")} preview={detail.output} emptyMessage={t("noOutputFile")} />
        <CallPreviewPanel title={t("stderr")} preview={detail.stderr} emptyMessage={t("noStderrRecorded")} />
      </SimpleGrid>
      <CallFailureSummary call={call} />
      <CallAdoptionControls call={call} onSubmitAdoption={onSubmitAdoption} />
      <CallAdoptionHistory events={detail.adoption_events} />
    </Paper>
  );
}

function CallMetric({
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

function CallRelated({ call }: { call: StudioCallSummary }): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Card mt="md" withBorder radius="md" p="md">
      <Title order={3} size="h4" mb="sm">{t("related")}</Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        <RelatedList title={t("relatedFiles")} values={call.related_files} kind="file" />
        <RelatedList title={t("runs")} values={call.related_run_ids} kind="run" />
        <RelatedList title={t("calls")} values={call.related_call_ids} kind="call" />
      </SimpleGrid>
    </Card>
  );
}

function RelatedList({
  title,
  values,
  kind,
}: {
  title: string;
  values: string[];
  kind: "file" | "run" | "call";
}): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Stack gap="xs">
      <Text fw={800}>{title}</Text>
      {values.length > 0 ? (
        <List size="sm">
          {values.map((value) => (
            <List.Item key={value}>
              {kind === "file" ? (
                <span>{value}</span>
              ) : (
                <Anchor href={`#${kind}-${value}`}>{value}</Anchor>
              )}
            </List.Item>
          ))}
        </List>
      ) : (
        <Text size="sm" c="dimmed">{t("noRelatedItems")}</Text>
      )}
    </Stack>
  );
}

function CallPreviewPanel({
  title,
  preview,
  emptyMessage,
}: {
  title: string;
  preview: StudioCallPreview;
  emptyMessage: string;
}): ReactElement {
  const { t } = useStudioCopy();
  const meta = [
    preview.path,
    preview.truncated ? t("truncated") : "",
    preview.authoritative ? t("authoritative") : "",
  ].filter(Boolean).join(" · ");
  return (
    <Card withBorder radius="md" p="md">
      <Group justify="space-between" align="flex-start" mb="sm">
        <Title order={3} size="h4">{title}</Title>
        <Text size="xs" c="dimmed">{meta}</Text>
      </Group>
      <Code block className="studio-code-block">
        {preview.present ? preview.content : emptyMessage}
      </Code>
    </Card>
  );
}

function CallFailureSummary({ call }: { call: StudioCallSummary }): ReactElement | null {
  const { t } = useStudioCopy();
  const hasFailure = call.error_kind !== "none" || Boolean(call.error_summary) || (
    call.exit_code !== null && call.exit_code !== 0
  );
  if (!hasFailure) {
    return null;
  }
  const exit = call.exit_code === null ? `exit=${t("unknown")}` : `exit=${call.exit_code}`;
  return (
    <Alert mt="md" color="red" title={t("failureSummary")} variant="light">
      {call.error_kind} · {exit} · {call.error_summary ?? t("noRelatedItems")}
    </Alert>
  );
}

function CallAdoptionControls({
  call,
  onSubmitAdoption,
}: {
  call: StudioCallSummary;
  onSubmitAdoption?: (request: StudioCallAdoptionRequest) => Promise<StudioCallAdoptionResponse>;
}): ReactElement {
  const { t } = useStudioCopy();
  const [reason, setReason] = useState("");
  const [relatedCommit, setRelatedCommit] = useState("");
  const [relatedRunId, setRelatedRunId] = useState("");
  const [supersededByCallId, setSupersededByCallId] = useState("");
  const [submission, setSubmission] = useState<{
    status: "idle" | "submitting" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });

  const disabledReason = callAdoptionDisabledReason(call, onSubmitAdoption, t);
  const disabled = disabledReason !== undefined || submission.status === "submitting";

  async function submit(status: StudioCallAdoptionRequest["status"]): Promise<void> {
    if (!onSubmitAdoption) {
      setSubmission({ status: "error", message: t("adoptionActionsUnavailable") });
      return;
    }
    setSubmission({ status: "submitting", message: `${t("markedLocalEvidence")}: ${status}...` });
    try {
      const trimmedReason = trimmedValue(reason);
      const trimmedRelatedCommit = trimmedValue(relatedCommit);
      const trimmedRelatedRunId = trimmedValue(relatedRunId);
      const trimmedSupersededByCallId = trimmedValue(supersededByCallId);
      const response = await onSubmitAdoption({
        status,
        ...(trimmedReason ? { reason: trimmedReason } : {}),
        ...(trimmedRelatedCommit ? { related_commit: trimmedRelatedCommit } : {}),
        ...(trimmedRelatedRunId ? { related_run_id: trimmedRelatedRunId } : {}),
        ...(trimmedSupersededByCallId ? { superseded_by_call_id: trimmedSupersededByCallId } : {}),
      });
      if (response.ok) {
        setSubmission({ status: "success", message: `${t("markedLocalEvidence")}: ${status}` });
        return;
      }
      setSubmission({
        status: "error",
        message: `${t("actionRejected")}: ${adoptionResponseMessage(response.payload)}`,
      });
    } catch (error) {
      setSubmission({
        status: "error",
        message: `${t("actionRejected")}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return (
    <Card mt="md" withBorder radius="md" p="md" aria-label={t("callAdoptionActions")}>
      <Stack gap="md">
        <BoxedCopy disabledReason={disabledReason} />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Textarea
            label={t("reason")}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
            placeholder={t("reasonPlaceholder")}
          />
          <TextInput
            label={t("relatedCommit")}
            value={relatedCommit}
            onChange={(event) => setRelatedCommit(event.currentTarget.value)}
            placeholder={t("optional")}
          />
          <TextInput
            label={t("relatedRun")}
            value={relatedRunId}
            onChange={(event) => setRelatedRunId(event.currentTarget.value)}
            placeholder={t("optional")}
          />
          <TextInput
            label={t("supersededByCall")}
            value={supersededByCallId}
            onChange={(event) => setSupersededByCallId(event.currentTarget.value)}
            placeholder={t("requiredForSuperseded")}
          />
        </SimpleGrid>
        <Group grow>
          <Button
            type="button"
            data-call-adoption-action="accepted"
            disabled={disabled}
            onClick={() => void submit("accepted")}
          >
            {t("accept")}
          </Button>
          <Button
            type="button"
            data-call-adoption-action="rejected"
            disabled={disabled}
            color="red"
            variant="light"
            onClick={() => void submit("rejected")}
          >
            {t("reject")}
          </Button>
          <Button
            type="button"
            data-call-adoption-action="superseded"
            disabled={disabled}
            color="yellow"
            variant="light"
            onClick={() => void submit("superseded")}
          >
            {t("supersede")}
          </Button>
        </Group>
        {submission.status !== "idle" ? (
          <Alert color={submission.status === "error" ? "red" : "green"} variant="light">
            {submission.message}
          </Alert>
        ) : null}
      </Stack>
    </Card>
  );
}

function BoxedCopy({ disabledReason }: { disabledReason?: string }): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Stack gap={3}>
      <Title order={3} size="h4">{t("localEvidenceMarker")}</Title>
      <Text size="sm" c="dimmed">
        {t("localEvidenceNote")}
      </Text>
      {disabledReason ? <Badge color="gray">{disabledReason}</Badge> : null}
    </Stack>
  );
}

function CallAdoptionHistory({ events }: { events: StudioCallAdoptionEvent[] }): ReactElement {
  const { t } = useStudioCopy();
  return (
    <Card mt="md" withBorder radius="md" p="md">
      <Title order={3} size="h4" mb="sm">{t("adoptionHistory")}</Title>
      {events.length > 0 ? (
        <List type="ordered" size="sm">
          {events.map((event) => (
            <List.Item key={`${event.updated_at}:${event.status}`}>
              <Stack gap={2}>
                <Text fw={800}>{event.status}</Text>
                <Text size="xs" c="dimmed">{formatTimestamp(event.updated_at)} · {event.updated_by_entrypoint}</Text>
                {event.reason ? <Text size="sm">{event.reason}</Text> : null}
                {event.related_commit ? <Text size="xs">{event.related_commit}</Text> : null}
                {event.related_run_id ? <Text size="xs">{event.related_run_id}</Text> : null}
                {event.superseded_by_call_id ? <Text size="xs">{event.superseded_by_call_id}</Text> : null}
              </Stack>
            </List.Item>
          ))}
        </List>
      ) : (
        <Text size="sm" c="dimmed">{t("noAdoptionEvents")}</Text>
      )}
    </Card>
  );
}

function callAdoptionDisabledReason(
  call: StudioCallSummary,
  onSubmitAdoption: unknown,
  t: (key: StudioCopyKey) => string,
): string | undefined {
  if (call.read_only || call.unsupported_schema) {
    return t("readOnly");
  }
  if (call.adoption_status !== "unreviewed") {
    return `${t("alreadyReviewed")}: ${call.adoption_status}`;
  }
  if (!onSubmitAdoption) {
    return t("adoptionActionsUnavailable");
  }
  return undefined;
}

function trimmedValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function adoptionResponseMessage(payload: StudioCallAdoptionResponse["payload"]): string {
  return "error" in payload ? payload.error : `marked ${payload.call.adoption_status}`;
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

function PanelHeader({ title, meta }: { title: string; meta: string }): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      {meta ? <Text size="sm" c="dimmed" fw={700}>{meta}</Text> : null}
    </Group>
  );
}
