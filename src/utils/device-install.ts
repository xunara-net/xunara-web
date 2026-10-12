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
}
export interface DeviceInstallPermissions { allowSubnetRouter: boolean; allowExitNode: boolean; maxRoutes: number; }

export function deviceInstallCommand(serverURL: string, options: DeviceInstallOptions, permissions: DeviceInstallPermissions): string {
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
  const flags = [`--accept-dns=${options.acceptDNS}`, `--accept-routes=${options.acceptRoutes}`];
  if (hostname) flags.push(`--hostname=${JSON.stringify(hostname)}`);
  if (routes.length) flags.push(`--advertise-routes=${JSON.stringify(routes.join(","))}`);
  if (options.advertiseExitNode) flags.push("--advertise-exit-node");
  const login = `${base} ${flags.join(" ")}`;
  if (options.authMethod === "token") {
    if (options.platform === "windows") return windowsTokenCommand(login);
    return shellTokenCommand(login, options.platform === "linux" && options.installClient);
  }
  if (options.platform !== "linux" || !options.installClient) return login;
  // 先成功下载官方安装器，再执行和登录；不使用会吞掉 curl 失败的管道。
  return `( set -eu; installer="$(mktemp)"; trap 'rm -f "$installer"' 0; curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 https://tailscale.com/install.sh -o "$installer"; sh "$installer"; ${login} )`;
}

export function validDeviceAuthKey(value: unknown): value is string {
  return typeof value === "string" && /^tskey-auth-[A-Za-z0-9_-]{16,256}$/.test(value);
}

// 可复制命令只有隐藏输入和 file: 路径，真实密钥不会进入历史、进程参数或 URL。
function shellTokenCommand(login: string, install: boolean, embedded?: string): string {
  const prepare = embedded === undefined ? [
    'terminal_state="$(stty -g < /dev/tty)"',
    'printf "请输入设备 Auth Key（隐藏输入）：" > /dev/tty',
    'stty -echo < /dev/tty',
    'IFS= read -r auth_key < /dev/tty',
    'stty "$terminal_state" < /dev/tty',
    'terminal_state=""',
    'printf "\\n" > /dev/tty',
    'case "$auth_key" in tskey-auth-*) ;; *) exit 1 ;; esac',
    'printf "%s" "$auth_key" > "$key_file"',
    'unset auth_key',
  ].join("\n") : `cat > "$key_file" <<'XUNARA_DEVICE_AUTH_KEY'\n${embedded}\nXUNARA_DEVICE_AUTH_KEY`;
  const installation = install ? [
    'curl -fsSL --proto "=https" --tlsv1.2 --connect-timeout 15 --max-time 180 https://tailscale.com/install.sh -o "$workdir/install.sh"',
    'sh "$workdir/install.sh"',
  ].join("\n") + "\n" : "";
  const authorize = `${login} --auth-key=file:"$key_file"`;
  const rootAware = login.startsWith("sudo ") ? `if [ "$(id -u)" -eq 0 ]; then\n  ${authorize.slice(5)}\nelse\n  ${authorize}\nfi` : authorize;
  return ["(", "set +x +v", "set -eu", "umask 077", 'workdir="$(mktemp -d)"', 'chmod 700 "$workdir"',
    'key_file="$workdir/auth.key"', 'terminal_state=""',
    'trap \'if [ -n "$terminal_state" ]; then stty "$terminal_state" < /dev/tty; fi; rm -rf -- "$workdir"\' 0',
    "trap 'exit 129' HUP", "trap 'exit 130' INT", "trap 'exit 143' TERM", prepare,
    'chmod 600 "$key_file"', installation + rootAware, ")"].join("\n");
}

function windowsTokenCommand(login: string): string {
  return ["$ErrorActionPreference = 'Stop'", "$keyDir = Join-Path ([IO.Path]::GetTempPath()) ('xunara-device-' + [guid]::NewGuid().ToString('N'))",
    "$keyFile = Join-Path $keyDir 'auth.key'", "$buffer = [IntPtr]::Zero", "$secret = $null", "try {",
    "  New-Item -ItemType Directory -Path $keyDir | Out-Null",
    "  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().User",
    "  $acl = New-Object System.Security.AccessControl.DirectorySecurity",
    "  $acl.SetAccessRuleProtection($true, $false)",
    "  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))",
    "  Set-Acl -LiteralPath $keyDir -AclObject $acl",
    "  $secret = Read-Host '请输入设备 Auth Key（隐藏输入）' -AsSecureString",
    "  $buffer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)",
    "  [IO.File]::WriteAllText($keyFile, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($buffer), (New-Object System.Text.UTF8Encoding($false)))",
    `  ${login} --auth-key=("file:" + $keyFile)`,
    "  if ($LASTEXITCODE -ne 0) { throw '客户端接入失败，请检查地址、密钥有效期和设备额度' }", "} finally {",
    "  if ($buffer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($buffer) }",
    "  if ($secret) { $secret.Dispose() }", "  if (Test-Path -LiteralPath $keyDir) { Remove-Item -LiteralPath $keyDir -Recurse -Force }", "}"].join("\n");
}

// 含密钥的脚本只允许显式私有下载；不要把它当作可复制终端命令显示。
export function privateDeviceInstallScript(serverURL: string, options: DeviceInstallOptions, permissions: DeviceInstallPermissions, token: string): string {
  if (options.platform !== "linux") throw new Error("私有一键脚本只用于 Linux；其他桌面平台使用隐藏输入命令");
  if (!validDeviceAuthKey(token)) throw new Error("请输入设备 Auth Key（tskey-auth- 开头），不是后台令牌或 API Key");
  const login = deviceInstallCommand(serverURL, { ...options, installClient: false, authMethod: "browser" }, permissions);
  return '#!/bin/sh\nset +x +v\nset -eu\numask 077\nif [ -f "$0" ]; then chmod 700 "$0"; fi\n' + shellTokenCommand(login, options.installClient, token) + "\n";
}
