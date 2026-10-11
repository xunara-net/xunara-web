import type { AccountSession } from "./types";

export function sessionTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function optionalText(value: unknown, max: number): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value));
}

// 无法识别的载荷是读取失败，不是“没有活动登录”；旧版本缺少来源时保持未知。
export function parseAccountSession(value: unknown): AccountSession {
  const item = value as Record<string, unknown> | null;
  if (!item || typeof item.id !== "string" || !item.id || item.id.length > 128 ||
      typeof item.auth_method !== "string" || !sessionTimestamp(item.created_at) || !sessionTimestamp(item.expires_at) ||
      typeof item.status !== "string" || !["active", "expired", "revoked"].includes(item.status) ||
      (item.last_seen_at !== undefined && !sessionTimestamp(item.last_seen_at)) ||
      (item.revoked_at !== undefined && !sessionTimestamp(item.revoked_at)) ||
      !optionalText(item.revoked_reason, 2048) || !optionalText(item.client_ip, 64) ||
      !optionalText(item.user_agent, 512) ||
      (typeof item.user_agent === "string" && new TextEncoder().encode(item.user_agent).length > 512)) {
    throw new Error("登录记录响应格式无效，请刷新重试。");
  }
  return {
    id: item.id, authMethod: item.auth_method,
    createdAt: item.created_at, expiresAt: item.expires_at,
    status: item.status as AccountSession["status"], lastSeenAt: item.last_seen_at as string | undefined,
    revokedAt: item.revoked_at as string | undefined, revokedReason: item.revoked_reason,
    clientIP: item.client_ip, userAgent: item.user_agent,
  };
}
