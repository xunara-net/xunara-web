// Typed wrappers over the endpoints the console uses. Views call these and
// stay free of URL strings, which keeps the API version in one place.

import { ApiError, api } from "./client";
import { toAccount, toAccountSessions, toAuditEvent, toPlan, toSnapshot } from "./adapters";
import { providerLoginURL } from "../utils/auth";
import { getEnrollmentCapabilities } from "./device-enrollment";
import { organizationPattern, workspaceURL } from "../utils/console";
import type {
  AccountPayload,
  AccountPasskey,
  AccountPasskeys,
  AccountSessionsPayload,
  ApiKey,
  ProvidersPayload,
  TenantSignupResult,
  AuditEvent,
  AuditPayload,
  AuthKey,
  DERPInfo,
  Machine,
  MemberInvitation,
  MemberInvitationRequest,
  MemberInvitations,
  Organization,
  Overview,
  PendingDevice,
  PasswordChange,
  PasswordChangeResult,
  PasskeyCreationOptionsJSON,
  PasskeyRequestOptionsJSON,
  PasskeyCredentialJSON,
  PlanPayload,
  ProfileUpdate,
  Route,
  SessionRevocationResult,
  SecuritySnapshot,
  SnapshotPayload,
  User,
} from "./types";

// ---- authentication -------------------------------------------------------

export const getSession = async () => toSnapshot(await api<SnapshotPayload>("/api/v1/auth/session"));

export const getProviders = async () => {
  const payload = await api<ProvidersPayload>("/api/v1/auth/providers");
  // 未确认的初始化 / 登录配置不是关闭或开放状态；畸形响应不能启用表单。
  if (!payload || !Array.isArray(payload.providers) || typeof payload.local_login !== "boolean" ||
      typeof payload.setup_required !== "boolean" || typeof payload.passkeys !== "boolean" ||
      !["closed", "invite", "open"].includes(payload.registration) ||
      (payload.member_invitations !== undefined && typeof payload.member_invitations !== "boolean") ||
      (payload.password_reset !== undefined && typeof payload.password_reset !== "boolean") ||
      (payload.member_registration !== undefined && !["closed", "invite", "open"].includes(payload.member_registration)) ||
      payload.providers.some((provider) => !provider || typeof provider.id !== "string" || !provider.id.trim() ||
        typeof provider.name !== "string" || !provider.name.trim() || !providerLoginURL(provider.start_url, undefined, provider.id)) ||
      (payload.self_service !== undefined && (!payload.self_service || payload.self_service.endpoint !== "/api/self-service/v1/signup"))) {
    throw new Error("登录方式响应格式无效，请稍后重试或联系管理员。");
  }
  return payload;
};

/**
 * signupTenant creates a whole tenant through a deployment's sign-up desk.
 *
 * The endpoint comes from the providers payload, so a deployment that hosts
 * self-service decides where this goes; the console never guesses.
 */
export const signupTenant = (
  endpoint: string,
  body: {
    login: string;
    display_name: string;
    email: string;
    password: string;
  },
) => provisionTenant(endpoint, body);

async function provisionTenant(endpoint: string, body: { login: string; display_name: string; email: string; password: string }): Promise<TenantSignupResult> {
  if (endpoint !== "/api/self-service/v1/signup") throw new ApiError(502, "API_RESPONSE_INVALID: invalid signup endpoint");
  const result = await api<TenantSignupResult>(endpoint, { method: "POST", body, redirect: "error" });
  const org = result?.organization;
  if (!org || !organizationPattern.test(org.id) || result.authenticated !== true || typeof result.handoff !== "boolean" ||
      typeof org.domain !== "string" || typeof org.url !== "string" || typeof result.user?.login_name !== "string") {
    throw new ApiError(502, "REGISTRATION_OUTCOME_UNKNOWN: refresh the login page to check the account before retrying");
  }
  let control: URL;
  try { control = new URL(org.url); } catch { throw new ApiError(502, "REGISTRATION_OUTCOME_UNKNOWN: invalid control URL"); }
  if (!["http:", "https:"].includes(control.protocol) || control.hostname !== org.domain || control.username || control.password ||
      control.search || control.hash || !["", "/"].includes(control.pathname)) {
    throw new ApiError(502, "REGISTRATION_OUTCOME_UNKNOWN: invalid control URL");
  }
  if (org.console_url !== undefined && org.console_url !== org.url) {
    const expected = window.location.origin + workspaceURL(window.location.origin, org.id);
    if (org.console_url !== expected) throw new ApiError(502, "REGISTRATION_OUTCOME_UNKNOWN: invalid console URL");
  }
  return result;
}

export async function loginWorkspace(origin: string, organization: string, login: string, password: string): Promise<string> {
  const target = workspaceURL(origin, organization);
  const payload = await api<SnapshotPayload>(`${target}/api/v1/auth/login`, { method: "POST", body: { login, password }, redirect: "error" });
  if (payload.authenticated !== true || payload.tenant?.organization_id !== organization) {
    throw new ApiError(502, "API_RESPONSE_INVALID: tenant login was not confirmed");
  }
  return target;
}

export const login = async (login: string, password: string) =>
  toSnapshot(await api<SnapshotPayload>("/api/v1/auth/login", { method: "POST", body: { login, password } }));

export const signup = async (body: {
  invite: string;
  login: string;
  display_name: string;
  email: string;
  password: string;
}) => toSnapshot(await api<SnapshotPayload>("/api/v1/auth/signup", { method: "POST", body }));

export const beginPasskeyLogin = () =>
  api<{ options: { publicKey: PasskeyRequestOptionsJSON } }>("/api/v1/auth/passkey/begin", { method: "POST", body: {} });

export const finishPasskeyLogin = async (credential: PasskeyCredentialJSON) =>
  toSnapshot(await api<SnapshotPayload>("/api/v1/auth/passkey/finish", { method: "POST", body: credential }));

// ---- tenant overview ------------------------------------------------------

export const getOverview = () => api<Overview>("/api/v1/overview");
export const getPlan = async () => toPlan(await api<PlanPayload>("/api/v1/plan"));
export const getOrganization = () => api<Organization>("/api/v2/organization");

export const getMemberInvitations = async () => {
  const payload = await api<MemberInvitations>("/api/v1/member-invitations");
  const items = requiredList<MemberInvitation>(payload, "items");
  if (typeof payload.enabled !== "boolean" || !payload.csrf_token || !["/register", "/register?mode=invite"].includes(payload.registration_url)) {
    throw new Error("服务返回的邀请数据格式异常，请刷新重试");
  }
  return { ...payload, items };
};

export const createMemberInvitation = (body: MemberInvitationRequest, csrfToken: string) =>
  api<{ invitation: MemberInvitation; code: string }>("/api/v1/member-invitations", {
    method: "POST", body, headers: { "X-CSRF-Token": csrfToken },
  });

export const revokeMemberInvitation = (id: string, csrfToken: string) =>
  api<void>(`/api/v1/member-invitations/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "X-CSRF-Token": csrfToken },
  });

// ---- devices --------------------------------------------------------------

export const listMachines = async (): Promise<Machine[]> =>
  requiredList(await api<unknown>("/api/v1/machines"), "machines");

export const getMachine = (ref: string | number) => api<Machine>(`/api/v1/machines/${encodeURIComponent(ref)}`);

export const deleteMachine = (ref: string | number) =>
  api<void>(`/api/v1/machines/${encodeURIComponent(ref)}`, { method: "DELETE" });

export const listPendingDevices = async (): Promise<PendingDevice[]> =>
  requiredList(await api<unknown>("/api/v1/devices"), "devices");

export const approveDevice = (id: string) =>
  api<void>(`/api/v1/devices/${id}/approve`, { method: "POST", body: {} });

export const denyDevice = (id: string) =>
  api<void>(`/api/v1/devices/${id}/deny`, { method: "POST", body: {} });

// ---- network --------------------------------------------------------------

function requiredList<Value>(payload: unknown, field: string): Value[] {
  if (!payload || typeof payload !== "object" || !(field in payload)) {
    throw new Error("服务返回的数据格式异常，请刷新重试");
  }
  const value = (payload as Record<string, unknown>)[field];
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error("服务返回的数据格式异常，请刷新重试");
  return value as Value[];
}

export const listRoutes = async (): Promise<Route[]> =>
  requiredList(await api<unknown>("/api/v1/routes"), "routes");

export const getDERP = async (): Promise<DERPInfo> => {
  const payload = await api<DERPInfo>("/api/v2/derp");
  if (!payload || typeof payload.mapConfigured !== "boolean" ||
    !Number.isSafeInteger(payload.regionsServed) || payload.regionsServed < 0 || typeof payload.policyMode !== "string" || !Array.isArray(payload.regions) || payload.regionsServed !== payload.regions.length || payload.regions.some((region) => !region || !Number.isSafeInteger(region.id) || typeof region.name !== "string" || typeof region.code !== "string" || !Array.isArray(region.hosts) || region.hosts.some((host) => typeof host !== "string") || !Number.isSafeInteger(region.nodeCount))) {
    throw new Error("服务返回的中继配置格式异常，请刷新重试");
  }
  return payload;
};

// ---- account --------------------------------------------------------------

export const getAccount = async () => toAccount(await api<AccountPayload>("/api/v1/account"));

export const updateAccount = async (body: ProfileUpdate, csrfToken: string) =>
  toAccount(await api<AccountPayload>("/api/v1/account", {
    method: "PATCH", body, headers: { "X-CSRF-Token": csrfToken },
  }));

export const changePassword = async (body: PasswordChange, csrfToken: string) => {
  const payload = await api<PasswordChangeResult>("/api/v1/account/password", {
    method: "POST", body, headers: { "X-CSRF-Token": csrfToken },
  });
  if (!payload || payload.changed !== true || !Number.isSafeInteger(payload.revoked_sessions) || payload.revoked_sessions < 1) {
    throw new Error("改密响应格式不正确，结果未知；请尝试新密码登录，不要连续重复提交");
  }
  return payload;
};

export const getAccountSessions = async () =>
  toAccountSessions(await api<AccountSessionsPayload>("/api/v1/account/sessions"));

export const revokeAccountSessions = (mode: "others" | "all", csrfToken: string) =>
  api<SessionRevocationResult>("/api/v1/account/sessions/revoke", {
    method: "POST", body: { mode }, headers: { "X-CSRF-Token": csrfToken },
  });

export const revokeAccountSession = (id: string, csrfToken: string) =>
  api<SessionRevocationResult>(`/api/v1/account/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "X-CSRF-Token": csrfToken },
  });

// 通行密钥是账户安全能力，不使用网络 API Key 或套餐写权限代替 Human Session。
export const getAccountPasskeys = () => api<AccountPasskeys>("/api/v1/account/passkeys");

export const beginAccountPasskey = (csrfToken: string) =>
  api<{ options: { publicKey: PasskeyCreationOptionsJSON } }>("/api/v1/account/passkeys/begin", {
    method: "POST", body: {}, headers: { "X-CSRF-Token": csrfToken },
  });

export const finishAccountPasskey = (name: string, credential: PasskeyCredentialJSON, csrfToken: string) =>
  api<{ passkey: AccountPasskey }>("/api/v1/account/passkeys/finish", {
    method: "POST", body: { name, credential }, headers: { "X-CSRF-Token": csrfToken },
  });

export const deleteAccountPasskey = (id: string, csrfToken: string) =>
  api<void>(`/api/v1/account/passkeys/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "X-CSRF-Token": csrfToken },
  });

export const listUsers = async (): Promise<User[]> =>
  requiredList(await api<unknown>("/api/v1/users"), "users");

export const updateUser = (
  id: number,
  body: { role?: string; displayName?: string; email?: string; expectedUpdatedAt?: string },
) => api<User>(`/api/v1/users/${id}`, { method: "PATCH", body });

export const listAuthKeys = async (): Promise<AuthKey[]> =>
  requiredList(await api<unknown>("/api/v1/auth-keys"), "authKeys");

export const createAuthKey = async (body: {
  reusable: boolean;
  ephemeral: boolean;
  ttl?: string;
  tags?: string[];
}) => {
  const current = await getEnrollmentCapabilities();
  if (!current.can_manage) throw new Error("需要网络管理员权限才能创建设备密钥");
  return api<{ id: number; key: string }>("/api/v1/auth-keys", { method: "POST", headers: { "X-CSRF-Token": current.csrf_token }, body });
};

export const deleteAuthKey = async (id: number) => {
  const current = await getEnrollmentCapabilities();
  if (!current.can_manage) throw new Error("需要网络管理员权限才能撤销设备密钥");
  return api<void>(`/api/v1/auth-keys/${id}`, { method: "DELETE", headers: { "X-CSRF-Token": current.csrf_token } });
};

export const listAPIKeys = async (): Promise<ApiKey[]> =>
  requiredList(await api<unknown>("/api/v1/api-keys"), "apiKeys");

export const createAPIKey = (body: { name: string; scopes: string[]; ttl?: string }) =>
  api<{ id: string; name: string; token: string }>("/api/v1/api-keys", { method: "POST", body });

export const revokeAPIKey = (id: string) => api<void>(`/api/v1/api-keys/${id}`, { method: "DELETE" });

export const listAudit = async (limit = 100): Promise<AuditEvent[]> =>
  (
    (await api<{ events: AuditPayload[] | null }>("/api/v1/audit", { query: { limit } })).events ?? []
  ).map(toAuditEvent);

export const getSecurity = () => api<SecuritySnapshot>("/api/v2/security");
