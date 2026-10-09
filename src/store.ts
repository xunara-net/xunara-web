// Console state: the signed-in session, the tenant plan and a small toast
// queue. It is a module-level reactive object rather than a store library —
// the console has one session and one user, and a shared object is the whole
// state management it needs.

import { reactive, readonly } from "vue";
import * as endpoints from "./api/endpoints";
import type { Plan, SessionInfo, Snapshot, User } from "./api/types";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

const state = reactive({
  booted: false,
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
    } catch {
      apply({ authenticated: false });
    } finally {
      state.booted = true;
    }
  },

  async login(login: string, password: string): Promise<void> {
    apply(await endpoints.login(login, password));
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
      await endpoints.logout();
    } finally {
      apply({ authenticated: false });
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
  state.authenticated = snapshot.authenticated;
  state.setupRequired = snapshot.setupRequired ?? false;
  state.localLogin = snapshot.localLogin ?? true;
  state.user = snapshot.user ?? null;
  state.session = snapshot.session ?? null;
  state.plan = snapshot.plan ?? null;
  state.tenant = snapshot.tenant ?? null;
  state.capabilities = snapshot.capabilities ?? [];
}
