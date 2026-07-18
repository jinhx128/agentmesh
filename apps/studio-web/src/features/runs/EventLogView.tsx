import {
  Alert,
  Badge,
  Card,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { ReactElement } from "react";
import type { StudioRunDetail, StudioRunEvent } from "../../api/runs.js";
import { useStudioCopy } from "../../app/copy.js";
import { workflowStageLabel } from "../../app/stages.js";
import { formatUnknownLocalDateTime } from "../../app/time.js";
import type { AgentDisplayNames } from "./RunOverview.js";

export interface EventLogViewProps {
  detail: StudioRunDetail;
  agentLabels?: AgentDisplayNames;
}

export function EventLogView({ detail, agentLabels }: EventLogViewProps): ReactElement {
  const { t } = useStudioCopy();
  const events = sortStudioEventsDescending(detail.events);
  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-event-log" withBorder radius="md" p="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Title order={2} size="h3">{t("events")}</Title>
        <Text size="sm" c="dimmed" fw={700}>{eventCountLabel(detail.events_page, events.length)}</Text>
      </Group>
      <Stack mt="md" gap="sm">
        {events.length > 0 ? events.map((event, index) => {
          const fields = eventFieldSummary(event, agentLabels);
          return (
            <Card withBorder radius="md" p="md" key={eventKey(event, index)}>
              <Group justify="space-between" align="flex-start" gap="md">
                <Text fw={800}>{eventDisplayName(event.event)}</Text>
                <Badge color={isFailureEvent(event) ? "red" : "gray"}>{formatTimestamp(eventStartedAt(event))}</Badge>
              </Group>
              {fields.length > 0 ? (
                <Group mt="sm" gap={6}>
                  {fields.map((field) => (
                    <Badge className="event-field-badge" variant="light" color="gray" key={field}>{field}</Badge>
                  ))}
                </Group>
              ) : null}
            </Card>
          );
        }) : <Alert variant="light">{t("latestEventFallback")}</Alert>}
      </Stack>
    </Paper>
  );
}

export function sortStudioEventsDescending(events: StudioRunEvent[]): StudioRunEvent[] {
  return [...events]
    .map((event, index) => ({
      event,
      index,
      time: timestampMillis(eventStartedAt(event)) ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((left, right) => {
      if (left.time !== right.time) {
        return right.time - left.time;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.event);
}

function eventCountLabel(
  page: StudioRunDetail["events_page"],
  shownCount: number,
): string {
  if (!page || page.total <= shownCount) {
    return `${shownCount} 个事件`;
  }
  const start = page.offset + 1;
  const end = page.offset + shownCount;
  if (end === page.total) {
    return `最新 ${shownCount} / 共 ${page.total} 个事件`;
  }
  return `显示 ${start}-${end} / 共 ${page.total} 个事件`;
}

function eventKey(event: StudioRunEvent, index: number): string {
  return [
    event.timestamp,
    event.event,
    event.stage,
    index,
  ].filter(Boolean).join(":");
}

function eventStartedAt(event: StudioRunEvent): unknown {
  return typeof event.started_at === "string" && event.started_at.length > 0
    ? event.started_at
    : event.timestamp;
}

function isFailureEvent(event: StudioRunEvent): boolean {
  return String(event.event ?? "").includes("failed") ||
    event.error !== undefined ||
    event.timed_out === true ||
    (typeof event.exit_code === "number" && event.exit_code !== 0);
}

function eventFieldSummary(event: StudioRunEvent, agentLabels?: AgentDisplayNames): string[] {
  return Object.entries(event)
    .filter(([key]) => !["schema_version", "timestamp", "event"].includes(key))
    .map(([key, value]) => `${eventFieldLabel(key)}: ${compactValue(value, key, agentLabels)}`)
    .filter((field) => !field.endsWith(": "));
}

function eventDisplayName(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "事件";
  }
  return EVENT_LABELS[value] ?? value;
}

function eventFieldLabel(key: string): string {
  return EVENT_FIELD_LABELS[key] ?? key;
}

function compactValue(value: unknown, key?: string, agentLabels?: AgentDisplayNames): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return localizedScalarValue(value, key, agentLabels);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return localizedScalarValue(String(value), key, agentLabels);
  }
  if (Array.isArray(value)) {
    return value.map((item) => compactValue(item, key, agentLabels)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([itemKey, item]) => `${eventFieldLabel(itemKey)}=${compactValue(item, itemKey, agentLabels)}`)
      .filter((item) => !item.endsWith("="))
      .join(", ");
  }
  return String(value);
}

function localizedScalarValue(value: string, key?: string, agentLabels?: AgentDisplayNames): string {
  if (isAgentFieldKey(key)) {
    return agentDisplayName(value, agentLabels);
  }
  if (key === "stage" || key === "stage_type" || key === "node_id" || key === "stages" || key === "id" || key === "type") {
    return workflowStageLabel(value);
  }
  if (key === "status") {
    return STATUS_VALUE_LABELS[value] ?? value;
  }
  if (key === "artifact") {
    return artifactValueLabel(value);
  }
  if (key === "timed_out") {
    return value === "true" ? "是" : value === "false" ? "否" : value;
  }
  return value;
}

function isAgentFieldKey(key?: string): boolean {
  return key === "agent" ||
    key === "agents" ||
    key === "actual_agent" ||
    key === "primary_agent" ||
    key === "requested_agent" ||
    key?.endsWith("_agent") === true ||
    key?.endsWith("_agents") === true;
}

function agentDisplayName(agent: string, agentLabels?: AgentDisplayNames): string {
  const label = agentLabels?.[agent]?.trim();
  return label && label !== agent ? label : agent;
}

function artifactValueLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === "findings") {
    return "审查发现";
  }
  if (normalized === "decision") {
    return "决策";
  }
  if (normalized === "context") {
    return "上下文";
  }
  if (normalized === "request") {
    return "请求";
  }
  if (normalized === "status") {
    return "状态";
  }
  if (normalized.startsWith("review_")) {
    return "审查输出";
  }
  return value;
}

function formatTimestamp(value: unknown): string {
  return formatUnknownLocalDateTime(value);
}

function timestampMillis(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

const EVENT_LABELS: Record<string, string> = {
  "artifact.written": "产物写入",
  "release.verdict.recorded": "发布结论记录",
  "review.completed": "审查完成",
  "reviewer_session.closed": "会话已关闭",
  "reviewer_session.created": "会话已创建",
  "reviewer_session.expired": "会话已过期",
  "reviewer_session.fallback_fresh": "已回退到新会话",
  "reviewer_session.fresh_isolated": "已使用隔离新会话",
  "reviewer_session.resume_failed": "会话恢复失败",
  "reviewer_session.resumed": "会话已恢复",
  "reviewer_session.rotated": "会话已轮换",
  "run.created": "运行创建",
  "stage.agent_completed": "智能体完成",
  "stage.agent_failed": "智能体失败",
  "stage.agent_reused": "智能体复用",
  "stage.agent_started": "智能体开始",
  "stage.completed": "阶段完成",
  "stage.failed": "阶段失败",
  "stage.started": "阶段开始",
};

const EVENT_FIELD_LABELS: Record<string, string> = {
  actual_agent: "实际智能体",
  agent: "智能体",
  agents: "智能体列表",
  artifact: "产物",
  duration_ms: "耗时",
  error: "错误",
  exit_code: "退出码",
  hermetic: "独立上下文",
  id: "节点",
  kind: "类型",
  message: "消息",
  node_id: "节点",
  occurrence: "序号",
  path: "路径",
  primary_agent: "主智能体",
  reason: "原因",
  requested_agent: "请求智能体",
  session_mode: "会话模式",
  session_ref: "会话引用",
  run_id: "运行",
  stage: "阶段",
  stage_nodes: "阶段节点",
  stage_type: "阶段类型",
  stages: "阶段列表",
  status: "状态",
  timed_out: "超时",
  type: "类型",
  verdict: "结论",
  workflow: "流程",
};

const STATUS_VALUE_LABELS: Record<string, string> = {
  accepted: "已接受",
  completed: "已完成",
  current: "当前",
  failed: "失败",
  needs_decision: "需要决策",
  ok: "正常",
  pending: "等待",
  ready: "就绪",
  rejected: "已拒绝",
  running: "运行中",
  started: "已开始",
};
