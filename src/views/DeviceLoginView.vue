<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AuthFrame from "../components/AuthFrame.vue";
import { errorMessage } from "../api/client";
import { getDeviceFlow, loginDeviceFlow } from "../api/browser-authorization";

const route = useRoute();
const hostname = ref("");
const csrf = ref("");
const login = ref("");
const password = ref("");
const loading = ref(true);
const busy = ref(false);
const error = ref("");
let operation: AbortController | undefined;

async function load() {
  operation?.abort();
  const controller = new AbortController();
  operation = controller;
  loading.value = true;
  error.value = "";
  csrf.value = "";
  try {
    const flow = await getDeviceFlow(String(route.params.flowID), controller.signal);
    if (controller.signal.aborted) return;
    if (flow.next_path) { window.location.replace(flow.next_path); return; }
    hostname.value = flow.hostname ?? "";
    csrf.value = flow.csrf_token ?? "";
  } catch (failure) {
    if (!controller.signal.aborted) error.value = errorMessage(failure);
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}

async function submit() {
  if (!csrf.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const next = await loginDeviceFlow(String(route.params.flowID), login.value.trim(), password.value, csrf.value);
    window.location.assign(next);
  } catch (failure) {
    error.value = errorMessage(failure);
    csrf.value = "";
  } finally { password.value = ""; busy.value = false; }
}

watch(() => route.params.flowID, load, { immediate: true });
onBeforeUnmount(() => operation?.abort());
</script>

<template>
  <AuthFrame title="登录并接入设备" subtitle="请登录设备所属账户。登录成功后还需明确确认接入，不会使用浏览器中其他账户自动审批。">
    <p v-if="loading" class="muted" role="status">正在检查设备登录请求…</p>
    <template v-else>
      <p v-if="hostname" class="device-name">接入设备 <strong>{{ hostname }}</strong></p>
      <form v-if="csrf" class="form-stack" @submit.prevent="submit">
        <label for="device-login">登录名</label>
        <input id="device-login" v-model="login" name="username" autocomplete="username" required maxlength="128" :disabled="busy" />
        <label for="device-password">密码</label>
        <input id="device-password" v-model="password" name="password" type="password" autocomplete="current-password" required :disabled="busy" />
        <button class="btn primary" :disabled="busy || !login.trim() || !password">{{ busy ? "正在验证…" : "登录并继续" }}</button>
      </form>
      <p v-if="error" class="alert danger" role="alert">{{ error }}</p>
      <button v-if="!csrf" class="btn" :disabled="busy" @click="load">重新读取登录状态</button>
      <p class="muted device-hint">不认识这台设备？直接关闭页面，不要输入密码。</p>
    </template>
  </AuthFrame>
</template>

<style scoped>
.device-name { padding: 14px; background: var(--surface-2); border-radius: 10px; overflow-wrap: anywhere; }
.form-stack { display: grid; gap: 10px; margin: 24px 0; } .form-stack button { margin-top: 12px; }
.device-hint { margin: 24px 0 0; font-size: 13px; line-height: 1.7; }
.alert { margin: 16px 0; }
</style>
