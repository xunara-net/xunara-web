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

export interface AccountSession extends SessionInfo {
  status: "active" | "expired" | "revoked";
}

export interface AccountSessions {
  sessions: AccountSession[];
  currentSessionId: string;
  csrfToken: string;
  generatedAt: string;
}

export interface AccountSessionsPayload {
  sessions: {
    id: string;
    auth_method: string;
    created_at: string;
    expires_at: string;
    status: AccountSession["status"];
    revoked_at?: string;
    revoked_reason?: string;
  }[];
  current_session_id: string;
  csrf_token: string;
  generated_at: string;
}

export interface SessionRevocationResult {
  revoked_sessions: number;
  current_revoked: boolean;
}

export interface SecurityFinding {
  id: string;
  severity: string;
  title: string;
  detail: string;
}

export interface SecuritySnapshot {
  generatedAt: string;
  policy: { configured: boolean; ruleCount: number; loadError?: string };
  tailnetLock: { enabled: boolean };
  nodes: { total: number; expired: number; expiringSoon: number };
  devices: { pending: number };
  apiKeys: { live: number; neverExpires: number };
  derp: { mapConfigured: boolean; regionsServed: number };
  findings: SecurityFinding[] | null;
}

export interface UserPayload {
  id: number;
  login_name: string;
  display_name: string;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface AccountInfo {
  user: User;
  passwordChangeEnabled: boolean;
  csrfToken: string;
}

export interface AccountPayload {
  user: UserPayload;
  password_change_enabled: boolean;
  csrf_token: string;
}

export interface ProfileUpdate {
  display_name?: string;
  email?: string;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
}

export interface PasswordChangeResult {
  changed: boolean;
  revoked_sessions: number;
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

export interface PlanPayload {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  billing_cycle: string;
  unlimited: boolean;
  max_devices: number;
  max_users: number;
  max_routes: number;
  max_auth_keys: number;
  devices_used: number;
  allow_custom_cidr: boolean;
  allow_exit_node: boolean;
  allow_subnet_router: boolean;
  allow_api: boolean;
  allow_acl: boolean;
  allow_grants: boolean;
  allow_custom_dns: boolean;
  allow_audit_log: boolean;
  allow_multi_member: boolean;
  network_prefix?: string;
  network_ranges?: string[];
}

export interface SnapshotPayload {
  authenticated: boolean;
  setup_required?: boolean;
  local_login?: boolean;
  registration?: string;
  capabilities?: string[];
  user?: UserPayload;
  session?: {
    id: string;
    auth_method: string;
    created_at: string;
    expires_at: string;
    last_seen_at?: string;
  };
  tenant?: { id: string; organization_id?: string; organization_name?: string };
  plan?: PlanPayload;
}

export interface AccountPasskey {
  id: string;
  name: string;
  created_at: string;
  last_used_at?: string;
}

export interface AccountPasskeys {
  passkeys: AccountPasskey[];
  enabled: boolean;
  csrf_token: string;
}

// 上游 JSON 使用 base64url，浏览器 WebAuthn API 则接收二进制 BufferSource。
// 只描述传输差异，不在前端重新实现签名或账户身份验证。
type PasskeyDescriptorJSON = Omit<PublicKeyCredentialDescriptor, "id"> & { id: string };

export type PasskeyCreationOptionsJSON = Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
  excludeCredentials?: PasskeyDescriptorJSON[];
};

export type PasskeyRequestOptionsJSON = Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & {
  challenge: string;
  allowCredentials?: PasskeyDescriptorJSON[];
};

export interface PasskeyCredentialJSON {
  id: string;
  rawId: string;
  type: string;
  authenticatorAttachment: string | null;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  response: {
    clientDataJSON: string;
    attestationObject?: string;
    transports?: string[];
    authenticatorData?: string;
    signature?: string;
    userHandle?: string | null;
  };
}

export interface AuditPayload {
  ID: number;
  Time: string;
  Actor: string;
  Action: string;
  Target: string;
  Detail: string;
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
  os?: string;
  osVersion?: string;
  clientVersion?: string;
  dnsName?: string;
  expires?: string;
  tags?: string[];
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

export interface RelayExecution {
  config_version: string;
  applied_version?: string;
  status: "applied" | "failed";
  state: "pending" | "online" | "maintenance" | "disabled" | "revoked";
  bandwidth_limit: number;
  error_code?: string;
}

export interface ManagedRelay {
  id: string;
  name: string;
  hostname: string;
  regionCode?: string;
  regionName?: string;
  regionId: number;
  certName?: string;
  visibility: string;
  configVersion: number;
  bandwidthLimit: number;
  derpPort?: number;
  stunPort?: number;
  version?: string;
  connectedClients?: number;
  desiredState: string;
  online: boolean;
  healthy: boolean;
  lastSeen?: string;
  execution?: RelayExecution;
  executionReportedAt?: string;
}

export interface DERPInfo {
  mapConfigured: boolean;
  regionsServed: number;
  policyMode: string;
  regions: { id: number; code: string; name: string; hosts: string[]; nodeCount: number }[];
  [key: string]: unknown;
}

export interface MemberInvitation {
  id: string;
  role: "member" | "admin";
  note: string;
  created_at: string;
  expires_at: string;
  used_at: string;
  used_by: number;
  status: "pending" | "redeemed" | "expired";
}

export interface MemberInvitations {
  items: MemberInvitation[];
  enabled: boolean;
  registration_url: string;
  csrf_token: string;
}

export interface MemberInvitationRequest {
  role: "member" | "admin";
  note: string;
  ttl_hours: number;
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
