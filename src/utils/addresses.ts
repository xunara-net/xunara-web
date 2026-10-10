function ipv4Number(value: string): number {
  const octets = value.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^(0|[1-9]\d{0,2})$/.test(octet) || Number(octet) > 255)) throw new Error("请填写有效 IPv4 地址，例如 100.101.50.20");
  return octets.reduce((result, octet) => result * 256 + Number(octet), 0);
}
function prefixRange(value: string): { base: number; size: number; bits: number } {
  const [address, length, extra] = value.trim().split("/");
  if (!address || !length || extra !== undefined || !/^\d{1,2}$/.test(length) || Number(length) > 32) throw new Error("请填写 IPv4 CIDR，例如 100.101.50.0/24");
  const size = 2 ** (32 - Number(length));
  return { base: Math.floor(ipv4Number(address) / size) * size, size, bits: Number(length) };
}
function asIPv4(value: number): string { return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join("."); }
function overlap(base: number, size: number, ranges: string[]): boolean {
  return ranges.some((prefix) => { const reserved = prefixRange(prefix); return base < reserved.base + reserved.size && reserved.base < base + size; });
}
export function normalizeAllocationRange(value: string, reserved: string[]): string {
  const range = prefixRange(value), allowed = prefixRange("100.64.0.0/10");
  if (range.bits < 16 || range.bits > 28 || range.base < allowed.base || range.base + range.size > allowed.base + allowed.size) throw new Error("设备网段须为 100.64.0.0/10 内的 /16～/28；192.168、10、172 内网请使用子网路由");
  if (overlap(range.base, range.size, reserved)) throw new Error("网段与客户端或平台保留地址冲突，请换一个网段");
  return `${asIPv4(range.base)}/${range.bits}`;
}
export function validateDeviceIPv4(value: string, prefix: string, reserved: string[]): string {
  const address = ipv4Number(value.trim()), range = prefixRange(prefix), allowed = prefixRange("100.64.0.0/10");
  if (address < allowed.base || address >= allowed.base + allowed.size || address <= range.base || address >= range.base + range.size - 1 || overlap(address, 1, reserved)) throw new Error("IP 必须在当前网段内，不能使用网络地址、广播地址或保留地址");
  return asIPv4(address);
}
