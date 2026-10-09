// Wire types of the Xunara Core API. They mirror the server's JSON; every
// field the console actually renders is typed, and unknown fields are simply
// ignored (the server may add fields at any time).

export interface User {
  id: number;
  loginName: string;
  displayName: string;
  email: string;
  role: "owner" | "admin" | "member" | "viewer" | string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionInfo {
  id: string;
  authMethod: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  billingCycle: string;
  unlimited: boolean;
  maxDevices: number;
  maxUsers: number;
  maxRoutes: number;
  maxAuthKeys: number;
  devicesUsed: number;
  allowCustomCidr: boolean;
  allowExitNode: boolean;
  allowSubnetRouter: boolean;
  allowApi: boolean;
  allowAcl: boolean;
  allowGrants: boolean;
  allowCustomDns: boolean;
  allowAuditLog: boolean;
  allowMultiMember: boolean;
  networkPrefix?: string;
  networkRanges?: string[];
}

export interface Snapshot {
  authenticated: boolean;
  setupRequired?: boolean;
  localLogin?: boolean;
  registration?: string;
  capabilities?: string[];
  user?: User;
  session?: SessionInfo;
  tenant?: { id: string; organizationId?: string; organizationName?: string };
  plan?: Plan;
}

export interface Machine {
  id: number;
  stableId: string;
  hostname: string;
  userId: number;
  userLoginName: string;
  online: boolean;
  ephemeral: boolean;
  expired: boolean;
  method: string;
  ipv4?: string;
  ipv6?: string;
  created: string;
  lastSeen?: string;
  approvedRoutes?: string[];
  announcedRoutes?: string[];
  effectiveRoutes?: string[];
  exitNode?: boolean;
  deviceAttrCount?: number;
  serviceCount?: number;
}

export interface PendingDevice {
  id: string;
  hostname: string;
  os: string;
  machineKey: string;
  nodeKey: string;
  created: string;
  expires: string;
}

export interface Route {
  machine: string;
  machineId: number;
  route: string;
  approved: boolean;
  primary: boolean;
  exitNode: boolean;
}

export interface DNSRecord {
  id: number;
  name: string;
  type: string;
  value: string;
}

export interface AuthKey {
  id: number;
  userId: number;
  reusable: boolean;
  ephemeral: boolean;
  used: boolean;
  tags?: string[];
  expiry?: string;
  created: string;
  usedAt?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  userId: number;
  scopes: string[];
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

export interface AuditEvent {
  id?: number;
  at?: string;
  time?: string;
  actor: string;
  action: string;
  resource: string;
  detail?: string;
}

export interface Overview {
  version: string;
  serverUrl: string;
  domain: string;
  machines: { total: number; online: number };
  users: number;
  pendingDevices: number;
  dnsRecords: number;
  authKeys: number;
  apiKeys: number;
}

export interface Organization {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface RelayInfo {
  id?: string;
  name?: string;
  region?: string;
  status?: string;
  [key: string]: unknown;
}

export interface DERPInfo {
  configured?: boolean;
  [key: string]: unknown;
}

/** Self-service sign-up: where a deployment creates a tenant per account. */
export interface SelfServiceInfo {
  endpoint: string;
  domain_suffix?: string;
  plan?: string;
}

/** What this deployment offers before anybody has signed in. */
export interface ProvidersPayload {
  providers: { id: string; name: string; start_url: string }[];
  local_login: boolean;
  setup_required: boolean;
  passkeys: boolean;
  /** closed | invite | open */
  registration: string;
  self_service?: SelfServiceInfo;
}

/** The tenant a self-service sign-up just created. */
export interface TenantSignupResult {
  authenticated: boolean;
  organization: { id: string; name: string; domain: string; url: string };
  handoff: boolean;
  user: { login_name: string; display_name: string; role: string };
}
