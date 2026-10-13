// 网页路径只是租户路由，不是身份凭据。Cookie 与实际权限由该租户服务端确认。
export const organizationPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function consoleBase(pathname = typeof window === "undefined" ? "" : window.location.pathname ?? ""): string {
  const match = /^\/t\/([a-z0-9][a-z0-9-]{0,31})(?:\/|$)/.exec(pathname);
  return match ? `/t/${match[1]}` : "";
}

export function consolePath(path: string): string {
  return consoleBase() + path;
}

export function workspaceURL(origin: string, organization: string): string {
  const parsed = new URL(origin);
  if (parsed.origin !== window.location.origin || parsed.username || parsed.password || parsed.search || parsed.hash ||
      !["", "/"].includes(parsed.pathname) || !organizationPattern.test(organization)) {
    throw new Error("网络标识或控制台地址无效，请使用注册后提供的网络标识");
  }
  return `/t/${organization}`;
}

export function rememberWorkspace(organization: string): void {
  if (!organizationPattern.test(organization)) return;
  try { localStorage.setItem("xunara_workspace", organization); } catch { /* 禁止存储不影响登录。 */ }
}

export function rememberedWorkspace(): string {
  try {
    const value = localStorage.getItem("xunara_workspace") ?? "";
    return organizationPattern.test(value) ? value : "";
  } catch { return ""; }
}
