// The one place the console talks to the control plane.
//
// Every request is same-origin and carries the session cookie; the server
// answers JSON and never redirects API calls. Errors become ApiError with the
// status and the server's message, so views can show something useful instead
// of "HTTP 403".

import { consolePath } from "../utils/console";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  /** codePrefix returns the stable machine prefix of a message, if any. */
  get errorCode(): string {
    const match = /^([A-Z_]+):/.exec(this.message);
    return this.code || (match ? match[1] : "");
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  redirect?: RequestRedirect;
};

async function requestAPI<T>(path: string, options: RequestOptions, read: (response: Response) => Promise<T>): Promise<T> {
  const url = new URL(consolePath(path), window.location.origin);
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path) || url.origin !== window.location.origin) {
    throw new ApiError(400, "API_RESPONSE_INVALID: invalid same-origin API path");
  }
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const init: RequestInit = {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...options.headers },
    redirect: options.redirect,
  };
  const controller = new AbortController();
  init.signal = controller.signal;
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) controller.abort();
  if (options.body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, init);
    return await read(response);
  } catch (err) {
    if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (controller.signal.aborted) throw new ApiError(408, "REQUEST_TIMEOUT: request outcome is unknown; refresh before submitting again");
    throw err;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

function parseAPIResponse(text: string): any {
  let payload: any = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  return payload;
}

function failedAPIResponse(response: Response, text: string): ApiError {
  const payload = parseAPIResponse(text);
  const message = payload?.message ?? payload?.error ?? (text ? text.slice(0, 200) : `HTTP ${response.status}`);
  return new ApiError(response.status, message, typeof payload?.code === "string" ? payload.code : "");
}

/** api performs one JSON request against the control plane. */
export function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return requestAPI(path, options, async (response) => {
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!response.ok) throw failedAPIResponse(response, text);
    const payload = parseAPIResponse(text);
    if (payload === undefined) throw new ApiError(502, "API_RESPONSE_INVALID: expected a JSON response");
    return payload as T;
  });
}

export interface DownloadResponse {
  blob: Blob;
  headers: Headers;
}

// 文件和 JSON 共用超时 / 错误策略；实际读取也有字节上限，不信任 Content-Length。
export function apiDownload(path: string, options: RequestOptions, maxBytes: number): Promise<DownloadResponse> {
  if (new URL(path, window.location.origin).origin !== window.location.origin || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return Promise.reject(new ApiError(400, "INVALID_ACCOUNT_EXPORT: invalid private download target or bound"));
  }
  return requestAPI(path, { ...options, redirect: "error" }, async (response) => {
    // 浏览器会自动解压；压缩传输的长度不能与解压后的私人文件比较。
    const encoding = response.headers.get("Content-Encoding")?.trim().toLowerCase();
    const length = !encoding || encoding === "identity" ? response.headers.get("Content-Length") : null;
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
      await response.body?.cancel();
      throw new ApiError(413, "ACCOUNT_EXPORT_TOO_LARGE: download exceeds the byte limit");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError(502, "API_RESPONSE_INVALID: missing download body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        total += result.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new ApiError(413, "ACCOUNT_EXPORT_TOO_LARGE: download exceeds the byte limit");
        }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    const blob = new Blob(chunks, { type: response.headers.get("Content-Type") ?? "" });
    if (!response.ok) throw failedAPIResponse(response, await blob.text());
    if (!total || length !== null && Number(length) !== total) throw new ApiError(502, "API_RESPONSE_INVALID: incomplete download");
    return { blob, headers: response.headers };
  });
}

/** errorMessage renders any thrown value for a person. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.errorCode;
    // 可修正的地址池冲突与历史接口只给操作建议；保留既有错误的展示契约。
    if (code === "ADDRESS_POOL_EXHAUSTED" || code === "LOGIN_HISTORY_FAILED" || code === "INVALID_LOGIN_HISTORY_PAGE" || code.startsWith("ACCOUNT_EXPORT_") || code === "INVALID_ACCOUNT_EXPORT") {
      return `${humanizeCode(code)}（${code}）`;
    }
    return code ? `${humanizeCode(code)}（${err.message}）` : err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

const codeMessages: Record<string, string> = {
  SHARE_RECIPIENT_UNAVAILABLE: "无法向该账号分享，请核对对方在本平台的用户名；重名、禁用或不存在的账户不能接收",
  SHARE_UNAVAILABLE: "设备或账户状态已变化，请联系对方确认并重新发出分享",
  SHARE_FORBIDDEN: "只有有效的人类会话和网络管理员可以发出或管理分享",
  SHARING_DISABLED: "此部署未启用跨网络设备分享",
  SHARE_NOT_FOUND: "分享或设备不存在，或不属于当前账户",
  SHARE_SAME_NETWORK: "同一网络的成员使用访问权限规则，无需跨网络分享",
  SHARE_EXISTS: "已向该用户发出这台设备的有效分享，请在分享列表查看，不要重复发送",
  SHARE_CHANGED: "分享已被其他操作修改，请刷新列表后再操作",
  SHARE_TAILNET_LOCKED: "启用了 Tailnet Lock 的网络暂不支持跨网络分享",
  SHARES_UNAVAILABLE: "暂时无法确认分享结果，请刷新列表核对后再操作",
  SHARE_RATE_LIMITED: "分享邀请发送过于频繁，请稍后再试",
  ACCOUNT_EXPORT_UNAVAILABLE: "暂时无法准备导出，未生成下载文件；请稍后显式重试",
  ACCOUNT_EXPORT_TOO_LARGE: "数据超过导出上限，请缩小登录记录日期范围或联系管理员；不会截断记录",
  ACCOUNT_EXPORT_RATE_LIMITED: "导出请求过多，请等待约 15 分钟后重试",
  INVALID_ACCOUNT_EXPORT: "导出格式或日期范围无效，请检查输入",
  PASSWORD_RESET_RETIRED: "旧重置码已停用，请联系平台管理员获取随机临时密码，再从正常登录页登录",
  PASSWORD_CHANGE_REQUIRED: "请先将管理员提供的临时密码修改为自己的新密码",
  PASSWORD_CONFIRMATION_INVALID: "两次输入的新密码不一致",
  AUTH_CONFIG_CHANGED: "登录设置已被其他管理员修改，请刷新核对，草稿不会自动覆盖新版本",
  AUTH_CONFIG_VERSION_REQUIRED: "缺少配置版本，请刷新登录设置后保存",
  AUTH_CONFIG_INVALID: "登录配置无效，请核对应用凭据、字段及公网 HTTPS 地址",
  AUTH_CONFIG_UNAVAILABLE: "暂时无法读取或保存登录设置，请稍后刷新核对实际结果",
  PROVIDER_ID_RESERVED: "此提供方 ID 已被使用或归档，请选择新的 ID",
  PROVIDER_ARCHIVED: "此提供方已归档，不能复用，请创建新的 ID",
  PROVIDER_NOT_FOUND: "登录提供方已不存在，请刷新列表",
  DEPLOYMENT_PROVIDER: "部署配置的提供方只能在此启停，身份域变更请创建新 ID",
  PLATFORM_REQUIRED: "独立网络公开开户仅可由平台管理员管理",
  OWNER_REQUIRED: "只有网络所有者可以管理邀请和登录配置",
  REGISTRATION_CLOSED: "平台已关闭公开开户，请联系管理员",
  LAST_LOGIN_METHOD: "不能解绑最后一种可用登录方式，请先设置另一种登录方式",
  IDENTITIES_UNAVAILABLE: "无法读取或保存第三方绑定，请刷新后重试",
  IDENTITY_NOT_FOUND: "绑定不存在或不属于当前账户，请刷新列表",
  LINK_BROWSER_REQUIRED: "请在已登录的浏览器中发起绑定",
  PROVIDER_UNAVAILABLE: "第三方登录服务暂时不可用，请稍后再试",
  PROVIDER_INVALID: "请选择已配置的第三方登录提供方",
  AUTHORIZATION_UNAVAILABLE: "授权服务暂时不可用，请稍后再试",
  INVITATION_INVALID: "邀请码无效、已使用、被撤销或过期，请向网络所有者获取新码",
  MEMBER_CHANGED: "成员信息已被其他管理员修改，请刷新列表后重新确认，不会自动覆盖",
  LAST_OWNER: "至少保留一名网络所有者，请先授予另一名成员所有者角色",
  MEMBER_WRITE_FORBIDDEN: "当前所有者或服务密钥权限已变化，请重新确认登录身份",
  MEMBER_INVALID: "成员角色或数据版本无效，请刷新并检查输入",
  MEMBER_NOT_FOUND: "成员已不存在，请刷新列表",
  MEMBERS_UNAVAILABLE: "暂时无法读取或修改成员，请稍后刷新检查操作结果",
  LOGIN_NAME_TAKEN: "该用户名已注册，请直接登录或使用其他用户名；不会重复创建网络",
  ADDRESS_CHANGED: "网段或设备 IP 已被其他管理员修改，请关闭并刷新后重新操作",
  ADDRESS_IN_USE: "该 IP 或网段已被占用，旧网段仍可能被其他设备使用",
  ADDRESS_INVALID: "地址无效，请检查当前网段、系统保留段与地址格式",
  ADDRESS_POOL_EXHAUSTED: "当前网络默认地址池没有可分配的 IP，设备尚未接入；请调整默认网段或联系平台管理员重新分配，修正后刷新再确认",
  DERP_MAP_INVALID: "中继地图格式无效，请检查地区编号、主机、端口和 TLS 校验",
  DERP_REGION_CONFLICT: "地区编号与默认或已接入中继冲突，请选择其它编号",
  DERP_IMPORT_FAILED: "暂时无法读取官方公共地图，原有中继配置未改变",
  REQUEST_TIMEOUT: "请求超时，尚未确认操作结果；请先刷新检查，勿连续重复提交",
  API_RESPONSE_INVALID: "服务响应格式异常，请刷新重试",
  AUTH_UNAVAILABLE: "登录服务暂时不可用，当前会话未被退出，请稍后重试",
  DEVICE_LIMIT_REACHED: "当前套餐的设备数已达上限，升级套餐后可继续添加设备",
  DEVICE_CHANGED: "设备身份或有效期已变化，尚未确认本次操作；请读取最新状态后重新确认",
  DEVICE_NOT_FOUND: "设备已删除或不属于当前网络，请返回设备列表核对",
  DEVICE_REVISION_REQUIRED: "请先读取当前设备有效期，再确认操作",
  DEVICE_EXPIRY_INVALID: "请选择未来 180 天以内的到期时间，不要混用不同过期方式",
  DEVICE_EXPIRED: "设备已过期，请先临时续期 30 分钟，再重新认证或调整有效期",
  DEVICE_NOT_EXPIRED: "设备尚未过期，无需临时续期；请读取最新状态",
  AUTH_KEY_TTL_INVALID: "接入密钥有效期需在 15 分钟～24 小时之间",
  AUTH_KEY_LIMIT_REACHED: "预授权密钥数量已达上限，请删除不再使用的密钥或升级套餐",
  USER_LIMIT_REACHED: "成员数量已达上限，请升级套餐",
  INVITATIONS_DISABLED: "当前网络未开启成员邀请，请由所有者在「登录与注册」调整准入策略",
  INVITATIONS_UNAVAILABLE: "暂时无法读取或管理邀请，请稍后重试",
  INVITATION_NOT_FOUND: "邀请不存在，可能已被撤销，请刷新列表",
  INVITATION_USED: "此邀请已使用，记录不能撤销",
  INVALID_INVITATION: "请选择成员或管理员角色，并填写有效期和不超过 200 字的备注",
  REGISTRATION_UNAVAILABLE: "注册服务暂时不可用，请稍后重试",
  LOGIN_NAME_INVALID: "用户名需为 1～128 位字母、数字或 @ . _ - +，且不能以符号开头或结尾",
  REGISTRATION_OUTCOME_UNKNOWN: "尚未确认注册结果，请先在登录页面检查账号，不要重复创建网络",
  REGISTRATION_ORIGIN_REQUIRED: "请从部署管理员提供的正式主域名注册，不要使用旧 IP 或备用地址",
  ROUTE_LIMIT_REACHED: "路由数量已达上限，请撤销不用的路由或升级套餐",
  ROUTES_CHANGED: "路由宣告、批准或设备身份已改变，草稿保留；请读取最新状态后重新预览",
  ROUTE_NOT_ANNOUNCED: "新增批准的路由已停止宣告，未保存；请读取最新状态后核对草稿",
  ROUTES_INVALID: "路由变更或版本无效，请重新读取设备配置并检查网段",
  ROUTE_VIEW_TOO_LARGE: "路由配置超过管理视图上限，未截断；请联系管理员分批整理已有路由",
  ROUTE_DEVICE_NOT_FOUND: "设备已删除或不属于当前网络，请返回设备列表核对",
  PLAN_FEATURE_DISABLED: "当前套餐不包含该功能，升级套餐后可用",
  CONFIG_CHANGED: "配置已被其他管理员修改，请刷新后重新预览；当前草稿未丢弃",
  RELAY_CONFIG_CHANGED: "中继配置已被其他管理员修改，当前草稿保留，请对照最新配置后继续",
  RELAY_VERSION_REQUIRED: "缺少中继配置版本，请刷新页面后操作",
  RELAY_CONFIG_INVALID: "中继配置无效，请检查状态、地区名称和整数带宽",
  RELAY_REVOKED: "已撤销的中继身份不能恢复启用，请重新接入一台中继",
  CONFIG_NOT_FOUND: "此配置版本不存在，请刷新历史列表",
  CONFIG_INVALID: "DNS 配置无效，请检查解析器地址和域名",
  POLICY_INVALID: "策略校验未通过，原有权限不受影响",
  POLICY_TEST_FAILED: "策略自检未通过或暂时无法执行，尚未发布",
  POLICY_PROBE_INVALID: "请选择本网络内未过期的设备和有效服务端口",
  NETWORK_CONFIG_UNAVAILABLE: "网络配置暂时不可用，未将故障误报为默认配置",
  NETWORK_WRITE_FORBIDDEN: "当前登录或网络管理权限已变化，请重新登录确认",
  DNS_RECORD_INVALID: "名称需在本网络域名下，A 对应 IPv4，AAAA 对应 IPv6",
  DNS_RECORD_PROTECTED: "设备自动生成或证书工作流的记录不可在此修改",
  DNS_RECORD_LIMIT_REACHED: "DNS 记录已达到上限，请清理不再使用的自定义记录",
  SETUP_REQUIRED: "服务尚未完成初始化，请由部署管理员打开初始化页面完成设置",
  SETUP_COMPLETE: "管理员已完成初始化，请使用现有账户登录",
  AUTH_EXPIRED: "授权链接已失效，请在客户端重新发起登录或连接",
  AUTH_NOT_FOUND: "此授权不存在、已清理或不属于当前账户的网络，请使用正确账户重新发起",
  AUTH_ALREADY_USED: "此授权已处理，请刷新查看已记录的结果",
  AUTH_RATE_LIMITED: "操作过于频繁，请稍后再试",
  APPROVAL_FORBIDDEN: "只读账户不能批准设备或 SSH 连接，请联系网络管理员",
  DEVICE_SCOPE_CHANGED: "此设备登录的归属已经确定，请在客户端重新发起登录",
  LOGIN_REJECTED: "登录名或密码不正确，请检查后重试",
  TENANT_SIGNUP_REQUIRED: "请通过自助注册页面创建自己的网络空间",
  CURRENT_PASSWORD_INVALID: "当前密码不正确，请重新输入",
  PASSWORD_INVALID: "新密码需至少 12 个字符、最多 72 字节，且不能与登录名相同",
  PASSWORD_UNCHANGED: "新密码不能与当前密码相同",
  PASSWORD_UNAVAILABLE: "此账号未启用本地密码，请通过原登录方式管理安全设置",
  PASSWORD_RATE_LIMITED: "修改密码尝试过多，请稍后再试",
  PASSWORD_CHANGE_FAILED: "密码未能修改，请稍后再试",
  ACCOUNT_CHANGED: "账户或会话已变更，请重新登录",
  ACCOUNT_UPDATE_FAILED: "资料保存失败，请稍后再试",
  SESSION_CHANGED: "当前登录已失效，请重新登录",
  SESSION_NOT_FOUND: "该登录记录不存在或不属于当前账户，请刷新列表",
  SESSION_LIST_FAILED: "登录列表读取失败，请稍后重试",
  LOGIN_HISTORY_FAILED: "登录记录读取失败，请稍后重试；这不代表没有登录记录",
  INVALID_LOGIN_HISTORY_PAGE: "登录记录分页已失效或参数不正确，请刷新最新记录",
  SESSION_REVOKE_FAILED: "退出操作未能完成，请稍后重试",
  INVALID_SESSION_REVOCATION: "退出范围不正确，请刷新页面重试",
  INVALID_ACCOUNT: "资料格式不正确，请检查昵称和联系邮箱",
  CSRF_INVALID: "页面已失效，请刷新后重试",
  HUMAN_SESSION_REQUIRED: "请使用个人账号登录后操作",
  PASSKEY_UNAVAILABLE: "当前站点尚未启用通行密钥",
  PASSKEY_START_FAILED: "未能开始通行密钥操作，请稍后重试",
  PASSKEY_RATE_LIMITED: "通行密钥登录尝试过多，请稍后再试",
  PASSKEY_LOGIN_FAILED: "通行密钥登录失败，请重新发起并完成验证",
  PASSKEY_LIST_FAILED: "通行密钥列表读取失败，请稍后重试",
  PASSKEY_INVALID: "通行密钥名称最多 64 个字符，且不能含控制字符",
  PASSKEY_REGISTRATION_FAILED: "通行密钥验证失败，请重新开始添加",
  PASSKEY_SAVE_FAILED: "通行密钥未能保存，请重新开始添加",
  PASSKEY_DELETE_FAILED: "通行密钥删除失败，请稍后重试",
  PASSKEY_NOT_FOUND: "该通行密钥不存在或不属于当前账户，请刷新列表",
};

function humanizeCode(code: string): string {
  return codeMessages[code] ?? code;
}
