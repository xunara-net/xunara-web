// Typed wrappers over the endpoints the console uses. Views call these and
// stay free of URL strings, which keeps the API version in one place.

import { api } from "./client";
import type {
  ApiKey,
  AuditEvent,
  AuthKey,
  DERPInfo,
  DNSRecord,
  Machine,
  Organization,
  Overview,
  PendingDevice,
  Plan,
  RelayInfo,
  Route,
  SessionInfo,
  Snapshot,
  User,
} from "./types";

// ---- authentication -------------------------------------------------------

export const getSession = () => api<Snapshot>("/api/v1/auth/session");

export const getProviders = () =>
  api<{
    providers: { id: string; name: string; start_url: string }[];
    local_login: boolean;
    setup_required: boolean;
    passkeys: boolean;
    registration: string;
  }>("/api/v1/auth/providers");

export const login = (login: string, password: string) =>
  api<Snapshot>("/api/v1/auth/login", { method: "POST", body: { login, password } });

export const signup = (body: {
  invite: string;
  login: string;
  display_name: string;
  email: string;
  password: string;
}) => api<Snapshot>("/api/v1/auth/signup", { method: "POST", body });

export const logout = () => api<void>("/api/v1/auth/logout", { method: "POST", body: {} });

// ---- tenant overview ------------------------------------------------------

export const getOverview = () => api<Overview>("/api/v1/overview");
export const getPlan = () => api<Plan>("/api/v1/plan");
export const getOrganization = () => api<Organization>("/api/v2/organization");

// ---- devices --------------------------------------------------------------

export const listMachines = async (): Promise<Machine[]> =>
  (await api<{ machines: Machine[] | null }>("/api/v1/machines")).machines ?? [];

export const getMachine = (ref: string | number) => api<Machine>(`/api/v1/machines/${ref}`);

export const deleteMachine = (ref: string | number) =>
  api<void>(`/api/v1/machines/${ref}`, { method: "DELETE" });

export const setMachineRoutes = (ref: string | number, routes: string[]) =>
  api<{ approvedRoutes?: string[] }>(`/api/v1/machines/${ref}/routes`, {
    method: "POST",
    body: { routes },
  });

export const listPendingDevices = async (): Promise<PendingDevice[]> =>
  (await api<{ devices: PendingDevice[] | null }>("/api/v1/devices")).devices ?? [];

export const approveDevice = (id: string) =>
  api<void>(`/api/v1/devices/${id}/approve`, { method: "POST", body: {} });

export const denyDevice = (id: string) =>
  api<void>(`/api/v1/devices/${id}/deny`, { method: "POST", body: {} });

// ---- network --------------------------------------------------------------

export const listRoutes = async (): Promise<Route[]> =>
  (await api<{ routes: Route[] | null }>("/api/v1/routes")).routes ?? [];

export const listDNS = async (): Promise<DNSRecord[]> =>
  (await api<{ records: DNSRecord[] | null }>("/api/v1/dns")).records ?? [];

export const deleteDNS = (id: number) => api<void>(`/api/v1/dns/${id}`, { method: "DELETE" });

export const getPolicy = () =>
  api<{
    configured: boolean;
    path?: string;
    rules?: number;
    warnings?: string[];
    unsupported?: string[];
    loadError?: string;
  }>("/api/v1/policy");

export const getDERP = () => api<DERPInfo>("/api/v2/derp");

export const listRelays = async (): Promise<RelayInfo[]> =>
  (await api<{ relays: RelayInfo[] | null }>("/api/v2/relays")).relays ?? [];

export const listExitNodes = () => api<{ exitNodes?: unknown[] }>("/api/v2/exit-nodes");

// ---- account --------------------------------------------------------------

export const listUsers = async (): Promise<User[]> =>
  (await api<{ users: User[] | null }>("/api/v1/users")).users ?? [];

export const updateUser = (
  id: number,
  body: { role?: string; displayName?: string; email?: string },
) => api<User>(`/api/v1/users/${id}`, { method: "PATCH", body });

export const listSessions = async (): Promise<SessionInfo[]> =>
  (await api<{ sessions: SessionInfo[] | null }>("/api/v1/sessions")).sessions ?? [];

export const revokeSession = (id: string) =>
  api<void>(`/api/v1/sessions/${id}`, { method: "DELETE" });

export const listAuthKeys = async (): Promise<AuthKey[]> =>
  (await api<{ authKeys: AuthKey[] | null }>("/api/v1/auth-keys")).authKeys ?? [];

export const createAuthKey = (body: {
  reusable: boolean;
  ephemeral: boolean;
  ttl?: string;
  tags?: string[];
}) => api<{ id: number; key: string }>("/api/v1/auth-keys", { method: "POST", body });

export const deleteAuthKey = (id: number) =>
  api<void>(`/api/v1/auth-keys/${id}`, { method: "DELETE" });

export const listAPIKeys = async (): Promise<ApiKey[]> =>
  (await api<{ apiKeys: ApiKey[] | null }>("/api/v1/api-keys")).apiKeys ?? [];

export const createAPIKey = (body: { name: string; scopes: string[]; ttl?: string }) =>
  api<{ id: string; name: string; token: string }>("/api/v1/api-keys", { method: "POST", body });

export const revokeAPIKey = (id: string) => api<void>(`/api/v1/api-keys/${id}`, { method: "DELETE" });

export const listAudit = async (limit = 100): Promise<AuditEvent[]> =>
  (
    await api<{ events: AuditEvent[] | null }>("/api/v1/audit", { query: { limit } })
  ).events ?? [];

export const getSecurity = () => api<Record<string, unknown>>("/api/v2/security");
