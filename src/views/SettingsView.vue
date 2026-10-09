<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import { ApiError, errorMessage } from "../api/client";
import type { AccountInfo } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import { roleLabel } from "../utils/format";
import { passwordChangeError } from "../utils/account";

const router = useRouter();
const user = computed(() => session.state.user);
const account = ref<AccountInfo | null>(null);
const loading = ref(true);
const loadError = ref("");
const displayName = ref("");
const email = ref("");
const profileBusy = ref(false);
const profileError = ref("");
const currentPassword = ref("");
const newPassword = ref("");
const confirmation = ref("");
const passwordBusy = ref(false);
const passwordError = ref("");
const dirty = computed(() => account.value !== null && (
  displayName.value.trim() !== account.value.user.displayName || email.value.trim() !== account.value.user.email
));

const capabilityLabels: Record<string, string> = {
  "auth.password": "密码登录",
  "auth.passkey": "Passkey 登录",
  "auth.oidc": "第三方登录（OIDC）",
  "auth.register.invite": "邀请制注册",
  "auth.register.open": "开放注册",
  "identity.id_token": "身份令牌（ID Token）",
  sharing: "跨组织共享",
  webhooks: "Webhook",
  derp: "DERP 中继",
  "dns.managed": "托管 DNS",
  reach: "远程命令（Reach）",
  flux: "文件传输（Flux）",
  "services.agent": "服务发现 Agent",
  "network.custom_cidr": "自定义网段",
  "route.exit_node": "出口节点",
  "route.subnet_router": "子网路由",
  "api.keys": "API 密钥",
  audit: "审计日志",
  "team.members": "多成员",
};

onMounted(load);
onBeforeUnmount(clearPasswords);

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    account.value = await ep.getAccount();
    displayName.value = account.value.user.displayName;
    email.value = account.value.user.email;
  } catch (err) {
    loadError.value = errorMessage(err);
    await handleExpiredSession(err);
  } finally {
    loading.value = false;
  }
}

async function handleExpiredSession(err: unknown) {
  if (err instanceof ApiError && (err.status === 401 || err.errorCode === "ACCOUNT_CHANGED")) {
    session.forget();
    await router.replace({ name: "login", query: { return_to: "/settings" } });
  }
}

async function saveProfile() {
  if (!account.value || profileBusy.value || passwordBusy.value || !dirty.value) return;
  profileBusy.value = true;
  profileError.value = "";
  try {
    account.value = await session.updateProfile({
      display_name: displayName.value.trim(), email: email.value.trim(),
    }, account.value.csrfToken);
    displayName.value = account.value.user.displayName;
    email.value = account.value.user.email;
    session.toast("success", "个人资料已保存");
  } catch (err) {
    profileError.value = errorMessage(err);
    await handleExpiredSession(err);
  } finally {
    profileBusy.value = false;
  }
}

function clearPasswords() {
  currentPassword.value = "";
  newPassword.value = "";
  confirmation.value = "";
}

async function savePassword() {
  if (!account.value?.passwordChangeEnabled || passwordBusy.value || profileBusy.value) return;
  passwordError.value = passwordChangeError(user.value?.loginName ?? "", currentPassword.value, newPassword.value, confirmation.value);
  if (passwordError.value) return;
  if (!window.confirm("修改密码后，所有设备上的控制台登录都会退出，需要重新登录。已连接的网络设备和 API 密钥不受影响。继续？")) return;
  passwordBusy.value = true;
  try {
    await ep.changePassword({ current_password: currentPassword.value, new_password: newPassword.value }, account.value.csrfToken);
    clearPasswords();
    session.forget();
    await router.replace({ name: "login", query: { password_changed: "1" } });
  } catch (err) {
    passwordError.value = errorMessage(err);
    currentPassword.value = "";
    await handleExpiredSession(err);
  } finally {
    passwordBusy.value = false;
  }
}
</script>

<template>
  <PageHeader title="个人设置" desc="管理自己的资料与密码，不会改变网络身份或套餐权限。" />

  <div v-if="loading" class="empty" role="status">正在读取账户设置…</div>
  <div v-else-if="loadError" class="alert error" role="alert">
    {{ loadError }} <button class="btn small" @click="load">重试</button>
  </div>

  <div v-else-if="account" class="grid cols-2">
    <div class="card">
      <div class="card-head"><h2>个人资料</h2></div>
      <form class="card-body" @submit.prevent="saveProfile">
        <div class="kv" style="margin-bottom: 20px">
          <div class="k">登录名</div><div class="v mono">{{ user?.loginName }}</div>
          <div class="k">角色</div><div class="v">{{ roleLabel(user?.role || "member") }}</div>
          <div class="k">组织</div><div class="v">{{ session.state.tenant?.organizationName || session.state.tenant?.id || "default" }}</div>
        </div>
        <div class="field">
          <label for="account-display-name">昵称</label>
          <input id="account-display-name" v-model="displayName" class="input" maxlength="100" autocomplete="nickname" :disabled="profileBusy || passwordBusy" />
          <div class="help">最多 100 个字符；留空时显示登录名。</div>
        </div>
        <div class="field">
          <label for="account-email">联系邮箱</label>
          <input id="account-email" v-model="email" class="input" type="email" maxlength="254" autocomplete="email" :disabled="profileBusy || passwordBusy" />
          <div class="help">选填，可清空。此邮箱尚未验证，不用于登录、身份合并或找回密码。</div>
        </div>
        <div v-if="profileError" class="alert error" role="alert" style="margin-bottom: 14px">{{ profileError }}</div>
        <button class="btn primary" type="submit" :disabled="profileBusy || passwordBusy || !dirty">{{ profileBusy ? "正在保存…" : "保存资料" }}</button>
      </form>
    </div>

    <div id="password" class="card">
      <div class="card-head"><h2>修改密码</h2><RouterLink to="/security">查看登录会话</RouterLink></div>
      <form v-if="account.passwordChangeEnabled" class="card-body" @submit.prevent="savePassword">
        <input class="account-login" :value="user?.loginName" autocomplete="username" readonly tabindex="-1" aria-hidden="true" />
        <div class="field">
          <label for="current-password">当前密码</label>
          <input id="current-password" v-model="currentPassword" class="input" type="password" autocomplete="current-password" required :disabled="passwordBusy || profileBusy" />
        </div>
        <div class="field">
          <label for="new-password">新密码</label>
          <input id="new-password" v-model="newPassword" class="input" type="password" autocomplete="new-password" required :disabled="passwordBusy || profileBusy" />
          <div class="help">至少 12 个字符，最多 72 字节。建议使用较长且独一无二的密码。</div>
        </div>
        <div class="field">
          <label for="confirm-password">确认新密码</label>
          <input id="confirm-password" v-model="confirmation" class="input" type="password" autocomplete="new-password" required :disabled="passwordBusy || profileBusy" />
        </div>
        <div class="alert warning" style="margin-bottom: 14px">保存后所有控制台登录立即失效，请使用新密码重新登录；已连接的网络设备不受影响。</div>
        <div v-if="passwordError" class="alert error" role="alert" style="margin-bottom: 14px">{{ passwordError }}</div>
        <button class="btn primary" type="submit" :disabled="passwordBusy || profileBusy || !currentPassword || !newPassword || !confirmation">{{ passwordBusy ? "正在修改…" : "修改并重新登录" }}</button>
      </form>
      <div v-else class="card-body">
        <div class="alert info">此账号未启用本地密码，请通过原登录方式管理凭据。这里不会为第三方账号创建密码。</div>
        <RouterLink class="btn" style="margin-top: 14px" to="/security">管理登录会话</RouterLink>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>本部署支持的能力</h2></div>
    <div class="card-body" style="display: flex; flex-wrap: wrap; gap: 8px">
      <span v-for="cap in session.state.capabilities" :key="cap" class="badge primary">{{ capabilityLabels[cap] ?? cap }}</span>
    </div>
  </div>
</template>

<style scoped>
.account-login { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; }
</style>
