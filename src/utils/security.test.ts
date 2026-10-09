import { describe, expect, it } from "vitest";
import type { AccountSession, SecurityFinding } from "../api/types";
import { authMethodLabel, revokedReasonLabel, securityFindingText, severityLabel, splitAccountSessions } from "./security";

function login(id: string, status: AccountSession["status"]): AccountSession {
  return { id, status, authMethod: "local", createdAt: "2026-10-09T01:00:00Z", expiresAt: "2026-10-10T01:00:00Z" };
}

describe("account session presentation", () => {
  it("separates server-confirmed active sessions from history and puts the current login first", () => {
    const input = [login("other", "active"), login("expired", "expired"), login("current", "active"), login("revoked", "revoked")];
    const grouped = splitAccountSessions(input, "current");
    expect(grouped.active.map((item) => item.id)).toEqual(["current", "other"]);
    expect(grouped.history.map((item) => item.id)).toEqual(["expired", "revoked"]);
    expect(grouped.otherCount).toBe(1);
    expect(input[0]?.id).toBe("other");
  });

  it("does not invent a current login or active entries for an empty list", () => {
    expect(splitAccountSessions([], "missing")).toEqual({ active: [], history: [], otherCount: 0 });
    expect(splitAccountSessions([login("old", "revoked")], "old").active).toEqual([]);
  });

  it("translates actual login methods without inventing browser or location metadata", () => {
    expect(authMethodLabel("local")).toBe("密码登录");
    expect(authMethodLabel("passkey")).toBe("通行密钥");
    expect(authMethodLabel("oidc:dex")).toBe("第三方登录 · dex");
    expect(authMethodLabel("dex")).toBe("第三方登录 · dex");
    expect(authMethodLabel("")).toBe("未记录");
  });

  it("preserves unknown revocation reasons and translates known account events", () => {
    expect(revokedReasonLabel("signed out other sessions")).toBe("退出其他登录");
    expect(revokedReasonLabel("password changed")).toBe("修改密码后退出");
    expect(revokedReasonLabel("custom reason")).toBe("custom reason");
    expect(revokedReasonLabel()).toBe("已退出");
  });
});

describe("security findings", () => {
  it("shows high-risk policy findings with a real settings link", () => {
    const finding: SecurityFinding = { id: "policy.absent", severity: "high", title: "upstream title", detail: "upstream detail" };
    expect(securityFindingText(finding)).toMatchObject({ title: "尚未设置设备访问规则", route: "/permissions" });
    expect(severityLabel(finding.severity)).toEqual({ label: "高风险", tone: "danger" });
  });

  it("falls back to new server findings without inventing a diagnosis or action", () => {
    const finding: SecurityFinding = { id: "new.check", severity: "future", title: "New check", detail: "Real server detail" };
    expect(securityFindingText(finding)).toEqual({ title: "New check", detail: "Real server detail" });
    expect(severityLabel(finding.severity)).toEqual({ label: "安全提示", tone: "" });
  });
});
