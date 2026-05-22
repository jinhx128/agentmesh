export type StudioFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type StudioApiErrorKind = "auth" | "http" | "network" | "parse";

export interface StudioApiErrorOptions {
  kind: StudioApiErrorKind;
  message: string;
  url: string;
  status?: number;
}

export class StudioApiError extends Error {
  readonly kind: StudioApiErrorKind;
  readonly url: string;
  readonly status?: number;

  constructor(options: StudioApiErrorOptions) {
    super(options.message);
    this.name = "StudioApiError";
    this.kind = options.kind;
    this.url = options.url;
    this.status = options.status;
  }
}

export interface StudioApiClient {
  getJson<T>(path: string): Promise<T>;
  postJson<T>(path: string, body: unknown): Promise<T>;
  putJson<T>(path: string, body: unknown): Promise<T>;
  postJsonWithStatus<T>(path: string, body: unknown): Promise<StudioApiJsonResponse<T>>;
  putJsonWithStatus<T>(path: string, body: unknown): Promise<StudioApiJsonResponse<T>>;
  deleteJsonWithStatus<T>(path: string): Promise<StudioApiJsonResponse<T>>;
}

export interface StudioApiJsonResponse<T> {
  ok: boolean;
  status: number;
  payload: T;
}

export interface StudioApiClientOptions {
  baseUrl?: string;
  token?: string;
  fetch?: StudioFetch;
}

interface RequestJsonOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}

export function createStudioApiClient(options: StudioApiClientOptions = {}): StudioApiClient {
  const baseUrl = options.baseUrl ?? "";
  const token = normalizeToken(options.token);
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return {
    getJson: <T>(path: string) =>
      requestJson<T>(path, { method: "GET" }, { baseUrl, token, fetchImpl }),
    postJson: <T>(path: string, body: unknown) =>
      requestJson<T>(path, { method: "POST", body }, { baseUrl, token, fetchImpl }),
    putJson: <T>(path: string, body: unknown) =>
      requestJson<T>(path, { method: "PUT", body }, { baseUrl, token, fetchImpl }),
    postJsonWithStatus: <T>(path: string, body: unknown) =>
      requestJsonWithStatus<T>(path, { method: "POST", body }, { baseUrl, token, fetchImpl }),
    putJsonWithStatus: <T>(path: string, body: unknown) =>
      requestJsonWithStatus<T>(path, { method: "PUT", body }, { baseUrl, token, fetchImpl }),
    deleteJsonWithStatus: <T>(path: string) =>
      requestJsonWithStatus<T>(path, { method: "DELETE" }, { baseUrl, token, fetchImpl }),
  };
}

export function normalizeStudioApiError(error: unknown): StudioApiError {
  if (error instanceof StudioApiError) {
    return error;
  }
  return new StudioApiError({
    kind: "network",
    message: "Network request failed",
    url: "",
  });
}

export function redactStudioApiUrl(url: string, token?: string): string {
  return redactSensitiveText(url.replace(/([?&]token=)[^&#]*/g, "$1<redacted>"), token);
}

async function requestJson<T>(
  path: string,
  request: RequestJsonOptions,
  options: {
    baseUrl: string;
    token: string | undefined;
    fetchImpl: StudioFetch;
  },
): Promise<T> {
  const url = buildApiUrl(path, options.baseUrl);
  const redactedUrl = redactStudioApiUrl(url, options.token);
  const headers = new Headers({ accept: "application/json" });
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    credentials: "same-origin",
  };
  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(request.body);
  }

  let response: Response;
  try {
    response = await options.fetchImpl(url, init);
  } catch {
    throw new StudioApiError({
      kind: "network",
      message: "Network request failed",
      url: redactedUrl,
    });
  }

  if (!response.ok) {
    throw await errorFromResponse(response, redactedUrl, options.token);
  }
  return readResponseJson<T>(response, redactedUrl, options.token);
}

async function requestJsonWithStatus<T>(
  path: string,
  request: RequestJsonOptions,
  options: {
    baseUrl: string;
    token: string | undefined;
    fetchImpl: StudioFetch;
  },
): Promise<StudioApiJsonResponse<T>> {
  const url = buildApiUrl(path, options.baseUrl);
  const redactedUrl = redactStudioApiUrl(url, options.token);
  const headers = new Headers({ accept: "application/json" });
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    credentials: "same-origin",
  };
  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(request.body);
  }

  let response: Response;
  try {
    response = await options.fetchImpl(url, init);
  } catch {
    throw new StudioApiError({
      kind: "network",
      message: "Network request failed",
      url: redactedUrl,
    });
  }

  return {
    ok: response.ok,
    status: response.status,
    payload: await readResponseJson<T>(response, redactedUrl, options.token),
  };
}

function buildApiUrl(path: string, baseUrl: string): string {
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (baseUrl.trim().length === 0) {
    return normalizedPath;
  }
  return new URL(normalizedPath, baseUrl).toString();
}

async function readResponseJson<T>(
  response: Response,
  redactedUrl: string,
  token: string | undefined,
): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new StudioApiError({
      kind: "parse",
      message: redactSensitiveText("Invalid JSON response", token),
      url: redactedUrl,
      status: response.status,
    });
  }
}

async function errorFromResponse(
  response: Response,
  redactedUrl: string,
  token: string | undefined,
): Promise<StudioApiError> {
  if (response.status === 401) {
    return new StudioApiError({
      kind: "auth",
      message: "Authentication required",
      url: redactedUrl,
      status: response.status,
    });
  }
  return new StudioApiError({
    kind: "http",
    message: redactSensitiveText(await responseErrorMessage(response), token),
    url: redactedUrl,
    status: response.status,
  });
}

async function responseErrorMessage(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;
  const text = await response.text();
  if (text.trim().length === 0) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === "string" && parsed.error.trim().length > 0
      ? parsed.error
      : fallback;
  } catch {
    return fallback;
  }
}

function normalizeToken(token: string | undefined): string | undefined {
  const trimmed = token?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function redactSensitiveText(value: string, token: string | undefined): string {
  let redacted = value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>");
  if (token) {
    redacted = redacted.split(token).join("<redacted>");
  }
  return redacted;
}
