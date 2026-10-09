import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, errorMessage } from "./client";

describe("request lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", { location: { origin: "https://tenant.example.test" } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("aborts a stalled write without claiming it failed or retrying", async () => {
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);
    const rejected = expect(api("/api/v2/policy/configuration", { method: "PUT", body: {} })).rejects.toMatchObject({ status: 408, errorCode: "REQUEST_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1].signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(errorMessage(new ApiError(408, "REQUEST_TIMEOUT: outcome unknown"))).toContain("请先刷新检查");
  });

  it("clears the timer after an empty success or transport failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/api/v2/dns/records/1", { method: "DELETE" })).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await expect(api("/api/v2/policy/configuration")).rejects.toThrow("offline");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not accept HTML as a successful JSON API response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>proxy fallback</html>")));
    await expect(api("/api/v2/policy/configuration")).rejects.toMatchObject({ errorCode: "API_RESPONSE_INVALID" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ApiError", () => {
  it("extracts the stable error code from a plan gate message", () => {
    const err = new ApiError(403, "DEVICE_LIMIT_REACHED: this plan's device limit is reached");
    expect(err.errorCode).toBe("DEVICE_LIMIT_REACHED");
  });

  it("prefers an explicit code field", () => {
    const err = new ApiError(409, "the enrollment token has been used", "RELAY_ALREADY_ENROLLED");
    expect(err.errorCode).toBe("RELAY_ALREADY_ENROLLED");
  });

  it("has no code for an ordinary message", () => {
    expect(new ApiError(401, "wrong login name or password").errorCode).toBe("");
  });
});

describe("errorMessage", () => {
  it("translates a wrong current password and rate limit without exposing passwords", () => {
    expect(errorMessage(new ApiError(400, "CURRENT_PASSWORD_INVALID: current password is incorrect"))).toContain("当前密码不正确");
    expect(errorMessage(new ApiError(429, "PASSWORD_RATE_LIMITED: too many attempts"))).toContain("请稍后再试");
  });

  it("translates known plan codes for the console", () => {
    const err = new ApiError(403, "DEVICE_LIMIT_REACHED: this plan's device limit is reached");
    expect(errorMessage(err)).toContain("设备数已达上限");
    expect(errorMessage(err)).toContain("DEVICE_LIMIT_REACHED");
  });

  it("passes through unknown errors", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});
