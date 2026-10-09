export function loginDestination(candidate: unknown): { path: string; backend: boolean } {
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.startsWith("//") || /[\\\u0000-\u001f]/.test(candidate)) {
    return { path: "/dashboard", backend: false };
  }
  const pathname = candidate.split(/[?#]/, 1)[0]!;
  // 官方客户端设备授权和 SSH 检查是后端 HTML，不是 SPA 页面。
  // 登录后必须完整导航，不能被 vue-router 的兜底路由吞成“页面不存在”。
  const backend = ["/register/", "/ssh/check/", "/console/"].some((prefix) => pathname.startsWith(prefix));
  return { path: candidate, backend };
}

// 第三方入口只能导航到本站认证 API，不能把提供方响应变成外部跳转或任意 API 请求。
export function providerLoginURL(startURL: unknown, candidate: unknown, expectedProvider?: string): string | null {
  if (typeof startURL !== "string" || !startURL.startsWith("/") || startURL.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(startURL)) return null;
  const endpoint = new URL(startURL, "https://xunara.invalid");
  if (endpoint.pathname !== "/api/v1/auth/start" || endpoint.hash || !endpoint.searchParams.get("provider") || endpoint.searchParams.get("provider") === "local") return null;
  if (expectedProvider && endpoint.searchParams.get("provider") !== expectedProvider) return null;
  endpoint.searchParams.set("return_to", loginDestination(candidate).path);
  return endpoint.pathname + endpoint.search;
}

export function legacyProviderLoginURL(providers: { id: string; start_url: string }[], providerID: unknown, candidate: unknown): string | null {
  if (typeof providerID !== "string" || providerID === "local") return null;
  const provider = providers.find((entry) => entry.id === providerID);
  return provider ? providerLoginURL(provider.start_url, candidate, provider.id) : null;
}
