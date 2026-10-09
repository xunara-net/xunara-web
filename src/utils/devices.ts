import type { AuthKey, Machine } from "../api/types";

export function canManageNetwork(role?: string): boolean {
  return role === "owner" || role === "admin";
}

export type DeviceFilter = "all" | "online" | "offline" | "expired" | "router";

export function filterDevices(machines: Machine[], query: string, filter: DeviceFilter): Machine[] {
  const search = query.trim().toLocaleLowerCase();
  return machines.filter((machine) => {
    if (filter === "online" && (!machine.online || machine.expired)) return false;
    if (filter === "offline" && (machine.online || machine.expired)) return false;
    if (filter === "expired" && !machine.expired) return false;
    if (filter === "router" && !machine.announcedRoutes?.length && !machine.approvedRoutes?.length) return false;
    return !search || [machine.hostname, machine.stableId, machine.ipv4, machine.ipv6, machine.dnsName,
      machine.userLoginName, machine.os, ...(machine.tags ?? [])].some((value) => value?.toLocaleLowerCase().includes(search));
  });
}

// 服务端接收增删差量，不是整份 routes；保留未修改的批准项，包括暂时不再宣告的路由。
export function routeChanges(before: string[], after: string[]) {
  return {
    approve: [...new Set(after)].filter((prefix) => !before.includes(prefix)),
    unapprove: [...new Set(before)].filter((prefix) => !after.includes(prefix)),
  };
}

export function authorizationLabel(method: string): string {
  const labels: Record<string, string> = { authkey: "预授权密钥", oidc: "第三方授权", manual: "管理员批准", cli: "管理员批准" };
  return labels[method] ?? (method || "未上报");
}

export function authKeyStatus(key: AuthKey, now = Date.now()): string {
  if (key.expiry && Date.parse(key.expiry) <= now) return "已过期";
  if (key.used && !key.reusable) return "已使用";
  return "可用";
}

export type ClientPlatform = "linux" | "windows" | "macos" | "android" | "ios";

export function clientLoginCommand(rawURL: string, platform: ClientPlatform): string {
  const server = new URL(rawURL);
  if (!["https:", "http:"].includes(server.protocol) || server.username || server.password || server.search || server.hash ||
    server.pathname !== "/" || !/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)$/i.test(server.hostname)) {
    throw new Error("服务器地址无效，请联系管理员核对部署配置");
  }
  if (platform === "android" || platform === "ios") return "";
  return `${platform === "linux" ? "sudo " : ""}tailscale ${platform === "macos" ? "login" : "up"} --login-server=${JSON.stringify(server.origin)}`;
}
