import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountLoginHistory } from "./login-history";
import { getAccountSessions } from "./endpoints";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const record = {
  id: "public-session-id", auth_method: "local", status: "active", kind: "login",
  created_at: "2026-10-11T00:00:00.123456789Z", expires_at: "2026-10-12T00:00:00Z",
  last_seen_at: "2026-10-11T01:00:00Z", client_ip: "192.0.2.8", user_agent: "Firefox/130 Linux",
};
const history = { records: [record], next_cursor: "public_cursor", current_session_id: record.id, generated_at: "2026-10-11T01:00:00Z" };
function response(payload: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
}

describe("independent account login history", () => {
  it("requests bounded same-origin pages without another user's ID or credentials in URL", async () => {
    response(history);
    expect(await getAccountLoginHistory("public_cursor")).toMatchObject({ nextCursor: "public_cursor", records: [{
      id: record.id, kind: "login", clientIP: record.client_ip, userAgent: record.user_agent,
      lastSeenAt: record.last_seen_at, createdAt: record.created_at,
    }] });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/api/v1/account/login-history");
    expect([...new URL(String(url)).searchParams]).toEqual([["limit", "10"], ["cursor", "public_cursor"]]);
    expect(options).toMatchObject({ credentials: "same-origin", method: "GET" });
  });

  it("keeps legacy origin unknown and marks rotations instead of fabricating new logins", async () => {
    response({ ...history, next_cursor: "", records: [{ ...record, id: "old", kind: "legacy", user_agent: undefined, client_ip: undefined, last_seen_at: undefined }, { ...record, kind: "rotation" }] });
    expect((await getAccountLoginHistory()).records).toMatchObject([
      { kind: "legacy", userAgent: undefined, clientIP: undefined, lastSeenAt: undefined }, { kind: "rotation" },
    ]);
  });

  it("only treats an explicit valid empty page as empty history", async () => {
    response({ ...history, records: [], next_cursor: "" });
    expect((await getAccountLoginHistory()).records).toEqual([]);
  });

  it.each([
    {}, { ...history, records: null }, { ...history, records: [], next_cursor: "cursor" },
    { ...history, generated_at: "invalid" }, { ...history, current_session_id: "" },
    { ...history, next_cursor: "https://other.test" }, { ...history, records: [record, record] },
    { ...history, records: [{ ...record, kind: "future" }] },
    { ...history, records: [{ ...record, status: ["active"] }] },
    { ...history, records: [{ ...record, last_seen_at: "invalid" }] },
    { ...history, records: [{ ...record, user_agent: "bad\r\nagent" }] },
    { ...history, records: [{ ...record, user_agent: "中".repeat(200) }] },
    { ...history, records: Array.from({ length: 11 }, (_, index) => ({ ...record, id: String(index) })) },
  ])("rejects malformed history without silently dropping records", async (payload) => {
    response(payload);
    await expect(getAccountLoginHistory()).rejects.toThrow();
  });

  it.each([401, 404, 500, 503])("keeps an HTTP %s failure visible instead of converting it to no history", async (status) => {
    response({ error: "LOGIN_HISTORY_FAILED: read unavailable" }, status);
    await expect(getAccountLoginHistory()).rejects.toMatchObject({ status });
  });

  it("includes new metadata in active sessions and remains compatible with missing old fields", async () => {
    response({ sessions: [record, { ...record, id: "old", user_agent: undefined, client_ip: undefined, last_seen_at: undefined }],
      current_session_id: record.id, csrf_token: "csrf", generated_at: history.generated_at });
    expect((await getAccountSessions()).sessions).toMatchObject([
      { clientIP: record.client_ip, userAgent: record.user_agent, lastSeenAt: record.last_seen_at },
      { clientIP: undefined, userAgent: undefined, lastSeenAt: undefined },
    ]);
    response({ sessions: [] });
    await expect(getAccountSessions()).rejects.toThrow("活动登录响应格式无效");
  });
});
