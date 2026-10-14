import { api } from "./client";

export type ShareStatus = "pending" | "accepted" | "rejected" | "revoked";
export interface DeviceShare {
  id: string;
  status: ShareStatus;
  direction: "incoming" | "outgoing";
  node: { stableId?: string; hostname?: string; os?: string; missing?: boolean };
  sourceOrganization: string;
  targetOrganization: string;
  createdBy?: string;
  targetUser?: string;
  createdAt: string;
  acceptedAt?: string;
  rejectedAt?: string;
  revokedAt?: string;
  available: boolean;
  can_decide: boolean;
  can_revoke: boolean;
  ipv4?: string;
  ipv6?: string;
  dns_name?: string;
  online: boolean;
}
export interface DeviceShares {
  enabled: boolean;
  can_manage: boolean;
  tailnet_locked: boolean;
  csrf_token: string;
  items: DeviceShare[];
}

function validDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function checkShare(value: DeviceShare): DeviceShare {
  if (!value || typeof value.id !== "string" || !/^shr_[a-f0-9]{24}$/.test(value.id) || !["pending", "accepted", "rejected", "revoked"].includes(value.status) ||
    !["incoming", "outgoing"].includes(value.direction) || !value.node || typeof value.node !== "object" ||
    typeof value.sourceOrganization !== "string" || !value.sourceOrganization || typeof value.targetOrganization !== "string" || !value.targetOrganization ||
    !validDate(value.createdAt) || [value.available, value.can_decide, value.can_revoke, value.online].some((flag) => typeof flag !== "boolean")) throw new Error("设备分享响应格式异常，请刷新核对实际结果");
  for (const field of ["createdBy", "targetUser", "ipv4", "ipv6", "dns_name"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new Error("设备分享数据异常，请刷新核对");
  }
  for (const field of ["stableId", "hostname", "os"] as const) {
    if (value.node[field] !== undefined && typeof value.node[field] !== "string") throw new Error("共享设备信息异常");
  }
  if (value.node.missing !== undefined && typeof value.node.missing !== "boolean") throw new Error("共享设备状态异常");
  for (const field of ["acceptedAt", "rejectedAt", "revokedAt"] as const) {
    if (value[field] !== undefined && !validDate(value[field])) throw new Error("设备分享时间异常");
  }
  if (value.can_decide && (value.direction !== "incoming" || value.status !== "pending" || !value.available)) throw new Error("分享接受权限未确认，请刷新");
  if (value.can_revoke && !["pending", "accepted"].includes(value.status)) throw new Error("分享撤销权限未确认，请刷新");
  if ((value.ipv4 || value.ipv6 || value.dns_name) && (value.direction !== "incoming" || value.status !== "accepted" || !value.available)) throw new Error("共享地址授权未确认，请刷新");
  return value;
}
function csrfHeaders(token: string) {
  if (!token) throw new Error("分享会话未确认，请刷新后再操作");
  return { "X-CSRF-Token": token };
}
export function shareRecipientLogin(value: string): string {
  const login = value.trim();
  if (!login || new TextEncoder().encode(login).length > 128 || /[\s\u0000-\u001f\u007f-\u009f]/u.test(login)) throw new Error("请输入对方在本平台的完整用户名，不是邮箱或网络标识");
  return login;
}
export async function getDeviceShares(): Promise<DeviceShares> {
  const value = await api<DeviceShares>("/api/v2/device-shares");
  if (!value || [value.enabled, value.can_manage, value.tailnet_locked].some((flag) => typeof flag !== "boolean") || typeof value.csrf_token !== "string" || !value.csrf_token || !Array.isArray(value.items) ||
    (value.can_manage && (!value.enabled || value.tailnet_locked)) || (!value.enabled && value.items.length)) throw new Error("设备分享能力未确认，请刷新");
  const seen = new Set<string>();
  for (const item of value.items) { checkShare(item); if (seen.has(item.id)) throw new Error("设备分享记录重复，请刷新"); seen.add(item.id); }
  return value;
}
export async function createDeviceShare(node: string, recipient: string, token: string): Promise<DeviceShare> {
  const login = shareRecipientLogin(recipient);
  const result = checkShare(await api<DeviceShare>("/api/v2/device-shares", { method: "POST", headers: csrfHeaders(token), body: { node, recipient_login: login } }));
  if (result.direction !== "outgoing" || result.status !== "pending" || result.node.stableId !== node || result.targetUser?.toLowerCase() !== login.toLowerCase()) throw new Error("分享发送结果未确认，请刷新列表；不要重复发送");
  return result;
}
export async function changeDeviceShare(id: string, action: "accept" | "reject" | "revoke", token: string): Promise<DeviceShare> {
  const expected: Record<typeof action, ShareStatus> = { accept: "accepted", reject: "rejected", revoke: "revoked" };
  const result = checkShare(await api<DeviceShare>(`/api/v2/device-shares/${encodeURIComponent(id)}${action === "revoke" ? "" : "/" + action}`, { method: action === "revoke" ? "DELETE" : "POST", headers: csrfHeaders(token) }));
  if (result.id !== id || result.status !== expected[action]) throw new Error("分享操作结果未确认，请刷新列表后再操作");
  return result;
}
