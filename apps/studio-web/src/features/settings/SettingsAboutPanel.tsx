import {
  Alert,
  Badge,
  Card,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { ReactElement } from "react";
import { useStudioCopy, type StudioCopyKey } from "../../app/copy.js";
import { formatLocalDateTime } from "../../app/time.js";
import type { StudioCompatibilityDiagnostics } from "../../api/compatibility.js";

export type SettingsAboutState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; compatibility: StudioCompatibilityDiagnostics };

export interface SettingsAboutPanelProps {
  state: SettingsAboutState;
}

export function SettingsAboutPanel({ state }: SettingsAboutPanelProps): ReactElement {
  const { t } = useStudioCopy();
  if (state.status === "loading") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="settings-about" withBorder radius="md" p="lg">
        <PanelHeader title={t("about")} meta={t("versionInfo")} />
        <Alert mt="md" variant="light">{t("loadingWorkspaceStatus")}</Alert>
      </Paper>
    );
  }

  if (state.status === "error") {
    return (
      <Paper component="section" className="studio-panel" data-studio-section="settings-about" withBorder radius="md" p="lg">
        <PanelHeader title={t("about")} meta={t("versionInfo")} />
        <Alert mt="md" color="red" title={t("workspaceStatusUnavailable")} variant="light">{state.message}</Alert>
      </Paper>
    );
  }

  const compatibility = state.compatibility;
  const metadata = compatibility.metadata;
  const decisionLabel = compatibilityDecisionLabel(compatibility.decision, t);
  const decisionDescription = compatibilityDecisionDescription(compatibility);
  const reasonItems = compatibility.reasons.map(localizeCompatibilityReason);
  return (
    <Paper component="section" className="studio-panel" data-studio-section="settings-about" withBorder radius="md" p="lg">
      <PanelHeader title={t("about")} meta={t("versionInfo")} />
      <Card mt="md" withBorder radius="md" p="md">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start" gap="sm">
            <Badge color={compatibility.decision === "read_write" ? "green" : "yellow"}>{decisionLabel}</Badge>
            <Text size="sm" c="dimmed">{decisionDescription}</Text>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
            <InfoItem label={t("runtimeVersion")} value={compatibility.current_runtime_version} />
            <InfoItem label={t("currentEntrypoint")} value={entrypointLabel(compatibility.current_entrypoint)} />
            <InfoItem label={t("compatibilityFile")} value={compatibility.compatibility_path} />
            <InfoItem label={t("metadataState")} value={metadataStateLabel(compatibility.metadata_state)} />
            <InfoItem label={t("packetSchemaVersion")} value={metadata?.packet_schema_version ?? t("unknown")} />
            <InfoItem label={t("minReadRuntimeVersion")} value={metadata?.min_read_runtime_version ?? t("policyNotRecorded")} />
            <InfoItem label={t("minWriteRuntimeVersion")} value={metadata?.min_write_runtime_version ?? t("policyNotRecorded")} />
            <InfoItem label={t("lastWriter")} value={metadata
              ? `${entrypointLabel(metadata.last_writer_entrypoint)} · 运行时 ${metadata.last_writer_runtime_version}`
              : "尚未写入兼容性元数据"} />
            <InfoItem label={t("lastUpdatedAt")} value={metadata ? formatLocalDateTime(metadata.updated_at) : t("policyNotRecorded")} />
          </SimpleGrid>
          {compatibility.decision !== "read_write" ? (
            <Text size="sm" c="yellow.8">{compatibility.decision === "read_only"
              ? t("upgradeBeforeMutating")
              : t("upgradeBeforeReading")}</Text>
          ) : null}
        </Stack>
      </Card>
      {reasonItems.length > 0 ? (
        <Stack mt="md" gap="xs">
          <Text fw={800} mb="xs">{t("compatibilityDiagnostics")}</Text>
          <List size="sm">
            {reasonItems.map((reason) => <List.Item key={reason}>{reason}</List.Item>)}
          </List>
        </Stack>
      ) : null}
    </Paper>
  );
}

function InfoItem({ label, value }: { label: string; value: string | number }): ReactElement {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" fw={800}>{label}</Text>
      <Text size="sm" fw={700}>{value}</Text>
    </Stack>
  );
}

function compatibilityDecisionLabel(
  decision: StudioCompatibilityDiagnostics["decision"],
  t: (key: StudioCopyKey) => string,
): string {
  return {
    read_write: t("readWrite"),
    read_only: t("readOnly"),
    refused: t("refused"),
  }[decision];
}

function compatibilityDecisionDescription(
  compatibility: StudioCompatibilityDiagnostics,
): string {
  if (compatibility.decision === "read_only") {
    return "当前版本可以读取这个工作区；写入前需要升级 AgentMesh。";
  }
  if (compatibility.decision === "refused") {
    return "当前版本不能安全读取或写入这个工作区；请升级 AgentMesh 后再继续。";
  }
  if (compatibility.metadata_state === "missing_legacy") {
    return "当前按旧工作区兼容处理，可以读取和写入；下次成功写入会自动补齐元数据。";
  }
  return "当前版本可以读取和写入这个工作区。";
}

function entrypointLabel(entrypoint: string): string {
  const labels: Record<string, string> = {
    cli: "命令行",
    codex: "Codex",
    cursor: "Cursor",
    desktop: "桌面端",
    studio: "Studio Web",
    "studio-desktop": "Studio 桌面端",
  };
  const label = labels[entrypoint] ?? entrypoint;
  return label === entrypoint ? entrypoint : `${label}（${entrypoint}）`;
}

function metadataStateLabel(state: StudioCompatibilityDiagnostics["metadata_state"]): string {
  return {
    ok: "已记录",
    missing_legacy: "旧工作区：缺少兼容性元数据",
    newer_schema: "新版本 Schema：当前版本只能只读",
    invalid: "无效：无法解析兼容性元数据",
  }[state];
}

function localizeCompatibilityReason(reason: string): string {
  const missingMetadataReason = "compatibility metadata is missing; treating workspace as legacy readable until the next successful mutation backfills it";
  if (reason === missingMetadataReason) {
    return "当前按旧工作区可读写处理，下次成功写入后会自动补齐兼容性元数据。";
  }
  const schemaMatch = /^compatibility metadata schema_version (.+) is newer than supported version (.+)$/.exec(reason);
  if (schemaMatch) {
    return `兼容性元数据 schema 版本 ${schemaMatch[1]} 高于当前支持版本 ${schemaMatch[2]}。`;
  }
  const packetSchemaMatch = /^packet_schema_version (.+) is not supported by runtime (.+)$/.exec(reason);
  if (packetSchemaMatch) {
    return `Packet schema 版本 ${packetSchemaMatch[1]} 不受当前运行时 ${packetSchemaMatch[2]} 支持。`;
  }
  const minReadMatch = /^min_read_runtime_version (.+) is newer than current runtime (.+)$/.exec(reason);
  if (minReadMatch) {
    return `最低读取版本 ${minReadMatch[1]} 高于当前运行时 ${minReadMatch[2]}。`;
  }
  const minWriteMatch = /^min_write_runtime_version (.+) is newer than current runtime (.+)$/.exec(reason);
  if (minWriteMatch) {
    return `最低写入版本 ${minWriteMatch[1]} 高于当前运行时 ${minWriteMatch[2]}。`;
  }
  return `原始诊断：${reason}`;
}

function PanelHeader({ title, meta }: { title: string; meta: string }): ReactElement {
  return (
    <Group justify="space-between" align="flex-start" gap="md">
      <Title order={2} size="h3">{title}</Title>
      <Text size="sm" c="dimmed" fw={700}>{meta}</Text>
    </Group>
  );
}
