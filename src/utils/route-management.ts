import type { ClientPlatform } from "./devices";
import type { RouteLimits, RouteNode } from "../api/route-management";

export function validRouteAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 45) return false;
  if (value.includes(":")) {
    if (!/^[0-9a-fA-F:.]+$/.test(value)) return false;
    try { return new URL("https://[" + value + "]/").hostname.startsWith("["); } catch { return false; }
  }
  return /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255);
}
export function validRoutePrefix(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length === 2 && validRouteAddress(parts[0]) && /^(0|[1-9]\d{0,2})$/.test(parts[1] ?? "") &&
    Number(parts[1]) <= (parts[0]!.includes(":") ? 128 : 32);
}
export const isExitPrefix = (prefix: string) => prefix === "0.0.0.0/0" || prefix === "::/0";
export function canAddRoute(prefix: string, limits: RouteLimits): boolean {
  return isExitPrefix(prefix) ? limits.allow_exit_node : limits.allow_subnet_router;
}
export function routeState(item: RouteNode, prefix: string): string {
  if (!(item.machine.approvedRoutes ?? []).includes(prefix)) return "待批准";
  if (!(item.machine.announcedRoutes ?? []).includes(prefix)) return "已批准 · 已停止宣告";
  if (item.machine.expired) return "已批准 · 设备密钥过期";
  if (!item.machine.online) return "已批准 · 设备离线";
  return "宣告与批准匹配";
}
// 只重放用户明确的增删意图，保留另一位管理员新增的批准，不自动发送写请求。
export function rebaseRouteSelection(current: string[], changes: { approve: string[]; unapprove: string[] }): string[] {
  return [...new Set([...current.filter((prefix) => !changes.unapprove.includes(prefix)), ...changes.approve])];
}
export function exitNodeCommand(address: string, platform: ClientPlatform, allowLAN: boolean): string {
  if (!validRouteAddress(address) || typeof allowLAN !== "boolean" || !["linux", "windows", "macos", "android", "ios"].includes(platform)) throw new Error("出口节点地址或客户端选项无效");
  if (platform === "android" || platform === "ios") return "";
  return (platform === "linux" ? "sudo " : "") + "tailscale set --exit-node=" + JSON.stringify(address) + " --exit-node-allow-lan-access=" + String(allowLAN);
}
export function stopExitNodeCommand(platform: ClientPlatform): string {
  if (!["linux", "windows", "macos", "android", "ios"].includes(platform)) throw new Error("请选择支持的客户端平台");
  if (platform === "android" || platform === "ios") return "";
  return (platform === "linux" ? "sudo " : "") + 'tailscale set --exit-node="" --exit-node-allow-lan-access=false';
}
