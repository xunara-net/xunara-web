import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiDownload, ApiError, errorMessage } from "./client";
import { accountExportCSVHeader, accountExportDates, maxAccountExportBytes, prepareAccountExport } from "./account-export";

const timestamp = "2026-10-11T12:00:00Z";
const userId = 7;
const unsafeHeaders: Record<string, string>[] = [
  { "Content-Disposition": 'attachment; filename="../../private.json"' },
  { "Content-Disposition": 'inline; filename="xunara-account-security-20261011T120000Z.json"' },
  { "Content-Type": "text/html" }, { "Cache-Control": "public" }, { "Content-Length": "9999" },
];

function snapshot() {
  return {
    schema_version: 1, scope: "account-security", generated_at: timestamp,
    account: { id: userId, login_name: "test-user", display_name: "本人", email: "contact@example.test", role: "member", created_at: timestamp, updated_at: timestamp },
    contact_email_verified: false, local_password_configured: true,
    identities: [{ provider_id: "example", display_name: "绑定", email: "other@example.test", created_at: timestamp, updated_at: timestamp }],
    passkeys: [{ id: "pk_test", name: "手机", created_at: timestamp }],
    active_sessions: [{ id: "session", auth_method: "local", created_at: timestamp, expires_at: timestamp, status: "active" }],
    login_history: [{ id: "session", auth_method: "local", kind: "login", created_at: timestamp, expires_at: timestamp, status: "active" }],
    history_filter: { from: "", until: "" },
  };
}

function response(body: string, format = "json", headers: Record<string, string> = {}) {
  return new Response(body, { headers: {
    "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="xunara-${format === "json" ? "account-security" : "login-history"}-20261011T120000Z.${format}"`,
    "Cache-Control": "no-store", ...headers,
  } });
}

beforeEach(() => { vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("private account export", () => {
  it("requests an acknowledged own export with a POST body and no URL credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(JSON.stringify(snapshot())));
    vi.stubGlobal("fetch", fetchMock);
    const file = await prepareAccountExport("json", userId, "csrf-fixture", { from: timestamp });
    expect(file.filename).toBe("xunara-account-security-20261011T120000Z.json");
    expect(JSON.parse(await file.blob.text()).account.id).toBe(userId);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://tenant.example.test/api/v1/account/export");
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin", redirect: "error", headers: { "X-CSRF-Token": "csrf-fixture" } });
    expect(JSON.parse(options.body)).toEqual({ format: "json", from: timestamp });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts the UTF-8 BOM CSV header including a legitimate empty table", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("\uFEFF" + accountExportCSVHeader, "csv")));
    expect((await prepareAccountExport("csv", userId, "csrf", {})).filename).toContain("login-history");
  });

  it("preserves legacy display text without applying page truncation rules to a backup", async () => {
    const payload: any = snapshot();
    payload.login_history[0].revoked_reason = "legacy\n" + "x".repeat(3000);
    payload.login_history[0].user_agent = "legacy\tclient";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(JSON.stringify(payload))));
    const file = await prepareAccountExport("json", userId, "csrf", {});
    expect(JSON.parse(await file.blob.text()).login_history[0]).toEqual(payload.login_history[0]);
  });

  it.each(["wrong-user", "secret", "subject", "credential", "nested-secret", "version", "session", "count", "missing", "html"])("rejects %s without producing a file", async (fault) => {
    const payload: any = snapshot();
    if (fault === "wrong-user") payload.account.id++;
    if (fault === "secret") payload.csrf_token = "private-fixture";
    if (fault === "subject") payload.identities[0].subject = "private-subject";
    if (fault === "credential") payload.passkeys[0].credential = {};
    if (fault === "nested-secret") payload.login_history[0].token_hash = "private-hash";
    if (fault === "version") payload.schema_version = 2;
    if (fault === "session") payload.active_sessions[0].status = "revoked";
    if (fault === "count") payload.login_history = Array(5001).fill(payload.login_history[0]);
    if (fault === "missing") delete payload.history_filter.until;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(fault === "html" ? "<html>not a backup</html>" : JSON.stringify(payload))));
    await expect(prepareAccountExport("json", userId, "csrf", {})).rejects.toBeDefined();
  });

  it.each(unsafeHeaders)("rejects unsafe or inconsistent attachment headers: %j", async (headers) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(JSON.stringify(snapshot()), "json", headers)));
    await expect(prepareAccountExport("json", userId, "csrf", {})).rejects.toBeInstanceOf(ApiError);
  });

  it("surfaces 503/429 errors in Chinese without auto retry or exposing diagnostic text", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "ACCOUNT_EXPORT_UNAVAILABLE: isolated internal diagnostic" }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "ACCOUNT_EXPORT_RATE_LIMITED: persistent admission" }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    for (const expected of ["未生成下载文件", "15 分钟"]) {
      const failure = await prepareAccountExport("json", userId, "csrf", {}).catch((error) => error);
      expect(errorMessage(failure)).toContain(expected);
      expect(errorMessage(failure)).not.toContain("diagnostic");
      expect(errorMessage(failure)).not.toContain("persistent admission");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("bounded download request lifecycle", () => {
  it("never sends private request headers to another origin or with an unbounded size", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const [path, limit] of [["https://external.example.test/export", 100], ["/api/v1/account/export", NaN], ["/api/v1/account/export", 0]] as const) {
      await expect(apiDownload(path, { headers: { "X-CSRF-Token": "private-fixture" } }, limit)).rejects.toMatchObject({ status: 400 });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("checks actual streamed bytes even if the declared length is absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("12345")));
    await expect(apiDownload("/api/v1/account/export", {}, 4)).rejects.toMatchObject({ status: 413 });
  });

  it("does not mistake a compressed transport length for the decoded file length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(JSON.stringify(snapshot()), "json", { "Content-Encoding": "gzip", "Content-Length": "10" })));
    expect((await prepareAccountExport("json", userId, "csrf", {})).blob.size).toBeGreaterThan(10);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("12345", "json", { "Content-Encoding": "gzip", "Content-Length": "2" })));
    await expect(apiDownload("/api/v1/account/export", {}, 4)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects invalid declared length, oversized or missing download content", async () => {
    for (const data of [response("body", "json", { "Content-Length": "invalid" }), response("body", "json", { "Content-Length": String(maxAccountExportBytes + 1) }), new Response(null)]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(data));
      await expect(apiDownload("/api/v1/account/export", {}, maxAccountExportBytes)).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("cancels an in-flight request explicitly rather than retrying", async () => {
    const operation = new AbortController();
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const failure = expect(prepareAccountExport("json", userId, "csrf", {}, operation.signal)).rejects.toMatchObject({ name: "AbortError" });
    operation.abort();
    await failure;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the timeout active while reading the file body", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => Promise.resolve(new Response(new ReadableStream({ start(controller) {
      init.signal!.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    } }))));
    vi.stubGlobal("fetch", fetchMock);
    const failure = expect(prepareAccountExport("json", userId, "csrf", {})).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(30000);
    await failure;
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("history date intervals", () => {
  it("leaves an unspecified interval empty and includes the chosen last day", () => {
    expect(accountExportDates("", "")).toEqual({ from: undefined, until: undefined });
    expect(accountExportDates("2026-10-11", "2026-10-11")).toEqual({ from: new Date(2026, 9, 11).toISOString(), until: new Date(2026, 9, 12).toISOString() });
    expect(accountExportDates("2024-02-29", "2024-02-29").until).toBe(new Date(2024, 2, 1).toISOString());
  });

  it.each(["2026-02-30", "2026-2-3", "2026-13-01", "1960-01-01", "3000-01-01"])("rejects invalid date %s", (value) => {
    expect(() => accountExportDates(value, "")).toThrow("有效的导出日期");
  });

  it("rejects a reversed interval", () => {
    expect(() => accountExportDates("2026-10-12", "2026-10-11")).toThrow("开始日期");
  });
});
