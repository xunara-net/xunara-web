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
    throw new Error("账户控制台地址无效，请重新登录");
  }
  return `/t/${organization}`;
}
