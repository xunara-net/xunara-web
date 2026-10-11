import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { passwordResetError, resetPassword } from "./password-reset";

vi.mock("./client", () => ({ api: vi.fn() }));
const code = "reset-" + "a".repeat(43);
const password = "long reset password";

describe("one-time password reset", () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it("validates complete codes, unicode length, bcrypt byte limits and confirmation", () => {
    expect(passwordResetError("", password, password)).toContain("完整");
    expect(passwordResetError(code, "short", "short")).toContain("12");
    expect(passwordResetError(code, "中".repeat(12), "中".repeat(12))).toBe("");
    expect(passwordResetError(code, "中".repeat(25), "中".repeat(25))).toContain("字节");
    expect(passwordResetError(code, password, "different")).toContain("不一致");
  });

  it("does not send invalid inputs or place secrets in the request path", async () => {
    await expect(resetPassword(code, password, "different")).rejects.toThrow("不一致");
    expect(api).not.toHaveBeenCalled();
    vi.mocked(api).mockResolvedValue({ changed: true, revoked_sessions: 2 });
    expect(await resetPassword(" " + code + " ", password, password)).toEqual({ changed: true, revoked_sessions: 2 });
    expect(api).toHaveBeenCalledWith("/api/v1/auth/password-reset", { method: "POST", body: { code, new_password: password, confirm_password: password } });
  });

  it("does not invent success for malformed acknowledgements or retry an unknown outcome", async () => {
    for (const response of [null, { changed: false, revoked_sessions: 0 }, { changed: true, revoked_sessions: -1 }, { changed: true }]) {
      vi.mocked(api).mockResolvedValue(response);
      await expect(resetPassword(code, password, password)).rejects.toThrow("结果未知");
    }
    expect(api).toHaveBeenCalledTimes(4);
  });
});
