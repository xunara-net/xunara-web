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
    headers: { Accept: "application/json" },
  };
  if (options.body !== undefined) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }

  const resp = await fetch(url, init);
  if (resp.status === 204) return undefined as T;

  const text = await resp.text();
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
  DEVICE_LIMIT_REACHED: "当前套餐的设备数已达上限，升级套餐后可继续添加设备",
  AUTH_KEY_LIMIT_REACHED: "预授权密钥数量已达上限，请删除不再使用的密钥或升级套餐",
  USER_LIMIT_REACHED: "成员数量已达上限，请升级套餐",
  ROUTE_LIMIT_REACHED: "路由数量已达上限，请撤销不用的路由或升级套餐",
  PLAN_FEATURE_DISABLED: "当前套餐不包含该功能，升级套餐后可用",
  SETUP_REQUIRED: "服务尚未完成初始化，请先在服务端完成初始化",
  TENANT_SIGNUP_REQUIRED: "请通过自助注册页面创建自己的网络空间",
};

function humanizeCode(code: string): string {
  return codeMessages[code] ?? code;
}
