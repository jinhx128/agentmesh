import type {
  StudioApiClient,
  StudioApiJsonResponse,
} from "./client.js";

export type StudioMutationAction = "dispatch" | "retry" | "resume" | "attach";

export type StudioMutationRequest =
  | {
      action: "dispatch";
      run_id: string;
      stage: string;
    }
  | {
      action: "retry";
      run_id: string;
      stage?: string;
    }
  | {
      action: "resume";
      run_id: string;
      stage?: string;
    }
  | {
      action: "attach";
      run_id: string;
      stage: string;
      text?: string;
      file?: string;
      agent?: string;
    };

export interface StudioMutationPayload {
  action?: StudioMutationAction;
  command?: string[];
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  duration_ms?: number;
  error?: string;
  error_code?: StudioMutationErrorCode;
  retryable?: boolean;
  lock?: StudioMutationLock;
}

export type StudioMutationResponse = StudioApiJsonResponse<StudioMutationPayload>;

export type StudioMutationErrorCode =
  | "run_locked"
  | "workspace_read_only"
  | "workspace_refused"
  | "mutation_failed";

export interface StudioMutationLock {
  lock_dir?: string;
  operation?: string;
  entrypoint?: string;
  runtime_version?: string;
  pid?: number;
  operation_id?: string;
  command?: string;
  heartbeat_at?: string;
  expires_at?: string;
}

export function submitStudioMutation(
  client: StudioApiClient,
  request: StudioMutationRequest,
): Promise<StudioMutationResponse> {
  return client.postJsonWithStatus<StudioMutationPayload>("/api/mutations", request);
}
