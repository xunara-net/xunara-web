// Typed wrappers over the endpoints the console uses. Views call these and
// stay free of URL strings, which keeps the API version in one place.

import { api } from "./client";
import { toAccount, toAccountSessions, toAuditEvent, toPlan, toSnapshot } from "./adapters";
import { providerLoginURL } from "../utils/auth";
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
  DNSRecord,
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
  ManagedRelay,
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
) => api<TenantSignupResult>(endpoint, { method: "POST", body });

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
  if (typeof payload.enabled !== "boolean" || !payload.csrf_token || payload.registration_url !== "/register") {
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
  (await api<{ machines: Machine[] | null }>("/api/v1/machines")).machines ?? [];

export const getMachine = (ref: string | number) => api<Machine>(`/api/v1/machines/${ref}`);

export const deleteMachine = (ref: string | number) =>
  api<void>(`/api/v1/machines/${ref}`, { method: "DELETE" });

export const setMachineRoutes = (ref: string | number, routes: string[]) =>
  api<{ approvedRoutes?: string[] }>(`/api/v1/machines/${ref}/routes`, {
    method: "POST",
    body: { routes },
  });

export const listPendingDevices = async (): Promise<PendingDevice[]> =>
  (await api<{ devices: PendingDevice[] | null }>("/api/v1/devices")).devices ?? [];

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

export const listDNS = async (): Promise<DNSRecord[]> =>
  (await api<{ records: DNSRecord[] | null }>("/api/v1/dns")).records ?? [];

export const deleteDNS = (id: number) => api<void>(`/api/v1/dns/${id}`, { method: "DELETE" });

export const getPolicy = () =>
  api<{
    configured: boolean;
    path?: string;
    rules?: number;
    warnings?: string[];
    unsupported?: string[];
    loadError?: string;
  }>("/api/v1/policy");

export const getDERP = async (): Promise<DERPInfo> => {
  const payload = await api<DERPInfo>("/api/v2/derp");
  if (!payload || typeof payload.mapConfigured !== "boolean" ||
    !Number.isSafeInteger(payload.regionsServed) || payload.regionsServed < 0) {
    throw new Error("服务返回的中继配置格式异常，请刷新重试");
  }
  return payload;
};

export const listManagedRelays = async (): Promise<ManagedRelay[]> => {
  // /relays 是客户端 Peer Relay 策略；托管 DERP 必须读取 /relays/enrolled，不能混为一谈。
  const items = requiredList<ManagedRelay>(await api<unknown>("/api/v2/relays/enrolled"), "items");
  if (items.some((relay) => !relay || typeof relay.id !== "string" || !relay.id ||
    typeof relay.online !== "boolean" || typeof relay.healthy !== "boolean" || typeof relay.desiredState !== "string")) {
    throw new Error("服务返回的托管中继格式异常，请刷新重试");
  }
  return items;
};

export const listExitNodes = async (): Promise<unknown[]> =>
  requiredList(await api<unknown>("/api/v2/exit-nodes"), "exitNodes");

// ---- account --------------------------------------------------------------

export const getAccount = async () => toAccount(await api<AccountPayload>("/api/v1/account"));

export const updateAccount = async (body: ProfileUpdate, csrfToken: string) =>
  toAccount(await api<AccountPayload>("/api/v1/account", {
    method: "PATCH", body, headers: { "X-CSRF-Token": csrfToken },
  }));

export const changePassword = (body: PasswordChange, csrfToken: string) =>
  api<PasswordChangeResult>("/api/v1/account/password", {
    method: "POST", body, headers: { "X-CSRF-Token": csrfToken },
  });

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
  body: { role?: string; displayName?: string; email?: string },
) => api<User>(`/api/v1/users/${id}`, { method: "PATCH", body });

export const listAuthKeys = async (): Promise<AuthKey[]> =>
  (await api<{ authKeys: AuthKey[] | null }>("/api/v1/auth-keys")).authKeys ?? [];

export const createAuthKey = (body: {
  reusable: boolean;
  ephemeral: boolean;
  ttl?: string;
  tags?: string[];
}) => api<{ id: number; key: string }>("/api/v1/auth-keys", { method: "POST", body });

export const deleteAuthKey = (id: number) =>
  api<void>(`/api/v1/auth-keys/${id}`, { method: "DELETE" });

export const listAPIKeys = async (): Promise<ApiKey[]> =>
  (await api<{ apiKeys: ApiKey[] | null }>("/api/v1/api-keys")).apiKeys ?? [];

export const createAPIKey = (body: { name: string; scopes: string[]; ttl?: string }) =>
  api<{ id: string; name: string; token: string }>("/api/v1/api-keys", { method: "POST", body });

export const revokeAPIKey = (id: string) => api<void>(`/api/v1/api-keys/${id}`, { method: "DELETE" });

export const listAudit = async (limit = 100): Promise<AuditEvent[]> =>
  (
    (await api<{ events: AuditPayload[] | null }>("/api/v1/audit", { query: { limit } })).events ?? []
  ).map(toAuditEvent);

export const getSecurity = () => api<SecuritySnapshot>("/api/v2/security");
