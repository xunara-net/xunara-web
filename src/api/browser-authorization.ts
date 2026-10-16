import { ApiError, api } from "./client";

export type AuthorizationKind = "device" | "ssh";
export interface BrowserAuthorization {
  id: string;
  state: string;
  hostname?: string;
  os?: string;
  created_at: string;
  expires_at: string;
  ephemeral?: boolean;
  requested_tags?: string[];
  login_name: string;
  organization: string;
  can_write: boolean;
  csrf_token: string;
  source?: string;
  destination?: string;
  local_user?: string;
}

function invalid(): never { throw new ApiError(502, "API_RESPONSE_INVALID: invalid browser authorization response"); }
function identifier(value: string): string {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(value)) invalid();
  return value;
}
function endpoint(kind: AuthorizationKind, id: string): string {
  return `/api/v1/browser/${kind === "device" ? "device-authorizations" : "ssh-checks"}/${identifier(id)}`;
}
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

export async function getBrowserAuthorization(kind: AuthorizationKind, id: string, signal?: AbortSignal): Promise<BrowserAuthorization> {
  const payload = await api<any>(endpoint(kind, id), { signal });
  if (!payload || typeof payload.login_name !== "string" || typeof payload.organization !== "string" ||
      typeof payload.can_write !== "boolean" || typeof payload.csrf_token !== "string" || !payload.csrf_token) invalid();
  if (kind === "device") {
    if (payload.id !== id || !["pending", "approved", "denied", "expired"].includes(payload.state) ||
        typeof payload.hostname !== "string" || typeof payload.os !== "string" ||
        !timestamp(payload.created_at) || !timestamp(payload.expires_at) ||
        typeof payload.ephemeral !== "boolean" || !Array.isArray(payload.requested_tags) ||
        payload.requested_tags.some((tag: unknown) => typeof tag !== "string")) invalid();
    return payload;
  }
  const detail = payload.session;
  if (!detail || detail.id !== id || !["pending", "accepted", "rejected", "expired", "consumed"].includes(detail.state) ||
      !timestamp(detail.createdAt) || !timestamp(detail.expiresAt) || typeof detail.localUser !== "string" ||
      !detail.src || !detail.dst || !Number.isSafeInteger(detail.src.nodeId) || !Number.isSafeInteger(detail.dst.nodeId) ||
      (detail.src.hostname !== undefined && typeof detail.src.hostname !== "string") ||
      (detail.dst.hostname !== undefined && typeof detail.dst.hostname !== "string")) invalid();
  return {
    id, state: detail.state, login_name: payload.login_name, organization: payload.organization,
    can_write: payload.can_write, csrf_token: payload.csrf_token, created_at: detail.createdAt, expires_at: detail.expiresAt,
    source: detail.src.hostname || `设备 #${detail.src.nodeId}`, destination: detail.dst.hostname || `设备 #${detail.dst.nodeId}`,
    local_user: detail.localUser,
  };
}

export async function decideBrowserAuthorization(kind: AuthorizationKind, id: string, csrf: string, approve: boolean): Promise<void> {
  if (!csrf) invalid();
  const payload = await api<any>(`${endpoint(kind, id)}/${approve ? "approve" : "deny"}`, {
    method: "POST", body: {}, headers: { "X-CSRF-Token": csrf },
  });
  if (!payload || payload.id !== id || payload.state !== (kind === "device" ? (approve ? "approved" : "denied") : (approve ? "accepted" : "rejected"))) invalid();
}

export function deviceNextPath(value: unknown): string {
  if (typeof value !== "string" || !/^\/(?:t\/[a-z0-9][a-z0-9-]{0,31}\/)?(?:register\/[a-zA-Z0-9_-]{16,128}|devices)$/.test(value)) invalid();
  return value;
}

export async function getDeviceFlow(id: string, signal?: AbortSignal): Promise<{ hostname?: string; csrf_token?: string; next_path?: string }> {
  const payload = await api<any>(`/api/v1/browser/device-flows/${identifier(id)}`, { signal });
  if (payload?.next_path !== undefined) return { next_path: deviceNextPath(payload.next_path) };
  if (!payload || typeof payload.hostname !== "string" || typeof payload.csrf_token !== "string" || !payload.csrf_token) invalid();
  return payload;
}

export async function loginDeviceFlow(id: string, login: string, password: string, csrf: string): Promise<string> {
  if (!csrf) invalid();
  const payload = await api<any>(`/api/v1/browser/device-flows/${identifier(id)}/login`, {
    method: "POST", body: { login, password }, headers: { "X-CSRF-Token": csrf },
  });
  return deviceNextPath(payload?.next_path);
}

export async function getSetupState(): Promise<{ required: boolean; csrf_token?: string }> {
  const payload = await api<any>("/api/v1/auth/setup");
  if (!payload || typeof payload.required !== "boolean" || (payload.required && (typeof payload.csrf_token !== "string" || !payload.csrf_token))) invalid();
  return payload;
}

export async function setupAdministrator(body: { token: string; login: string; display_name: string; email: string; password: string; confirm: string }, csrf: string): Promise<void> {
  if (!csrf) invalid();
  await api("/api/v1/auth/setup", { method: "POST", body, headers: { "X-CSRF-Token": csrf } });
}
