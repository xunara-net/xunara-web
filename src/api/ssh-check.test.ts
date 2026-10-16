import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSSHChecks, type SSHCheckSession } from "./ssh-check";

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("window", { location: { origin: "https://portal.test", pathname: "/t/alice/security" } });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
function respond(payload: unknown, status = 200) { fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status })); }
const record: SSHCheckSession = {
  id: "check-fixture", state: "pending", verdict: "pending",
  src: { nodeId: 1, stableId: "source-node", hostname: "来源设备" }, dst: { nodeId: 2 },
  localUser: "root", createdAt: "2026-10-16T02:00:00Z", expiresAt: "2026-10-16T02:15:00Z",
};

describe("SSH 审批记录", () => {
  it("使用当前租户的只读 API、状态筛选和不透明游标", async () => {
    respond({ items: [record], nextCursor: "next-page" });
    expect((await listSSHChecks("pending", "cursor+/=")).items).toEqual([record]);
    const target = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(target.pathname).toBe("/t/alice/api/v2/ssh-check/sessions");
    expect(target.searchParams.get("state")).toBe("pending");
    expect(target.searchParams.get("cursor")).toBe("cursor+/=");
    expect(target.searchParams.get("limit")).toBe("50");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("same-origin");
  });
  it("已删除节点保留 ID，已取走结果不等同于连接成功", async () => {
    const consumed = { ...record, state: "consumed", verdict: "reject", decidedBy: { userId: 3 }, decidedAt: record.createdAt, consumedAt: record.expiresAt };
    respond({ items: [consumed], nextCursor: "" });
    expect((await listSSHChecks()).items[0]).toEqual(consumed);
    respond({ items: [], nextCursor: "" });
    expect((await listSSHChecks()).items).toEqual([]);
  });
  it("读取失败、未知状态或畸形数据不伪装成空列表", async () => {
    for (const payload of [{}, { items: null, nextCursor: "" }, { items: [record] },
      { items: [{ ...record, state: "constructor" }], nextCursor: "" },
      { items: [{ ...record, src: null }], nextCursor: "" },
      { items: [{ ...record, verdict: "success" }], nextCursor: "" },
      { items: [{ ...record, expiresAt: "invalid" }], nextCursor: "" }]) {
      respond(payload);
      await expect(listSSHChecks()).rejects.toThrow("格式异常");
    }
    respond({ error: "authentication required" }, 401);
    await expect(listSSHChecks()).rejects.toMatchObject({ status: 401 });
    respond({ error: "unavailable" }, 503);
    await expect(listSSHChecks()).rejects.toMatchObject({ status: 503 });
  });
  it("离开页面时可取消读取，不触发任何审批写操作", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const reading = listSSHChecks("", "", controller.signal);
    const cancelled = expect(reading).rejects.toMatchObject({ name: "AbortError" });
    const sent = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(sent?.aborted).toBe(false);
    controller.abort();
    await cancelled;
    expect(sent?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
