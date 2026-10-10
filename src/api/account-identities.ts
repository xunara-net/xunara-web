import { api } from "./client";

export interface AccountIdentity {
  id: string;
  provider_id: string;
  provider_name: string;
  email: string;
  display_name: string;
  created_at: string;
  enabled: boolean;
}
export interface AccountIdentities {
  items: AccountIdentity[];
  providers: { id: string; name: string }[];
  csrf_token: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalid(): never { throw new Error("账户绑定响应格式异常，请刷新或联系管理员"); }

export async function getAccountIdentities(): Promise<AccountIdentities> {
  const payload = await api<AccountIdentities>("/api/v1/account/identities");
  if (!object(payload) || !Array.isArray(payload.items) || !Array.isArray(payload.providers) || typeof payload.csrf_token !== "string" || !payload.csrf_token ||
    !payload.items.every((item) => object(item) && typeof item.id === "string" && /^[a-f0-9]{64}$/.test(item.id) &&
      [item.provider_id, item.provider_name, item.email, item.display_name, item.created_at].every((value) => typeof value === "string") && typeof item.enabled === "boolean") ||
    !payload.providers.every((provider) => object(provider) && typeof provider.id === "string" && provider.id && typeof provider.name === "string")) invalid();
  return payload;
}

export async function beginAccountIdentity(providerID: string, csrfToken: string): Promise<string> {
  const payload = await api<{ authorization_url: string }>("/api/v1/account/identities/begin", {
    method: "POST", body: { provider_id: providerID }, headers: { "X-CSRF-Token": csrfToken },
  });
  return authorizationURL(payload);
}

export async function beginInvitedIdentity(providerID: string, invite: string, registrationToken: string): Promise<string> {
  // 邀请码只放正文；不能拼接进第三方跳转 URL、日志或浏览器持久存储。
  return authorizationURL(await api<{ authorization_url: string }>("/api/v1/auth/invite/start", {
    method: "POST", body: { provider_id: providerID, invite, registration_token: registrationToken },
  }));
}

function authorizationURL(payload: unknown): string {
  if (!object(payload) || typeof payload.authorization_url !== "string") invalid();
  const target = new URL(payload.authorization_url);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (target.username || target.password || target.hash || target.protocol !== "https:" && !(target.protocol === "http:" && loopback)) invalid();
  return target.href;
}

export async function unlinkAccountIdentity(id: string, csrfToken: string): Promise<boolean> {
  const payload = await api<{ current_revoked: boolean }>(`/api/v1/account/identities/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { "X-CSRF-Token": csrfToken },
  });
  if (!object(payload) || typeof payload.current_revoked !== "boolean") invalid();
  return payload.current_revoked;
}
