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
  authMethod?: "browser" | "token";
  protectNetwork?: boolean;
}
export interface DeviceInstallPermissions { allowSubnetRouter: boolean; allowExitNode: boolean; maxRoutes: number; networkRanges?: string[]; checkScriptURL?: string; }

export function deviceInstallCommand(serverURL: string, options: DeviceInstallOptions, permissions: DeviceInstallPermissions, authKey = ""): string {
  if (options.protectNetwork !== undefined && typeof options.protectNetwork !== "boolean") throw new Error("网络冲突保护选项未确认");
  if (options.authMethod !== undefined && !["browser", "token"].includes(options.authMethod)) throw new Error("请选择浏览器或 Token 接入方式");
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
  // 只输出偏离官方 CLI 默认值的选项；Windows/macOS 默认接收路由，Linux 默认不接收。
  const flags: string[] = [];
  if (!options.acceptDNS) flags.push("--accept-dns=false");
  if (options.acceptRoutes !== (options.platform !== "linux")) flags.push(`--accept-routes=${options.acceptRoutes}`);
  if (hostname) flags.push(`--hostname=${JSON.stringify(hostname)}`);
  if (routes.length) flags.push(`--advertise-routes=${JSON.stringify(routes.join(","))}`);
  if (options.advertiseExitNode) flags.push("--advertise-exit-node");
  if (options.authMethod === "token") {
    if (!validDeviceAuthKey(authKey)) throw new Error("请填写设备 Auth Key，或生成一次性 Token；不能使用后台令牌或 API Key");
    flags.push(`--auth-key=${JSON.stringify(authKey)}`);
  }
  const login = [base, ...flags].join(" ");
  let preflight = "";
  if (options.platform === "linux" && options.protectNetwork) {
    const source = new URL(permissions.checkScriptURL ?? "");
    if (source.pathname !== "/network-check.py" || source.username || source.password || source.search || source.hash ||
        source.protocol !== "https:" && !(source.protocol === "http:" && ["localhost", "127.0.0.1"].includes(source.hostname))) throw new Error("网络冲突检查需要正式 HTTPS 地址（本机验收除外）");
    if (!Array.isArray(permissions.networkRanges) || !permissions.networkRanges.length) throw new Error("地址池尚未确认，不能生成受保护的接入命令，请重新打开添加设备");
    const ranges = permissions.networkRanges.map((value) => JSON.stringify(normalizeAllocationRange(value, []))).join(" ");
    // curl 失败不能变成空脚本成功；检查失败会阻止后续安装/接入，不静默改本机网络。
    preflight = `xunara_check=$(curl -fsSL --max-time 30 ${JSON.stringify(source.href)}) &&\nprintf '%s\\n' "$xunara_check" | python3 - ${ranges} &&\n`;
  }
  if (options.platform !== "linux" || !options.installClient) return preflight + login;
  // 保留官方简洁安装管道，但必须传播 curl 失败，防止安装失败后继续带密钥接入。
  return `${preflight}bash -o pipefail -c 'curl -fsSL https://tailscale.com/install.sh | sh' &&\n${login}`;
}

export function validDeviceAuthKey(value: unknown): value is string {
  return typeof value === "string" && /^tskey-auth-[A-Za-z0-9_-]{16,256}$/.test(value);
}
