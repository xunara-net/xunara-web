import { relayRelease } from "./relay-downloads";

export interface RelayInstallOptions { hostname: string; port: number; regionId: number; stun: boolean; stunPort: number; controlCAFile: string; upgrade: boolean; }
const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

export function privateRelayInstallCommand(controlURL: string, options: RelayInstallOptions, blockedRegions: number[] = []): string {
  const controller = new URL(controlURL);
  if (controller.protocol !== "https:" || controller.username || controller.password || controller.search || controller.hash ||
      controller.pathname !== "/" || !/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)$/i.test(controller.hostname)) throw new Error("私有中继安装需要不含凭据的 HTTPS 控制面根地址");
  const hostname = options.hostname.trim();
  const validHost = hostname.includes(":")
    ? /^[a-fA-F0-9:]+$/.test(hostname) && (() => { try { return new URL(`https://[${hostname}]/`).hostname.startsWith("["); } catch { return false; } })()
    : hostname.split(".").every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
  if (!hostname || hostname.length > 253 || !validHost) throw new Error("请填写中继服务器公网域名或 IP，不包含端口");
  if (![options.port, options.stunPort].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 65535) ||
    !Number.isSafeInteger(options.regionId) || options.regionId <= 0 || options.regionId > 2147483647 ||
    typeof options.stun !== "boolean" || typeof options.upgrade !== "boolean") throw new Error("请填写有效端口、区域编号和安装选项");
  if (!options.upgrade && blockedRegions.includes(options.regionId)) throw new Error("区域编号已被当前地图或私有节点使用，请换一个编号");
  if (options.controlCAFile && !/^\/[a-zA-Z0-9_./-]+$/.test(options.controlCAFile)) throw new Error("CA 文件需填写目标服务器上的绝对路径，不填写私钥");
  const argumentsList = ["--control-url", quote(controller.origin), "--hostname", quote(hostname), "--port", String(options.port), "--region-id", String(options.regionId)];
  if (options.stun) argumentsList.push("--stun", "--stun-port", String(options.stunPort));
  if (options.controlCAFile) argumentsList.push("--control-ca-file", quote(options.controlCAFile));
  if (options.upgrade) argumentsList.push("--upgrade");
  const base = `https://github.com/xunara-net/xunara-relay/releases/download/${relayRelease.version}`;
  // 先校验固定发布版脚本，再提权执行；接入令牌由脚本在服务器终端隐藏读取。
  return `( set -eu; work="$(mktemp -d)"; trap 'rm -rf "$work"' 0; curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 180 ${quote(base + "/install-private-relay.sh")} -o "$work/install-private-relay.sh"; curl -fsSL --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 60 ${quote(base + "/SHA256SUMS")} -o "$work/SHA256SUMS"; expected="$(awk '$2 == \"install-private-relay.sh\" { print $1 }' \"$work/SHA256SUMS\")"; ( cd "$work"; printf '%s  install-private-relay.sh\\n' "$expected" | sha256sum --check --status - ); sudo bash "$work/install-private-relay.sh" ${argumentsList.join(" ")} )`;
}
