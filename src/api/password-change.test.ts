import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import { changePassword } from "./endpoints";
import { toUser } from "./adapters";
import type { UserPayload } from "./types";

vi.mock("./client", () => ({ api: vi.fn(), ApiError: class extends Error {} }));
const user: UserPayload = { id: 1, login_name: "member", display_name: "成员", email: "", role: "member", created_at: "2026-10-14T00:00:00Z", updated_at: "2026-10-14T00:00:00Z" };

describe("temporary password change", () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it("preserves a durable forced-change flag without interpreting a string as permission", () => {
    expect(toUser({ ...user, password_change_required: true }).passwordChangeRequired).toBe(true);
    expect(toUser({ ...user, password_change_required: false }).passwordChangeRequired).toBe(false);
    expect(toUser(user).passwordChangeRequired).toBeUndefined();
    expect(() => toUser({ ...user, password_change_required: "false" } as unknown as UserPayload)).toThrow("格式无效");
  });

  it("changes through the existing private account endpoint with session-bound CSRF", async () => {
    vi.mocked(api).mockResolvedValue({ changed: true, revoked_sessions: 1 });
    const body = { current_password: "isolated temporary password", new_password: "isolated new password" };
    await expect(changePassword(body, "csrf")).resolves.toEqual({ changed: true, revoked_sessions: 1 });
    expect(api).toHaveBeenCalledWith("/api/v1/account/password", { method: "POST", body, headers: { "X-CSRF-Token": "csrf" } });
  });

  it("does not claim success or retry when revocation acknowledgement is incomplete", async () => {
    for (const result of [null, {}, { changed: false, revoked_sessions: 1 }, { changed: true, revoked_sessions: 0 }, { changed: true, revoked_sessions: -1 }, { changed: true, revoked_sessions: 1.5 }]) {
      vi.mocked(api).mockResolvedValue(result);
      await expect(changePassword({ current_password: "old", new_password: "new" }, "csrf")).rejects.toThrow("结果未知");
    }
    expect(api).toHaveBeenCalledTimes(6);
  });
});
