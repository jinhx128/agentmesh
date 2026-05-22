import {
  Select,
} from "@mantine/core";
import type {
  ReactElement,
} from "react";

export const AUTO_REFRESH_SECONDS = [0, 5, 10, 15, 30, 60] as const;

export type AutoRefreshSeconds = (typeof AUTO_REFRESH_SECONDS)[number];

export interface AutoRefreshSelectProps {
  value: AutoRefreshSeconds;
  ariaLabel: string;
  onChange: (seconds: AutoRefreshSeconds) => void;
}

export function AutoRefreshSelect({
  value,
  ariaLabel,
  onChange,
}: AutoRefreshSelectProps): ReactElement {
  return (
    <Select
      className="studio-auto-refresh-select"
      data-studio-section="navigator-auto-refresh"
      aria-label={ariaLabel}
      title={ariaLabel}
      size="xs"
      value={String(value)}
      data={AUTO_REFRESH_SECONDS.map((seconds) => ({
        value: String(seconds),
        label: autoRefreshLabel(seconds),
      }))}
      allowDeselect={false}
      onChange={(nextValue) => onChange(parseAutoRefreshSeconds(nextValue ?? "0"))}
    />
  );
}

export function parseAutoRefreshSeconds(value: string): AutoRefreshSeconds {
  const parsed = Number(value);
  return AUTO_REFRESH_SECONDS.includes(parsed as AutoRefreshSeconds)
    ? parsed as AutoRefreshSeconds
    : 0;
}

function autoRefreshLabel(seconds: AutoRefreshSeconds): string {
  return seconds === 0 ? "Off" : `${seconds}s`;
}
