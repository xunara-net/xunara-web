import { describe, expect, it } from "vitest";
import { loginDestination } from "./auth";

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
