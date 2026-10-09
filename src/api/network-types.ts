export interface ACLRule {
  action?: string;
  proto?: string;
  src?: string[];
  dst?: string[];
  users?: string[];
  ports?: string[];
}
export interface GrantRule {
  src: string[];
  dst: string[];
  ip?: string[];
  app?: Record<string, unknown[]>;
  via?: string[];
}
export interface PolicyDocument {
  acls?: ACLRule[];
  grants?: GrantRule[];
  groups?: Record<string, string[]>;
  hosts?: Record<string, string>;
  tagOwners?: Record<string, string[]>;
  ssh?: unknown[];
  nodeAttrs?: unknown[];
  tests?: unknown[];
  [key: string]: unknown;
}
export interface PolicyConfiguration {
  revision: number;
  base_hash: string;
  source: "default" | "file" | "database";
  content: string;
  document: PolicyDocument;
  can_edit: boolean;
  can_grants: boolean;
  csrf_token: string;
}
export interface PolicyDraft {
  revision: number;
  base_hash: string;
  content?: string;
  restore_from?: number;
}
export interface PolicyValidation {
  document: PolicyDocument;
  rule_count: number;
  warnings: string[];
  publishable: boolean;
  entitlement_error: string;
  tests: { total: number; ran: boolean; reason?: string; results: { index: number; src: string; pass: boolean; failures: string[] }[] };
  diff: { added: string[]; removed: string[]; sections: string[] };
}
export interface PolicyHistory {
  revision: number;
  content: string;
  actor: string;
  created: string;
}
export interface PolicyProbe {
  content?: string;
  source: number;
  destination: number;
  protocol: "tcp" | "udp";
  port: number;
}
export interface PolicyExplanation {
  allowed: boolean;
  draft: boolean;
  matches: { section: "acls" | "grants"; index: number; sources: string[]; destinations: string[] }[];
  reason: string;
}
export interface DNSSettings {
  magic_dns: boolean;
  nameservers: string[];
  search_domains: string[];
  split_dns: Record<string, string[]>;
}
export interface DNSConfiguration {
  revision: number;
  base_hash: string;
  domain: string;
  settings: DNSSettings;
  can_edit: boolean;
  csrf_token: string;
}
export interface AddressRecord {
  id: number;
  revision: number;
  name: string;
  type: string;
  value: string;
  node_id: number;
  created: string;
}
export interface RelayEnrollment {
  id: string;
  name?: string;
  visibility: string;
  expiresAt?: string;
  usedAt?: string;
  createdAt?: string;
  used: boolean;
  expired: boolean;
}

export interface RelayPool {
  items: import("./types").ManagedRelay[];
  used: number;
  limit: number;
  csrf_token: string;
  control_url: string;
}
