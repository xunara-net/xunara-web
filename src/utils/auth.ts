import { consoleBase, consolePath } from "./console";

export function loginDestination(candidate: unknown): { path: string; backend: boolean } {
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(candidate)) {
    return { path: "/dashboard", backend: false };
  }
  const pathname = candidate.split(/[?#]/, 1)[0]!;
  const base = consoleBase(pathname);
  const relative = base ? pathname.slice(base.length) || "/" : pathname;
  if (relative === "/login" || relative === "/login/") return { path: "/dashboard", backend: false };
  // 官方客户端设备授权和 SSH 检查是后端 HTML，不是 SPA 页面。
  // 登录后必须完整导航，不能被 vue-router 的兜底路由吞成“页面不存在”。
  const backend = ["/register/", "/ssh/check/", "/console/"].some((prefix) => relative.startsWith(prefix));
  return { path: candidate, backend };
}

// 统一入口不沿用旧租户；授权页只允许回到本次验证过的网络。
export function accountLoginDestination(workspace: string, candidate: unknown): string {
  const target = loginDestination(candidate);
  const previous = consoleBase(target.path);
  if (previous && target.backend && previous !== workspace) return workspace + "/dashboard";
  return workspace + (previous ? target.path.slice(previous.length) || "/dashboard" : target.path);
}

export function accountLoginPath(query: Record<string, unknown> = {}): string {
  const values = new URLSearchParams();
  const target = loginDestination(query.return_to);
  if (target.path !== "/dashboard") values.set("return_to", target.path);
  if (query.signed_out === "current" || query.signed_out === "all") values.set("signed_out", query.signed_out);
  if (query.password_changed === "1") values.set("password_changed", "1");
  return "/login" + (values.size ? "?" + values.toString() : "");
}

// 启动前处理旧书签，包括已删除的租户；不得先向旧租户读取会话或发送凭据。
export function canonicalLoginPath(pathname: string, search: string): string | null {
  const base = consoleBase(pathname);
  if (!base || !["/login", "/login/"].includes(pathname.slice(base.length))) return null;
  const values = new URLSearchParams(search);
  const query: Record<string, unknown> = {};
  for (const name of ["return_to", "signed_out", "password_changed"]) {
    const entries = values.getAll(name);
    if (entries.length === 1) query[name] = entries[0];
  }
  return accountLoginPath(query);
}

// 第三方入口只能导航到本站认证 API，不能把提供方响应变成外部跳转或任意 API 请求。
export function providerLoginURL(startURL: unknown, candidate: unknown, expectedProvider?: string): string | null {
  if (typeof startURL !== "string" || !startURL.startsWith("/") || startURL.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(startURL)) return null;
  const endpoint = new URL(startURL, "https://xunara.invalid");
  if (endpoint.pathname !== "/api/v1/auth/start" || endpoint.hash || !endpoint.searchParams.get("provider") || endpoint.searchParams.get("provider") === "local") return null;
  if (expectedProvider && endpoint.searchParams.get("provider") !== expectedProvider) return null;
  endpoint.searchParams.set("return_to", loginDestination(candidate).path);
  return consolePath(endpoint.pathname + endpoint.search);
}

export function legacyProviderLoginURL(providers: { id: string; start_url: string }[], providerID: unknown, candidate: unknown): string | null {
  if (typeof providerID !== "string" || providerID === "local") return null;
  const provider = providers.find((entry) => entry.id === providerID);
  return provider ? providerLoginURL(provider.start_url, candidate, provider.id) : null;
}
