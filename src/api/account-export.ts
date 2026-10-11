import { apiDownload, ApiError } from "./client";
import { sessionTimestamp } from "./account-sessions";

export type AccountExportFormat = "json" | "csv";
export const maxAccountExportBytes = 8 << 20;
export const accountExportCSVHeader = "记录标识,登录方式,记录类型,创建时间(UTC),有效期(UTC),最近活动(UTC),状态,撤销时间(UTC),撤销原因,首次来源IP,客户端线索\r\n";

export interface AccountExportFile {
  blob: Blob;
  filename: string;
}

function invalidExport(): never {
  throw new ApiError(502, "API_RESPONSE_INVALID: unexpected private export format");
}

function allowFields(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((name) => !fields.includes(name))) invalidExport();
  return value as Record<string, unknown>;
}

const sessionFields = ["id", "auth_method", "created_at", "expires_at", "status", "last_seen_at", "revoked_at", "revoked_reason", "client_ip", "user_agent"];

// 备份检查字段形状而非页面显示长度；旧文本不能被静默裁剪或冒充凭据字段。
function exportSessionId(item: Record<string, unknown>): string {
  if (typeof item.id !== "string" || !item.id || typeof item.auth_method !== "string" ||
      !sessionTimestamp(item.created_at) || !sessionTimestamp(item.expires_at) ||
      !["active", "revoked", "expired"].includes(String(item.status)) ||
      ["last_seen_at", "revoked_at"].some((name) => item[name] !== undefined && !sessionTimestamp(item[name])) ||
      ["client_ip", "user_agent", "revoked_reason"].some((name) => item[name] !== undefined && typeof item[name] !== "string")) invalidExport();
  return item.id;
}

function validateAccountExport(payload: unknown, userId: number) {
  const root = allowFields(payload, ["schema_version", "scope", "generated_at", "account", "contact_email_verified", "local_password_configured", "identities", "passkeys", "active_sessions", "login_history", "history_filter"]);
  if (root.schema_version !== 1 || root.scope !== "account-security" || !sessionTimestamp(root.generated_at) ||
      root.contact_email_verified !== false || typeof root.local_password_configured !== "boolean") invalidExport();
  const account = allowFields(root.account, ["id", "login_name", "display_name", "email", "role", "created_at", "updated_at"]);
  if (account.id !== userId || !sessionTimestamp(account.created_at) || !sessionTimestamp(account.updated_at) ||
      ["login_name", "display_name", "email", "role"].some((name) => typeof account[name] !== "string")) invalidExport();
  const filter = allowFields(root.history_filter, ["from", "until"]);
  if ([filter.from, filter.until].some((value) => value !== "" && !sessionTimestamp(value))) invalidExport();
  for (const collection of ["identities", "passkeys", "active_sessions", "login_history"]) {
    const entries = root[collection];
    if (!Array.isArray(entries) || entries.length > 5000) invalidExport();
    const ids = new Set<string>();
    for (const entry of entries) {
      if (collection === "active_sessions" || collection === "login_history") {
        const item = allowFields(entry, collection === "login_history" ? [...sessionFields, "kind"] : sessionFields);
        const id = exportSessionId(item);
        if (ids.has(id)) invalidExport();
        ids.add(id);
        if (collection === "login_history" && !["login", "rotation", "legacy"].includes(String(item.kind))) invalidExport();
        if (collection === "active_sessions" && item.status !== "active") invalidExport();
      } else if (collection === "identities") {
        const item = allowFields(entry, ["provider_id", "display_name", "email", "created_at", "updated_at"]);
        if (["provider_id", "display_name", "email"].some((name) => typeof item[name] !== "string") ||
            !sessionTimestamp(item.created_at) || !sessionTimestamp(item.updated_at)) invalidExport();
      } else {
        const item = allowFields(entry, ["id", "name", "created_at", "last_used_at"]);
        if (typeof item.id !== "string" || !item.id || typeof item.name !== "string" || !sessionTimestamp(item.created_at) ||
            item.last_used_at !== undefined && !sessionTimestamp(item.last_used_at) || ids.has(item.id)) invalidExport();
        ids.add(item.id);
      }
    }
  }
}

// 日期包含结束当天，按浏览器时区转换为服务端使用的半开 UTC 区间。
export function accountExportDates(from: string, until: string): { from?: string; until?: string } {
  function parseDate(value: string, nextDay: boolean): string | undefined {
    if (!value) return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error("请选择有效的导出日期。");
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (year < 1971 || year > 2261 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error("请选择有效的导出日期。");
    if (nextDay) date.setDate(date.getDate() + 1);
    return date.toISOString();
  }
  const start = parseDate(from, false), end = parseDate(until, true);
  if (start && end && start >= end) throw new Error("开始日期不能晚于结束日期。");
  return { from: start, until: end };
}

export async function prepareAccountExport(format: AccountExportFormat, userId: number, csrfToken: string,
  dates: { from?: string; until?: string }, signal?: AbortSignal): Promise<AccountExportFile> {
  const response = await apiDownload("/api/v1/account/export", {
    method: "POST", body: { format, ...dates }, headers: { "X-CSRF-Token": csrfToken }, signal,
  }, maxAccountExportBytes);
  const scope = format === "json" ? "account-security" : "login-history";
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = new RegExp(`^attachment; filename="(xunara-${scope}-[0-9]{8}T[0-9]{6}Z\\.${format})"$`).exec(disposition)?.[1];
  const contentType = response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (!filename || contentType !== (format === "json" ? "application/json" : "text/csv") ||
      response.headers.get("Cache-Control") !== "no-store") invalidExport();
  const text = await response.blob.text();
  if (format === "json") {
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { invalidExport(); }
    validateAccountExport(payload, userId);
  } else if (!text.replace(/^\uFEFF/, "").startsWith(accountExportCSVHeader)) invalidExport();
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
  return { blob: response.blob, filename };
}
