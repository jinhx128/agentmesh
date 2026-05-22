import {
  Alert,
  Badge,
  Button,
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
import { formatUnknownLocalDateTime } from "../../app/time.js";

export interface EventLogViewProps {
  detail: StudioRunDetail;
  onSelectEventOffset: (offset: number) => void;
}

export function EventLogView({ detail, onSelectEventOffset }: EventLogViewProps): ReactElement {
  const { t } = useStudioCopy();
  const events = sortStudioEventsDescending(detail.events);
  const page = detail.events_page;
  const pager = eventPager(page, events.length);
  return (
    <Paper component="section" className="studio-panel" data-studio-section="react-event-log" withBorder radius="md" p="lg">
      <Group justify="space-between" align="flex-start" gap="md">
        <Title order={2} size="h3">{t("events")}</Title>
        <Text size="sm" c="dimmed" fw={700}>{pager.label}</Text>
      </Group>
      <Group mt="md" aria-label={t("eventPagination")}>
        <Button
          type="button"
          variant="light"
          data-event-offset={pager.olderOffset}
          disabled={!pager.canGoOlder}
          onClick={() => onSelectEventOffset(pager.olderOffset)}
        >
          更早
        </Button>
        <Button
          type="button"
          variant="light"
          data-event-offset={pager.newestOffset}
          disabled={!pager.canGoNewest}
          onClick={() => onSelectEventOffset(pager.newestOffset)}
        >
          最新
        </Button>
        <Button
          type="button"
          variant="light"
          data-event-offset={pager.newerOffset}
          disabled={!pager.canGoNewer}
          onClick={() => onSelectEventOffset(pager.newerOffset)}
        >
          更新
        </Button>
      </Group>
      <Stack mt="md" gap="sm">
        {events.length > 0 ? events.map((event, index) => (
          <Card withBorder radius="md" p="md" key={eventKey(event, index)}>
            <Group justify="space-between" align="flex-start" gap="md">
              <Text fw={800}>{event.event ?? "event"}</Text>
              <Badge color={isFailureEvent(event) ? "red" : "gray"}>{formatTimestamp(event.timestamp)}</Badge>
            </Group>
            {eventFieldSummary(event).length > 0 ? (
              <Group mt="sm" gap={6}>
                {eventFieldSummary(event).map((field) => (
                  <Badge variant="light" color="gray" key={field}>{field}</Badge>
                ))}
              </Group>
            ) : null}
          </Card>
        )) : <Alert variant="light">{t("latestEventFallback")}</Alert>}
      </Stack>
    </Paper>
  );
}

export function sortStudioEventsDescending(events: StudioRunEvent[]): StudioRunEvent[] {
  return [...events]
    .map((event, index) => ({
      event,
      index,
      time: timestampMillis(event.timestamp) ?? Number.NEGATIVE_INFINITY,
    }))
    .sort((left, right) => {
      if (left.time !== right.time) {
        return right.time - left.time;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.event);
}

function eventPager(
  page: StudioRunDetail["events_page"],
  shownCount: number,
): {
  label: string;
  olderOffset: number;
  newerOffset: number;
  newestOffset: number;
  canGoOlder: boolean;
  canGoNewer: boolean;
  canGoNewest: boolean;
} {
  if (!page || page.total <= 0) {
    return {
      label: `${shownCount} 个事件`,
      olderOffset: 0,
      newerOffset: 0,
      newestOffset: 0,
      canGoOlder: false,
      canGoNewer: false,
      canGoNewest: false,
    };
  }
  const limit = page.limit > 0 ? page.limit : 50;
  const offset = Math.max(0, page.offset);
  const total = Math.max(0, page.total);
  const latestOffset = Math.max(0, total - limit);
  const start = Math.min(total, offset + 1);
  const end = Math.min(total, offset + shownCount);
  return {
    label: `${start}-${end} / ${total}`,
    olderOffset: Math.max(0, offset - limit),
    newerOffset: Math.min(latestOffset, offset + limit),
    newestOffset: latestOffset,
    canGoOlder: offset > 0,
    canGoNewer: offset < latestOffset,
    canGoNewest: offset < latestOffset,
  };
}

function eventKey(event: StudioRunEvent, index: number): string {
  return [
    event.timestamp,
    event.event,
    event.stage,
    index,
  ].filter(Boolean).join(":");
}

function isFailureEvent(event: StudioRunEvent): boolean {
  return String(event.event ?? "").includes("failed") ||
    event.error !== undefined ||
    event.timed_out === true ||
    (typeof event.exit_code === "number" && event.exit_code !== 0);
}

function eventFieldSummary(event: StudioRunEvent): string[] {
  return Object.entries(event)
    .filter(([key]) => !["schema_version", "timestamp", "event"].includes(key))
    .map(([key, value]) => `${key}: ${compactValue(value)}`)
    .filter((field) => !field.endsWith(": "));
}

function compactValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(compactValue).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => `${key}=${compactValue(item)}`)
      .filter((item) => !item.endsWith("="))
      .join(", ");
  }
  return String(value);
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
