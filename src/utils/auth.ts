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
