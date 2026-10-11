import { describe, expect, it } from "vitest";
import type { AccountSession, SecurityFinding } from "../api/types";
import { authMethodLabel, revokedReasonLabel, securityFindingText, sessionClientLabel, severityLabel, splitAccountSessions } from "./security";

function login(id: string, status: AccountSession["status"]): AccountSession {
  return { id, status, authMethod: "local", createdAt: "2026-10-09T01:00:00Z", expiresAt: "2026-10-10T01:00:00Z" };
}

describe("account session presentation", () => {
  it("separates server-confirmed active sessions from history and puts the current login first", () => {
    const input = [login("other", "active"), login("expired", "expired"), login("current", "active"), login("revoked", "revoked")];
    const grouped = splitAccountSessions(input, "current");
    expect(grouped.active.map((item) => item.id)).toEqual(["current", "other"]);
    expect(grouped.otherCount).toBe(1);
    expect(input[0]?.id).toBe("other");
  });

  it("does not invent a current login or active entries for an empty list", () => {
    expect(splitAccountSessions([], "missing")).toEqual({ active: [], otherCount: 0 });
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
    expect(revokedReasonLabel("password reset")).toBe("密码重置后退出");
    expect(revokedReasonLabel("account disabled by platform")).toBe("账号被管理员禁用");
    expect(revokedReasonLabel("custom reason")).toBe("custom reason");
    expect(revokedReasonLabel()).toBe("已退出");
  });

  it.each([
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/143.0 Safari/537.36 Edg/143.0", "Edge · Windows"],
    ["Mozilla/5.0 (Linux; Android 13) Chrome/143.0 Mobile Safari/537.36", "Chrome · Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1", "Safari · iOS / iPadOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X) Version/17.0 Safari/605.1", "Safari · macOS"],
    ["Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0", "Firefox · Linux"],
    ["Chrome/143.0 MicroMessenger/8.0 Android", "微信内置浏览器 · Android"],
    ["Chrome/143.0 SamsungBrowser/27.0 Android", "三星浏览器 · Android"],
    ["client-controlled-data", "未知浏览器"], ["", "未记录客户端"],
  ])("labels self-reported UA without guessing geography or OS version", (agent, label) => {
    expect(sessionClientLabel(agent)).toBe(label);
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
