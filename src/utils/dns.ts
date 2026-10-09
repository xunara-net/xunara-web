import type { DNSSettings } from "../api/network-types";

export function dnsEntries(value: string): string[] { return [...new Set(value.split(/[\s,，]+/).map((entry) => entry.trim()).filter(Boolean))]; }
export function buildDNSSettings(magic: boolean, nameservers: string, search: string, split: { domain: string; servers: string }[]): DNSSettings {
  const routes: Record<string, string[]> = {};
  for (const row of split) {
    const domain = row.domain.trim().toLowerCase().replace(/\.$/, "");
    const servers = dnsEntries(row.servers);
    if (!domain || !servers.length) throw new Error("每条分流 DNS 都需填写域名和至少一个解析器");
    if (Object.hasOwn(routes, domain)) throw new Error(`分流域名重复：${domain}`);
    routes[domain] = servers;
  }
  return { magic_dns: magic, nameservers: dnsEntries(nameservers), search_domains: dnsEntries(search), split_dns: routes };
}
export function fullRecordName(value: string, domain: string): string {
  const name = value.trim().toLowerCase().replace(/\.$/, "");
  if (!name || !domain) throw new Error("请填写记录名称，并先配置网络域名");
  return name.includes(".") ? name : `${name}.${domain}`;
}
