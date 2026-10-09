import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "./client";

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
