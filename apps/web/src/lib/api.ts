/**
 * Typed client for the local WebPilot API.
 *
 * Every call targets the loopback API on the user's own machine (override with
 * `VITE_WEBPILOT_API_URL`). Responses are typed with the shared contracts from
 * `@webpilot/schemas`, so the dashboard cannot drift from the API silently.
 */
import type {
  AgentEvent,
  DownloadRecord,
  PermissionRequest,
  Task,
} from "@webpilot/schemas";

/** Loopback by default: the dashboard talks to the agent, never to the internet. */
export const API_BASE: string =
  (import.meta.env?.VITE_WEBPILOT_API_URL as string | undefined) ?? "http://127.0.0.1:8787";

/** WebSocket URL for a task's live event stream. */
export function eventsUrl(taskId: string): string {
  return `${API_BASE.replace(/^http/, "ws")}/ws/tasks/${encodeURIComponent(taskId)}`;
}

export interface ModelStatus {
  modelId: string;
  quantization: string;
  embeddingModelId: string;
  execution: string;
  networkInference: string;
  status: "loaded" | "not-loaded" | "unavailable" | "disabled";
  embeddingStatus: "loaded" | "not-loaded" | "unavailable" | "disabled";
  unavailable: string | null;
  embeddingUnavailable: string | null;
}

export interface BrowserStatus {
  status: string;
  engine: string;
  headless: boolean;
  maxTabs: number;
}

export interface ActivitySnapshot {
  activeTaskId: string | null;
  queueLength: number;
  pendingPermissions: number;
  eventsSubscribers: number;
}

export interface SettingsSnapshot {
  limits: {
    maxAgentSteps: number;
    maxDownloads: number;
    maxFileSizeMb: number;
    maxTaskTimeMs: number;
  };
  safety: {
    downloadAllowlist: string[];
    allowlistActive: boolean;
    requireDownloadConfirmation: boolean;
  };
  ai: { enabled: boolean; modelId: string; quantization: string; embeddingModelId: string };
}

/** A failed request, with the API's error code when it sent one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(
      `Cannot reach the local API at ${API_BASE}. Start it with \`bun run api\`.`,
      0,
    );
  }

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: { message?: string } }).error?.message ?? "Request failed")
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return body as T;
}

export const api = {
  createTask: (prompt: string) =>
    request<{ task: Task }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  listTasks: (limit = 20) => request<{ tasks: Task[]; queueLength: number }>(
    `/tasks?limit=${limit}`,
  ),

  getTask: (taskId: string) => request<{ task: Task }>(`/tasks/${encodeURIComponent(taskId)}`),

  listEvents: (taskId: string, since = -1) =>
    request<{ events: AgentEvent[] }>(
      `/tasks/${encodeURIComponent(taskId)}/events?since=${since}`,
    ),

  cancelTask: (taskId: string) =>
    request<{ cancelled: boolean; task: Task }>(
      `/tasks/${encodeURIComponent(taskId)}/cancel`,
      { method: "POST" },
    ),

  pendingPermissions: (taskId: string) =>
    request<{ permissions: PermissionRequest[] }>(
      `/tasks/${encodeURIComponent(taskId)}/permissions`,
    ),

  decidePermission: (
    taskId: string,
    permissionId: string,
    decision: { grant: boolean; remember?: boolean },
  ) =>
    request<{ accepted: boolean }>(
      `/tasks/${encodeURIComponent(taskId)}/permissions/${encodeURIComponent(permissionId)}`,
      { method: "POST", body: JSON.stringify(decision) },
    ),

  listDownloads: (taskId?: string) =>
    request<{ downloads: DownloadRecord[] }>(
      taskId ? `/downloads?taskId=${encodeURIComponent(taskId)}` : "/downloads",
    ),

  modelStatus: () => request<{ model: ModelStatus }>("/models"),

  browserStatus: () => request<{ browser: BrowserStatus }>("/browser"),

  activity: () => request<ActivitySnapshot>("/activity"),

  settings: () => request<{ settings: SettingsSnapshot }>("/settings"),
};

/** Download URL for one file inside a task folder. */
export function downloadFileUrl(taskId: string, filename: string): string {
  return `${API_BASE}/downloads/${encodeURIComponent(taskId)}/files/${filename
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}