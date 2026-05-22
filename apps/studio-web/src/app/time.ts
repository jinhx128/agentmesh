export function formatLocalDate(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }
  const date = parsedDate(value);
  return date ? dateParts(date).date : value.slice(0, 10);
}

export function formatLocalTime(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const date = parsedDate(value);
  return date ? dateParts(date).time : value;
}

export function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }
  const date = parsedDate(value);
  return date ? `${dateParts(date).date} ${dateParts(date).time}` : value;
}

export function formatUnknownLocalDateTime(value: unknown): string {
  return typeof value === "string" ? formatLocalDateTime(value) : "unknown";
}

function parsedDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateParts(date: Date): {
  date: string;
  time: string;
} {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
