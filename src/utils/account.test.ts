import { describe, expect, it } from "vitest";
import { passwordChangeError } from "./account";

describe("password change validation", () => {
  const current = "original test password";

  it("requires the current password", () => {
    expect(passwordChangeError("alice", "", "replacement password", "replacement password")).toContain("当前密码");
  });

  it("counts Unicode characters rather than bytes or UTF-16 units", () => {
    expect(passwordChangeError("alice", current, "中".repeat(12), "中".repeat(12))).toBe("");
    expect(passwordChangeError("alice", current, "😀".repeat(6), "😀".repeat(6))).toContain("12 个字符");
  });

  it("enforces bcrypt's 72-byte boundary", () => {
    expect(passwordChangeError("alice", current, "中".repeat(24), "中".repeat(24))).toBe("");
    expect(passwordChangeError("alice", current, "中".repeat(25), "中".repeat(25))).toContain("72 字节");
    expect(passwordChangeError("alice", current, "a".repeat(73), "a".repeat(73))).toContain("72 字节");
  });

  it("rejects an unchanged password", () => {
    expect(passwordChangeError("alice", current, current, current)).toContain("当前密码相同");
  });

  it("rejects a password equal to the trimmed, case-insensitive login name", () => {
    expect(passwordChangeError("account-name", current, " ACCOUNT-NAME ", " ACCOUNT-NAME ")).toContain("登录名");
  });

  it("requires matching confirmation", () => {
    expect(passwordChangeError("alice", current, "replacement password", "different password")).toContain("不一致");
  });
});
