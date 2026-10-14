<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import { ApiError, errorMessage } from "../api/client";
import type { AccountInfo } from "../api/types";
import { session } from "../store";
import { passwordChangeError } from "../utils/account";

const router = useRouter();
const route = useRoute();
const account = ref<AccountInfo | null>(null);
const loading = ref(true);
const loadError = ref("");
const current = ref("");
const password = ref("");
const confirmation = ref("");
const busy = ref(false);
const error = ref("");
const uncertain = ref(false);
let disposed = false;

function clearSecrets() { current.value = ""; password.value = ""; confirmation.value = ""; }
onUnmounted(() => { disposed = true; clearSecrets(); });
onMounted(() => {
  if (Object.keys(route.query).length || route.hash) void router.replace({ name: "change-password" });
  void load();
});

async function load() {
  loading.value = true; loadError.value = "";
  try {
    const payload = await ep.getAccount();
    if (disposed) return;
    if (!payload.passwordChangeEnabled || !payload.csrfToken || payload.user.id !== session.state.user?.id) throw new Error("无法确认本账号的改密权限，请重新登录或联系管理员");
    account.value = payload;
  } catch (err) {
    if (!disposed) { loadError.value = errorMessage(err); await handleExpired(err); }
  } finally { if (!disposed) loading.value = false; }
}

async function handleExpired(err: unknown) {
  if (err instanceof ApiError && (err.status === 401 || err.errorCode === "ACCOUNT_CHANGED")) {
    clearSecrets(); session.forget();
    await router.replace({ name: "login" });
  }
}

async function submit() {
  if (busy.value || loading.value || loadError.value || uncertain.value || !account.value) return;
  error.value = passwordChangeError(account.value.user.loginName, current.value, password.value, confirmation.value);
  if (error.value) return;
  busy.value = true;
  try {
    await ep.changePassword({ current_password: current.value, new_password: password.value }, account.value.csrfToken);
    if (disposed) return;
    clearSecrets(); session.forget();
    await router.replace({ name: "login", query: { password_changed: "1" } });
  } catch (err) {
    if (disposed) return;
    error.value = errorMessage(err);
    uncertain.value = !(err instanceof ApiError) || err.status >= 500 || err.status === 408;
    current.value = "";
    if (uncertain.value) clearSecrets();
    await handleExpired(err);
  } finally { if (!disposed) busy.value = false; }
}

async function logout() {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try {
    await session.logout();
    if (!disposed) { clearSecrets(); await router.replace({ name: "login" }); }
  } catch (err) { if (!disposed) error.value = errorMessage(err); }
  finally { if (!disposed) busy.value = false; }
}
</script>

<template>
  <div class="auth-wrap">
    <section class="card auth-card">
      <h1 class="auth-title">设置自己的新密码</h1>
      <p class="auth-sub">{{ session.state.user?.loginName }} · {{ session.state.tenant?.organizationName || session.state.tenant?.id }}</p>
      <div class="alert info password-feedback">管理员重置的临时密码不能长期使用。请先改密，完成后使用新密码重新登录。</div>
      <div v-if="loading" class="help password-feedback" role="status">正在确认改密权限…</div>
      <div v-else-if="loadError" class="alert error password-feedback" role="alert">{{ loadError }} <button class="btn small" @click="load">重新加载</button></div>
      <form v-else-if="account" class="password-form" @submit.prevent="submit">
        <div class="field"><label for="temporary-password">临时密码 / 当前密码</label><input id="temporary-password" v-model="current" type="password" class="input" autocomplete="current-password" :disabled="busy || uncertain" required /></div>
        <div class="field"><label for="new-password">新密码</label><input id="new-password" v-model="password" type="password" class="input" autocomplete="new-password" :disabled="busy || uncertain" required /><p class="help">至少 12 个字符，最多 72 字节，不能与登录名或临时密码相同。</p></div>
        <div class="field"><label for="confirm-password">确认新密码</label><input id="confirm-password" v-model="confirmation" type="password" class="input" autocomplete="new-password" :disabled="busy || uncertain" required /></div>
        <div v-if="error" class="alert error password-feedback" role="alert">{{ error }}</div>
        <div v-if="uncertain" class="alert password-feedback">无法确认提交结果，不会自动重试。请退出后先尝试新密码登录；若仍提示改密，再用临时密码核对。</div>
        <button class="btn primary password-action" :disabled="busy || uncertain">{{ busy ? '正在提交…' : '保存新密码并重新登录' }}</button>
      </form>
      <div class="auth-footer"><button class="btn small" :disabled="busy" @click="logout">退出登录</button></div>
    </section>
  </div>
</template>

<style scoped>
.password-feedback { margin-top: 18px; overflow-wrap: anywhere; }
.password-form { margin-top: 22px; }
.password-action { width: 100%; margin-top: 16px; }
</style>
