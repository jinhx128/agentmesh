import {
  createStudioApiClient,
  type StudioApiClient,
  type StudioFetch,
} from "./client.js";

export interface StudioBootstrapPayload {
  schema_version: 1;
  authenticated: boolean;
  workspace: string;
  api_base_url: string;
}

export interface StudioBootstrapResult {
  bootstrap: StudioBootstrapPayload;
  client: StudioApiClient;
}

export interface StudioBootstrapOptions {
  baseUrl?: string;
  location?: StudioBootstrapLocation;
  history?: StudioBootstrapHistory;
  fetch?: StudioFetch;
}

export type StudioBootstrapLocation = URL | {
  href?: string;
  origin?: string;
  search?: string;
};

export interface StudioBootstrapHistory {
  replaceState(data: unknown, title: string, url?: string | URL | null): void;
}

export async function bootstrapStudio(
  options: StudioBootstrapOptions = {},
): Promise<StudioBootstrapResult> {
  const location = options.location ?? browserLocation();
  const baseUrl = options.baseUrl ?? baseUrlFromLocation(location);
  const bootstrapClient = createStudioApiClient({
    baseUrl,
    fetch: options.fetch,
  });
  const bootstrap = await bootstrapClient.getJson<StudioBootstrapPayload>("/api/bootstrap");
  removeLaunchTokenFromHistory(location, options.history ?? browserHistory());
  return {
    bootstrap,
    client: createStudioApiClient({
      baseUrl: bootstrap.api_base_url || baseUrl,
      fetch: options.fetch,
    }),
  };
}

function removeLaunchTokenFromHistory(
  location: StudioBootstrapLocation | undefined,
  history: StudioBootstrapHistory | undefined,
): void {
  const cleanedUrl = urlWithoutLaunchToken(location);
  if (!cleanedUrl || !history) {
    return;
  }
  history.replaceState(null, "", cleanedUrl);
}

function urlWithoutLaunchToken(location: StudioBootstrapLocation | undefined): string | undefined {
  const url = urlFromLocation(location);
  if (!url || !url.searchParams.has("token")) {
    return undefined;
  }
  url.searchParams.delete("token");
  return url.toString();
}

function urlFromLocation(location: StudioBootstrapLocation | undefined): URL | undefined {
  if (!location) {
    return undefined;
  }
  if (location instanceof URL) {
    return new URL(location.toString());
  }
  if (location.href && location.href.length > 0) {
    return new URL(location.href);
  }
  if (location.origin && location.search) {
    return new URL(`${location.origin}${location.search}`);
  }
  return undefined;
}

function baseUrlFromLocation(location: StudioBootstrapLocation | undefined): string {
  if (!location) {
    return "";
  }
  if (location instanceof URL) {
    return location.origin;
  }
  if (location.origin && location.origin.length > 0) {
    return location.origin;
  }
  if (location.href && location.href.length > 0) {
    return new URL(location.href).origin;
  }
  return "";
}

function browserLocation(): StudioBootstrapLocation | undefined {
  return (globalThis as { location?: StudioBootstrapLocation }).location;
}

function browserHistory(): StudioBootstrapHistory | undefined {
  return (globalThis as { history?: StudioBootstrapHistory }).history;
}
