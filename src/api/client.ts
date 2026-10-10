// The one place the console talks to the control plane.
//
// Every request is same-origin and carries the session cookie; the server
// answers JSON and never redirects API calls. Errors become ApiError with the
// status and the server's message, so views can show something useful instead
// of "HTTP 403".

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
};

/** api performs one JSON request against the control plane. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const init: RequestInit = {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...options.headers },
  };
  const controller = new AbortController();
  init.signal = controller.signal;
  if (options.body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const timeout = setTimeout(() => controller.abort(), 30000);

  let resp: Response;
  let text: string;
  try {
    resp = await fetch(url, init);
    if (resp.status === 204) return undefined as T;
    text = await resp.text();
  } catch (err) {
    if (controller.signal.aborted) throw new ApiError(408, "REQUEST_TIMEOUT: request outcome is unknown; refresh before submitting again");
    throw err;
  } finally { clearTimeout(timeout); }
  let payload: any = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!resp.ok) {
    const message =
      payload?.message ?? payload?.error ?? (text ? text.slice(0, 200) : `HTTP ${resp.status}`);
    const code = typeof payload?.code === "string" ? payload.code : "";
    throw new ApiError(resp.status, message, code);
  }
  if (payload === undefined) throw new ApiError(502, "API_RESPONSE_INVALID: expected a JSON response");
  return payload as T;
}

/** errorMessage renders any thrown value for a person. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.errorCode;
    return code ? `${humanizeCode(code)}（${err.message}）` : err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

const codeMessages: Record<string, string> = {
  MEMBER_CHANGED: "成员信息已被其他管理员修改，请刷新列表后重新确认，不会自动覆盖",
  LAST_OWNER: "至少保留一名网络所有者，请先授予另一名成员所有者角色",
  MEMBER_WRITE_FORBIDDEN: "当前所有者或服务密钥权限已变化，请重新确认登录身份",
  MEMBER_INVALID: "成员角色或数据版本无效，请刷新并检查输入",
  MEMBER_NOT_FOUND: "成员已不存在，请刷新列表",
  MEMBERS_UNAVAILABLE: "暂时无法读取或修改成员，请稍后刷新检查操作结果",
  LOGIN_NAME_TAKEN: "此登录名已被使用，请选择其他名称",
  ADDRESS_CHANGED: "网段或设备 IP 已被其他管理员修改，请关闭并刷新后重新操作",
  ADDRESS_IN_USE: "该 IP 或网段已被占用，旧网段仍可能被其他设备使用",
  ADDRESS_INVALID: "地址无效，请检查当前网段、系统保留段与地址格式",
  DERP_MAP_INVALID: "中继地图格式无效，请检查地区编号、主机、端口和 TLS 校验",
  DERP_REGION_CONFLICT: "地区编号与默认或已接入中继冲突，请选择其它编号",
  DERP_IMPORT_FAILED: "暂时无法读取官方公共地图，原有中继配置未改变",
  REQUEST_TIMEOUT: "请求超时，尚未确认操作结果；请先刷新检查，勿连续重复提交",
  API_RESPONSE_INVALID: "服务响应格式异常，请刷新重试",
  AUTH_UNAVAILABLE: "登录服务暂时不可用，当前会话未被退出，请稍后重试",
  DEVICE_LIMIT_REACHED: "当前套餐的设备数已达上限，升级套餐后可继续添加设备",
  AUTH_KEY_LIMIT_REACHED: "预授权密钥数量已达上限，请删除不再使用的密钥或升级套餐",
  USER_LIMIT_REACHED: "成员数量已达上限，请升级套餐",
  OWNER_REQUIRED: "只有网络所有者可以管理成员邀请",
  INVITATIONS_DISABLED: "当前租户未开启邀请码注册，请联系平台管理员",
  INVITATIONS_UNAVAILABLE: "暂时无法读取或管理邀请，请稍后重试",
  INVITATION_NOT_FOUND: "邀请不存在，可能已被撤销，请刷新列表",
  INVITATION_USED: "此邀请已使用，记录不能撤销",
  INVALID_INVITATION: "请选择成员或管理员角色，并填写有效期和不超过 200 字的备注",
  REGISTRATION_UNAVAILABLE: "注册服务暂时不可用，请稍后重试",
  ROUTE_LIMIT_REACHED: "路由数量已达上限，请撤销不用的路由或升级套餐",
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
  SETUP_REQUIRED: "服务尚未完成初始化，请先在服务端完成初始化",
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
