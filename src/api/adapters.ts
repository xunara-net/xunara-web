import type {
  AccountInfo,
  AccountPayload,
  AuditEvent,
  AuditPayload,
  Plan,
  PlanPayload,
  SessionInfo,
  SessionPayload,
  Snapshot,
  SnapshotPayload,
  User,
  UserPayload,
} from "./types";

export function toUser(payload: UserPayload): User {
  return {
    id: payload.id,
    loginName: payload.login_name,
    displayName: payload.display_name,
    email: payload.email,
    role: payload.role,
    createdAt: payload.created_at,
    updatedAt: payload.updated_at,
  };
}

export function toAccount(payload: AccountPayload): AccountInfo {
  return {
    user: toUser(payload.user),
    passwordChangeEnabled: payload.password_change_enabled,
    csrfToken: payload.csrf_token,
  };
}

export function toPlan(payload: PlanPayload): Plan {
  return {
    id: payload.id,
    name: payload.name,
    priceCents: payload.price_cents,
    currency: payload.currency,
    billingCycle: payload.billing_cycle,
    unlimited: payload.unlimited,
    maxDevices: payload.max_devices,
    maxUsers: payload.max_users,
    maxRoutes: payload.max_routes,
    maxAuthKeys: payload.max_auth_keys,
    devicesUsed: payload.devices_used,
    allowCustomCidr: payload.allow_custom_cidr,
    allowExitNode: payload.allow_exit_node,
    allowSubnetRouter: payload.allow_subnet_router,
    allowApi: payload.allow_api,
    allowAcl: payload.allow_acl,
    allowGrants: payload.allow_grants,
    allowCustomDns: payload.allow_custom_dns,
    allowAuditLog: payload.allow_audit_log,
    allowMultiMember: payload.allow_multi_member,
    networkPrefix: payload.network_prefix,
    networkRanges: payload.network_ranges,
  };
}

export function toSnapshot(payload: SnapshotPayload): Snapshot {
  return {
    authenticated: payload.authenticated,
    setupRequired: payload.setup_required,
    localLogin: payload.local_login,
    registration: payload.registration,
    capabilities: payload.capabilities,
    user: payload.user && toUser(payload.user),
    session: payload.session && {
      id: payload.session.id,
      authMethod: payload.session.auth_method,
      createdAt: payload.session.created_at,
      expiresAt: payload.session.expires_at,
      lastSeenAt: payload.session.last_seen_at,
    },
    tenant: payload.tenant && {
      id: payload.tenant.id,
      organizationId: payload.tenant.organization_id,
      organizationName: payload.tenant.organization_name,
    },
    plan: payload.plan && toPlan(payload.plan),
  };
}

function optionalTime(value: string): string | undefined {
  return value && value !== "0001-01-01T00:00:00Z" ? value : undefined;
}

export function toSession(payload: SessionPayload): SessionInfo {
  return {
    id: payload.ID,
    authMethod: payload.AuthMethod,
    createdAt: payload.CreatedAt,
    expiresAt: payload.ExpiresAt,
    lastSeenAt: optionalTime(payload.LastSeenAt),
    revokedAt: optionalTime(payload.RevokedAt),
    revokedReason: payload.RevokedReason,
  };
}

export function toAuditEvent(payload: AuditPayload): AuditEvent {
  return {
    id: payload.ID,
    time: payload.Time,
    actor: payload.Actor,
    action: payload.Action,
    resource: payload.Target,
    detail: payload.Detail,
  };
}
