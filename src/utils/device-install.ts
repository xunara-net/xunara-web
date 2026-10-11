import { clientLoginCommand, type ClientPlatform } from "./devices";
import { normalizeAllocationRange } from "./addresses";

export interface DeviceInstallOptions {
  platform: ClientPlatform;
  installClient: boolean;
  acceptDNS: boolean;
  acceptRoutes: boolean;
  hostname: string;
  advertiseSubnets: boolean;
  routes: string;
  advertiseExitNode: boolean;
}
export interface DeviceInstallPermissions { allowSubnetRouter: boolean; allowExitNode: boolean; maxRoutes: number; }

export function deviceInstallCommand(serverURL: string, options: DeviceInstallOptions, permissions: DeviceInstallPermissions): string {
  if (![options.installClient, options.acceptDNS, options.acceptRoutes, options.advertiseSubnets, options.advertiseExitNode,
    permissions.allowSubnetRouter, permissions.allowExitNode].every((value) => typeof value === "boolean") ||
    !Number.isSafeInteger(permissions.maxRoutes) || permissions.maxRoutes < -1) throw new Error("安装参数或套餐权限未确认");
  if (!["linux", "windows", "macos", "android", "ios"].includes(options.platform)) throw new Error("请选择支持的平台");
  const base = clientLoginCommand(serverURL, options.platform);
  if (!base) return "";
  const hostname = options.hostname.trim();
  if (hostname && (hostname.length > 63 || !hostname.split(".").every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))) throw new Error("设备名称仅支持 1～63 个英文字母、数字、点和短横线，各段不能以短横线开头或结尾");
  if (options.advertiseSubnets && !permissions.allowSubnetRouter) throw new Error("当前套餐未允许子网路由，请先调整套餐权限");
  if (options.advertiseExitNode && !permissions.allowExitNode) throw new Error("当前套餐未允许出口节点，请先调整套餐权限");
  let routes: string[] = [];
  if (options.advertiseSubnets) {
    const entries = options.routes.trim().split(/[\s,]+/).filter(Boolean);
    if (!entries.length || entries.length > 64) throw new Error("请填写 1～64 个 IPv4 子网 CIDR，以逗号分隔");
    try { routes = [...new Set(entries.map((entry) => normalizeAllocationRange(entry, [])))]; }
    catch { throw new Error("子网必须是有效 IPv4 CIDR；默认路由请使用出口节点选项"); }
  }
  if (permissions.maxRoutes >= 0 && routes.length + (options.advertiseExitNode ? 2 : 0) > permissions.maxRoutes) throw new Error("宣告路由数量超出当前套餐额度（出口节点占两条默认路由）");
  const flags = [`--accept-dns=${options.acceptDNS}`, `--accept-routes=${options.acceptRoutes}`];
  if (hostname) flags.push(`--hostname=${JSON.stringify(hostname)}`);
  if (routes.length) flags.push(`--advertise-routes=${JSON.stringify(routes.join(","))}`);
  if (options.advertiseExitNode) flags.push("--advertise-exit-node");
  const login = `${base} ${flags.join(" ")}`;
  if (options.platform !== "linux" || !options.installClient) return login;
  // 先成功下载官方安装器，再执行和登录；不使用会吞掉 curl 失败的管道。
  return `( set -eu; installer="$(mktemp)"; trap 'rm -f "$installer"' 0; curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 https://tailscale.com/install.sh -o "$installer"; sh "$installer"; ${login} )`;
}
