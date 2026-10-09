// 这里只保存 UI 快照，不存会话 Secret；实际身份、过期和撤销都以服务端数据库为准。
// 顶部菜单、个人设置和安全中心共享此状态，不能各自维护一套“已退出”的假状态。

import { reactive, readonly } from "vue";
import * as endpoints from "./api/endpoints";
import { ApiError, errorMessage } from "./api/client";
import type { AccountInfo, PasskeyCredentialJSON, Plan, ProfileUpdate, SessionInfo, Snapshot, User } from "./api/types";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

const state = reactive({
  booted: false,
  bootError: "",
  authenticated: false,
  setupRequired: false,
  localLogin: true,
  user: null as User | null,
  session: null as SessionInfo | null,
  plan: null as Plan | null,
  tenant: null as Snapshot["tenant"] | null,
  capabilities: [] as string[],
  toasts: [] as Toast[],
});

let toastSeq = 0;

export const session = {
  state: readonly(state),

  async load(): Promise<void> {
    try {
      const snapshot = await endpoints.getSession();
      apply(snapshot);
    } catch (err) {
      // 身份暂时无法确认不等于匿名；保留快照，但由全局故障页阻止账户功能挂载。
      state.bootError = errorMessage(err);
    } finally {
      state.booted = true;
    }
  },

  async login(login: string, password: string): Promise<void> {
    apply(await endpoints.login(login, password));
  },

  async loginWithPasskey(credential: PasskeyCredentialJSON): Promise<void> {
    apply(await endpoints.finishPasskeyLogin(credential));
  },

  async updateProfile(body: ProfileUpdate, csrfToken: string): Promise<AccountInfo> {
    const account = await endpoints.updateAccount(body, csrfToken);
    if (!state.authenticated || state.user?.id !== account.user.id) {
      throw new Error("当前会话已变更，请刷新页面后重试");
    }
    state.user = account.user;
    return account;
  },

  forget(): void {
    apply({ authenticated: false });
  },

  async signup(body: {
    invite: string;
    login: string;
    display_name: string;
    email: string;
    password: string;
  }): Promise<void> {
    apply(await endpoints.signup(body));
  },

  async logout(): Promise<void> {
    try {
      const initiatingId = state.session?.id;
      const account = await endpoints.getAccountSessions();
      if (!initiatingId || initiatingId !== account.currentSessionId) {
        throw new Error("当前会话已变更，请刷新页面后重试");
      }
      // 与安全中心共用事务型撤销。不能在 finally 中清空状态，掩盖持久撤销失败。
      const result = await endpoints.revokeAccountSession(initiatingId, account.csrfToken);
      if (!result.current_revoked) throw new Error("服务端尚未确认退出，请刷新页面后重试");
      apply({ authenticated: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        apply({ authenticated: false });
        return;
      }
      throw err;
    }
  },

  can(scope: string): boolean {
    return state.capabilities.includes(scope);
  },

  toast(kind: Toast["kind"], text: string): void {
    const id = ++toastSeq;
    state.toasts.push({ id, kind, text });
    window.setTimeout(() => {
      const index = state.toasts.findIndex((t) => t.id === id);
      if (index >= 0) state.toasts.splice(index, 1);
    }, 4200);
  },

  dismiss(id: number): void {
    const index = state.toasts.findIndex((t) => t.id === id);
    if (index >= 0) state.toasts.splice(index, 1);
  },
};

function apply(snapshot: Snapshot): void {
  state.bootError = "";
  state.authenticated = snapshot.authenticated;
  state.setupRequired = snapshot.setupRequired ?? false;
  state.localLogin = snapshot.localLogin ?? true;
  state.user = snapshot.user ?? null;
  state.session = snapshot.session ?? null;
  state.plan = snapshot.plan ?? null;
  state.tenant = snapshot.tenant ?? null;
  state.capabilities = snapshot.capabilities ?? [];
}
