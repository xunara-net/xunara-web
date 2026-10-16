import { describe, expect, it } from "vitest";
import { accountLoginDestination, accountLoginPath, canonicalLoginPath, legacyProviderLoginURL, loginDestination, providerLoginURL } from "./auth";

describe("登录回跳", () => {
  it("站内产品页面使用 SPA 导航", () => {
    expect(loginDestination("/security?tab=sessions#current")).toEqual({ path: "/security?tab=sessions#current", backend: false });
    expect(loginDestination("/register").backend).toBe(false);
  });

  it("设备授权和 SSH 检查仍使用完整浏览器导航", () => {
    for (const path of ["/register/authorization-id", "/ssh/check/check-id"]) {
      expect(loginDestination(path)).toEqual({ path, backend: true });
    }
  });

  it("旧中心书签改为新页面，不恢复旧 HTML，也不复制旧 query", () => {
    expect(loginDestination("/console/ssh-check?state=pending&token=discarded")).toEqual({ path: "/security#ssh-check", backend: false });
    expect(loginDestination("/console/passkeys")).toEqual({ path: "/security", backend: false });
    expect(loginDestination("/console/machines")).toEqual({ path: "/devices", backend: false });
    expect(loginDestination("/console")).toEqual({ path: "/dashboard", backend: false });
    expect(loginDestination("/console/unknown")).toEqual({ path: "/dashboard", backend: false });
    expect(loginDestination("/console/constructor")).toEqual({ path: "/dashboard", backend: false });
    expect(accountLoginDestination("/t/bob", "/t/alice/console/ssh-check")).toBe("/t/bob/security#ssh-check");
  });

  it("查询字符串不能伪装成后端路径", () => {
    expect(loginDestination("/dashboard?next=/register/id").backend).toBe(false);
    expect(loginDestination("/register-prefix/id").backend).toBe(false);
  });

  it("拒绝外部 URL、协议相对地址、反斜杠、控制字符和数组", () => {
    for (const path of [undefined, ["/security"], "https://attacker.test/", "//attacker.test/", "/\\attacker.test", "/security\n", "javascript:alert(1)"]) {
      expect(loginDestination(path)).toEqual({ path: "/dashboard", backend: false });
    }
  });
});

describe("统一账户登录入口", () => {
  it("旧租户及已删除租户书签在读取会话之前回到根登录", () => {
    for (const path of ["/t/alice/login", "/t/deleted/login", "/t/gggg/login/"]) expect(canonicalLoginPath(path, "")).toBe("/login");
    for (const path of ["/login", "/t/alice/devices", "/t/alice/api/v1/auth/login", "/t/alice/register", "/t/../login"]) {
      expect(canonicalLoginPath(path, "")).toBeNull();
    }
  });
  it("只保留非敏感提示，不复制旧 URL 的任意参数或重复字段", () => {
    expect(accountLoginPath({ signed_out: "all", password_changed: "1", token: "private", provider: "unconfirmed" })).toBe("/login?signed_out=all&password_changed=1");
    expect(canonicalLoginPath("/t/alice/login", "?return_to=%2Fnetwork&signed_out=current&token=private")).toBe("/login?return_to=%2Fnetwork&signed_out=current");
    expect(canonicalLoginPath("/t/alice/login", "?return_to=%2Fnetwork&return_to=%2Fdevices&signed_out=other")).toBe("/login");
    for (const target of ["//foreign.test", "https://foreign.test", "/login", "/t/alice/login", "/\\foreign.test", "/network\u007f"]) {
      expect(accountLoginPath({ return_to: target })).toBe("/login");
    }
  });
  it("旧网络的普通页面只回到本次验证账户自己的控制台", () => {
    expect(accountLoginDestination("/t/bob", "/t/alice/network?tab=allocation")).toBe("/t/bob/network?tab=allocation");
    expect(accountLoginDestination("/t/bob", "/devices")).toBe("/t/bob/devices");
    expect(accountLoginDestination("", undefined)).toBe("/dashboard");
    expect(accountLoginDestination("/t/bob", "//foreign.test")).toBe("/t/bob/dashboard");
  });
  it("后端设备与 SSH 授权不能借旧回跳跳入另一网络", () => {
    expect(accountLoginDestination("/t/alice", "/t/alice/register/approval")).toBe("/t/alice/register/approval");
    expect(loginDestination("/t/alice/register/approval").backend).toBe(true);
    expect(accountLoginDestination("/t/bob", "/t/alice/register/approval")).toBe("/t/bob/dashboard");
    expect(accountLoginDestination("/t/bob", "/t/alice/ssh/check/approval")).toBe("/t/bob/dashboard");
  });
});

describe("第三方认证入口", () => {
  it("旧书签只转接已配置提供方，不把 query 当成任意认证地址", () => {
    const providers = [{ id: "oidc", start_url: "/api/v1/auth/start?provider=oidc" }];
    expect(legacyProviderLoginURL(providers, "oidc", "/register/device-id")).toBe("/api/v1/auth/start?provider=oidc&return_to=%2Fregister%2Fdevice-id");
    for (const provider of ["local", "unknown", ["oidc"], undefined]) {
      expect(legacyProviderLoginURL(providers, provider, "/security")).toBeNull();
    }
    expect(legacyProviderLoginURL([{ id: "oidc", start_url: "/api/v1/auth/start?provider=other" }], "oidc", "/security")).toBeNull();
  });
  it("保留设备授权和带查询/片段的产品回跳地址", () => {
    for (const target of ["/register/device-id", "/security?tab=sessions#current"]) {
      const result = new URL(providerLoginURL("/api/v1/auth/start?provider=oidc", target)!, "https://test.invalid");
      expect(result.pathname).toBe("/api/v1/auth/start");
      expect(result.searchParams.get("provider")).toBe("oidc");
      expect(result.searchParams.get("return_to")).toBe(target);
    }
  });

  it("无效回跳使用控制台首页，不复用提供方返回的回跳参数", () => {
    const result = providerLoginURL("/api/v1/auth/start?provider=oidc&return_to=https://attacker.test", "//attacker.test");
    expect(result).toBe("/api/v1/auth/start?provider=oidc&return_to=%2Fdashboard");
  });

  it("拒绝站外、旧 SPA、其他 API、无提供方与本地密码入口", () => {
    for (const endpoint of ["https://attacker.test/", "//attacker.test/", "/login?provider=oidc", "/api/v1/account", "/api/v1/auth/start", "/api/v1/auth/start?provider=local", "/api/v1/auth/start?provider=oidc#x", "/\\attacker.test", "/api/v1/auth/start?provider=oidc\n"]) {
      expect(providerLoginURL(endpoint, "/security")).toBeNull();
    }
  });
});
