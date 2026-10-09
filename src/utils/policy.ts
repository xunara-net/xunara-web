import type { ACLRule, GrantRule, PolicyDocument } from "../api/network-types";
import type { Machine } from "../api/types";

export const services = [
  { id: "ssh", name: "SSH 远程终端", protocol: "tcp", ports: "22" },
  { id: "web", name: "Web 网站", protocol: "tcp", ports: "80,443" },
  { id: "https", name: "HTTPS", protocol: "tcp", ports: "443" },
  { id: "smb", name: "SMB 文件共享", protocol: "tcp", ports: "445" },
  { id: "rdp", name: "RDP 远程桌面", protocol: "tcp", ports: "3389" },
  { id: "dns", name: "DNS 查询", protocol: "udp", ports: "53" },
  { id: "database", name: "常用数据库", protocol: "tcp", ports: "3306,5432,6379" },
] as const;

export function deviceSelector(device: Machine): string { return device.ipv4 || device.ipv6 || ""; }

export function selectorName(selector: string, devices: readonly Machine[]): string {
  if (selector === "*") return "全部设备";
  if (selector === "autogroup:member") return "成员设备";
  if (selector === "autogroup:self") return "同一用户的设备";
  if (selector === "autogroup:tagged") return "所有设备组";
  if (selector === "autogroup:internet") return "互联网出口";
  if (selector.startsWith("tag:")) return `设备组 · ${selector.slice(4)}`;
  if (selector.startsWith("group:")) return `成员组 · ${selector.slice(6)}`;
  return devices.find((device) => device.ipv4 === selector || device.ipv6 === selector)?.hostname || selector;
}

export interface VisualRule {
  section: "acls" | "grants";
  index: number;
  sources: string[];
  destinations: string[];
  services: string[];
  editable: boolean;
}

export function visualRules(document: PolicyDocument): VisualRule[] {
  return [
    ...(document.acls ?? []).map((row, index): VisualRule => ({
      section: "acls", index, sources: row.src ?? row.users ?? [], destinations: (row.dst ?? row.ports ?? []).map((destination) => destination.slice(0, destination.lastIndexOf(":"))),
      services: (row.dst ?? row.ports ?? []).map((destination) => `${row.proto || "tcp/udp/icmp"}:${destination.slice(destination.lastIndexOf(":") + 1)}`), editable: [undefined, "", "tcp", "udp"].includes(row.proto) && new Set((row.dst ?? row.ports ?? []).map((destination) => destination.slice(destination.lastIndexOf(":") + 1))).size === 1,
    })),
    ...(document.grants ?? []).map((row, index): VisualRule => ({
      section: "grants", index, sources: row.src, destinations: row.dst, services: row.ip ?? ["应用能力（高级模式）"], editable: !row.via?.length && Boolean(row.ip?.length),
    })),
  ];
}

export function parseSelectors(value: string): string[] {
  const selectors = [...new Set(value.split(/[\s,，]+/).map((item) => item.trim()).filter(Boolean))];
  if (!selectors.length) throw new Error("请选择至少一个来源和目标");
  return selectors;
}

export function ruleIP(protocol: string, ports: string): string[] {
  if (!["tcp", "udp", "*"].includes(protocol)) throw new Error("请选择 TCP、UDP 或全部协议");
  const normalized = ports.trim().replace(/，/g, ",");
  if (normalized === "*") return [protocol === "*" ? "*" : `${protocol}:*`];
  const values = normalized.split(",").map((value) => value.trim());
  if (!values.length || values.some((value) => {
    const match = /^(\d+)(?:-(\d+))?$/.exec(value);
    return !match || Number(match[1]) < 1 || Number(match[1]) > 65535 || (match[2] !== undefined && (Number(match[2]) < Number(match[1]) || Number(match[2]) > 65535));
  })) throw new Error("端口应为 1–65535，可用逗号分隔或填写范围，例如 80,443 或 8000-8010");
  return values.map((value) => protocol === "*" ? value : `${protocol}:${value}`);
}

// 图形化只修改选中的规则，其他 SSH / tests / NodeAttrs / app 等字段完整保留。
export function putVisualRule(document: PolicyDocument, source: string, destination: string, protocol: string, ports: string, grants: boolean, editing?: VisualRule): PolicyDocument {
  if (editing && !editing.editable) throw new Error("此规则包含无法无损转换的特殊字段，请使用高级模式编辑");
  const next = structuredClone(document);
  const sources = parseSelectors(source);
  const destinations = parseSelectors(destination);
  const ip = ruleIP(protocol, ports);
  if (editing?.section === "grants" || !editing && grants) {
    const rows = next.grants ??= [];
    const previous = editing ? rows[editing.index] : undefined;
    const rule: GrantRule = { ...previous, src: sources, dst: destinations, ip };
    if (editing) rows[editing.index] = rule; else rows.push(rule);
  } else {
    const rows = next.acls ??= [];
    const previous = editing ? rows[editing.index] : undefined;
    const rule: ACLRule = { ...previous, action: "accept", src: sources, dst: destinations.map((host) => `${host}:${ports.trim().replace(/，/g, ",")}`) };
    delete rule.users;
    delete rule.ports;
    if (protocol === "*") delete rule.proto; else rule.proto = protocol;
    if (editing) rows[editing.index] = rule; else rows.push(rule);
  }
  return next;
}

export function removeVisualRule(document: PolicyDocument, rule: VisualRule): PolicyDocument {
  const next = structuredClone(document);
  next[rule.section]?.splice(rule.index, 1);
  return next;
}

export function trafficTemplate(document: PolicyDocument, template: "isolate" | "all" | "ssh" | "web", grants: boolean): PolicyDocument {
  const next = structuredClone(document);
  next.acls = [];
  next.grants = (next.grants ?? []).filter((rule) => rule.app && Object.keys(rule.app).length > 0).map((rule) => { const kept = { ...rule }; delete kept.ip; return kept; });
  if (template === "isolate") return next;
  return putVisualRule(next, "*", "*", template === "all" ? "*" : "tcp", template === "all" ? "*" : template === "ssh" ? "22" : "80,443", grants);
}

export function addressRecordProtected(record: { node_id: number; name: string; type: string }): boolean {
  return record.node_id !== 0 || record.name.startsWith("_acme-challenge.") || !["A", "AAAA"].includes(record.type);
}

export function describePolicyDiff(row: string, devices: readonly Machine[]): string {
  const separator = row.indexOf(": ");
  const section = row.slice(0, separator);
  try {
    const value = JSON.parse(row.slice(separator + 2));
    if (["acls", "grants"].includes(section)) {
      const rule = visualRules({ [section]: [value] })[0];
      if (rule) return `${rule.sources.map((selector) => selectorName(selector, devices)).join('、')} → ${rule.destinations.map((selector) => selectorName(selector, devices)).join('、')} · ${rule.services.join('、')}`;
    }
    const names: Record<string, string> = { groups: "成员组", tagOwners: "标签所有者", hosts: "地址别名", ssh: "SSH 登录策略", nodeAttrs: "设备能力", tests: "策略测试" };
    return `${names[section] || section}变更（展开查看原始内容）`;
  } catch { return row; }
}
