import { api } from "./client";
import { parseAccountSession, sessionTimestamp } from "./account-sessions";
import type { AccountLoginHistory, AccountLoginRecord } from "./types";

export async function getAccountLoginHistory(cursor = ""): Promise<AccountLoginHistory> {
  const payload = await api<Record<string, unknown>>("/api/v1/account/login-history", { query: { limit: 10, cursor } });
  if (!payload || !Array.isArray(payload.records) || payload.records.length > 10 ||
      typeof payload.current_session_id !== "string" || !payload.current_session_id ||
      !sessionTimestamp(payload.generated_at) || typeof payload.next_cursor !== "string" ||
      payload.next_cursor.length > 128 || !/^[\w-]*$/.test(payload.next_cursor) ||
      (payload.next_cursor && !payload.records.length)) {
    throw new Error("登录历史响应格式无效，请刷新重试。");
  }
  const records = payload.records.map((value): AccountLoginRecord => {
    const item = parseAccountSession(value);
    if (!value || !["login", "rotation", "legacy"].includes(value.kind)) {
      throw new Error("登录历史类型未知，请升级控制台或联系管理员。");
    }
    return { ...item, kind: value.kind };
  });
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("登录历史包含重复记录，请刷新重试。");
  }
  return { records, nextCursor: payload.next_cursor, currentSessionId: payload.current_session_id, generatedAt: payload.generated_at };
}
