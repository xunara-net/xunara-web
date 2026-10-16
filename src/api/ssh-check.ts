import { api } from "./client";

export const sshCheckStates = { pending: "待审批", accepted: "已批准", rejected: "已拒绝", consumed: "已取走结果", expired: "已过期" } as const;
export type SSHCheckState = keyof typeof sshCheckStates;
export type SSHCheckPeer = { nodeId: number; stableId?: string; hostname?: string };
export type SSHCheckSession = {
  id: string;
  state: SSHCheckState;
  verdict: "pending" | "accept" | "reject";
  src: SSHCheckPeer;
  dst: SSHCheckPeer;
  localUser: string;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: { userId: number; loginName?: string };
  consumedAt?: string;
};
export type SSHCheckPage = { items: SSHCheckSession[]; nextCursor: string };

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function identifier(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function peer(value: unknown): value is SSHCheckPeer {
  return object(value) && identifier(value.nodeId) && (value.stableId === undefined || typeof value.stableId === "string") && (value.hostname === undefined || typeof value.hostname === "string");
}
function checkSession(value: unknown): value is SSHCheckSession {
  return object(value) && typeof value.id === "string" && value.id.length > 0 && typeof value.state === "string" && Object.hasOwn(sshCheckStates, value.state) &&
    ["pending", "accept", "reject"].includes(String(value.verdict)) && peer(value.src) && peer(value.dst) && typeof value.localUser === "string" && timestamp(value.createdAt) && timestamp(value.expiresAt) &&
    (value.decidedAt === undefined || timestamp(value.decidedAt)) && (value.consumedAt === undefined || timestamp(value.consumedAt)) &&
    (value.decidedBy === undefined || (object(value.decidedBy) && identifier(value.decidedBy.userId) && (value.decidedBy.loginName === undefined || typeof value.decidedBy.loginName === "string")));
}

export async function listSSHChecks(state: SSHCheckState | "" = "", cursor = "", signal?: AbortSignal): Promise<SSHCheckPage> {
  const payload = await api<SSHCheckPage>("/api/v2/ssh-check/sessions", { query: { limit: 50, state, cursor }, signal });
  // 失败或旧版响应不能伪装成“没有审批记录”；已删除设备仍保留原节点 ID。
  if (!object(payload) || !Array.isArray(payload.items) || !payload.items.every(checkSession) || typeof payload.nextCursor !== "string") {
    throw new Error("SSH 审批记录响应格式异常，请刷新重试。");
  }
  return payload;
}
