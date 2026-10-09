import { describe, expect, it } from "vitest";
import { legacyProviderLoginURL, loginDestination, providerLoginURL } from "./auth";

describe("登录回跳", () => {
  it("站内产品页面使用 SPA 导航", () => {
    expect(loginDestination("/security?tab=sessions#current")).toEqual({ path: "/security?tab=sessions#current", backend: false });
    expect(loginDestination("/register").backend).toBe(false);
  });

  it("设备授权、SSH 检查和旧书签使用完整浏览器导航", () => {
    for (const path of ["/register/authorization-id", "/ssh/check/check-id", "/console/passkeys"]) {
      expect(loginDestination(path)).toEqual({ path, backend: true });
    }
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
