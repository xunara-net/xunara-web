<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AuthFrame from "../components/AuthFrame.vue";
import { ApiError, errorMessage } from "../api/client";
import { decideBrowserAuthorization, getBrowserAuthorization, type AuthorizationKind, type BrowserAuthorization } from "../api/browser-authorization";
import { accountLoginPath } from "../utils/auth";
import { consolePath } from "../utils/console";

const route = useRoute();
const kind = computed<AuthorizationKind>(() => route.name === "ssh-authorization" ? "ssh" : "device");
const detail = ref<BrowserAuthorization | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const signIn = ref(false);
const needsRead = ref(false);
let request: AbortController | undefined;
const title = computed(() => kind.value === "device" ? "确认接入设备" : "确认 SSH 连接");
const loginURL = computed(() => accountLoginPath({ return_to: consolePath(route.fullPath) }));
const pending = computed(() => detail.value?.state === "pending");
const stateCopy = computed(() => {
  switch (detail.value?.state) {
    case "approved": return ["设备已获授权", "可以关闭此页面，返回客户端等待连接。设备是否在线请到设备列表查看。"];
    case "accepted": return ["已批准本次 SSH 检查", "请返回 SSH 客户端继续。批准检查不代表连接已建立。"];
    case "consumed": return ["此 SSH 检查已处理", "检查结果已由客户端领取，无需再次操作。"];
    case "denied": case "rejected": return ["已拒绝此次请求", "如需重新接入，请在客户端重新发起登录或连接。"];
    case "expired": return ["授权链接已过期", "请在客户端重新发起登录或 SSH 连接，获取新的授权链接。"];
    default: return ["", ""];
  }
});
function date(value: string) { return new Date(value).toLocaleString("zh-CN"); }

async function load() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  detail.value = null;
  error.value = "";
  signIn.value = false;
  try {
    const current = await getBrowserAuthorization(kind.value, String(route.params.authID), controller.signal);
    if (!controller.signal.aborted) { detail.value = current; needsRead.value = false; }
  } catch (failure) {
    if (controller.signal.aborted) return;
    signIn.value = failure instanceof ApiError && failure.status === 401;
    error.value = signIn.value ? "" : errorMessage(failure);
  } finally {
    if (!controller.signal.aborted) loading.value = false;
  }
}

async function decide(approve: boolean) {
  if (!detail.value || busy.value || needsRead.value || !pending.value || !detail.value.can_write) return;
  busy.value = true;
  error.value = "";
  try {
    await decideBrowserAuthorization(kind.value, detail.value.id, detail.value.csrf_token, approve);
    await load();
  } catch (failure) {
    needsRead.value = true;
    error.value = errorMessage(failure) + "。请先刷新确认实际结果，再决定是否重新操作。";
  } finally { busy.value = false; }
}

watch(() => [route.name, route.params.authID], load, { immediate: true });
onBeforeUnmount(() => request?.abort());
</script>

<template>
  <AuthFrame :title="title" :subtitle="kind === 'device' ? '仅批准你正在使用、并且确认归属的设备。登录账户不会自动批准设备。' : '核对来源、目标设备与系统账户后，再批准本次连接。'">
    <p v-if="loading" class="muted" role="status">正在读取授权状态…</p>
    <div v-else-if="signIn">
      <p class="muted">请先登录接入账户，再查看并确认此请求。其他账户的登录不会转移此设备。</p>
      <a class="btn primary auth-action" :href="loginURL">登录并继续</a>
    </div>
    <template v-else-if="detail">
      <div v-if="!pending" class="result-panel" role="status">
        <h2>{{ stateCopy[0] }}</h2><p>{{ stateCopy[1] }}</p>
      </div>
      <dl class="authorization-details">
        <template v-if="kind === 'device'">
          <dt>设备名称</dt><dd>{{ detail.hostname || "未命名设备" }}</dd>
          <dt>操作系统</dt><dd>{{ detail.os || "未知" }}</dd>
          <dt v-if="detail.ephemeral">设备类型</dt><dd v-if="detail.ephemeral">临时设备</dd>
          <dt v-if="detail.requested_tags?.length">申请标签</dt><dd v-if="detail.requested_tags?.length">{{ detail.requested_tags.join("、") }}</dd>
        </template>
        <template v-else>
          <dt>来源设备</dt><dd>{{ detail.source }}</dd>
          <dt>目标设备</dt><dd>{{ detail.destination }}</dd>
          <dt>系统账户</dt><dd>{{ detail.local_user }}</dd>
        </template>
        <dt>授权账户</dt><dd>{{ detail.login_name }}</dd>
        <dt>发起时间</dt><dd>{{ date(detail.created_at) }}</dd>
        <dt>链接有效期</dt><dd>{{ date(detail.expires_at) }}</dd>
      </dl>
      <p v-if="pending && !detail.can_write" class="alert" role="status">当前账户为只读角色，请联系本网络的管理员审批。</p>
      <div v-if="pending && detail.can_write" class="authorization-actions">
        <button class="btn primary" :disabled="busy || needsRead" @click="decide(true)">{{ busy ? "正在确认…" : kind === "device" ? "确认接入" : "批准此次连接" }}</button>
        <button class="btn" :disabled="busy || needsRead" @click="decide(false)">拒绝</button>
      </div>
    </template>
    <div v-if="error" class="alert danger" role="alert">{{ error }}</div>
    <div v-if="!loading" class="authorization-footer">
      <button v-if="!signIn" class="btn" :disabled="busy" @click="load">刷新状态</button>
      <router-link to="/devices">返回设备列表</router-link>
    </div>
  </AuthFrame>
</template>

<style scoped>
.authorization-details { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 14px 12px; margin: 24px 0; font-size: 14px; }
dt { color: var(--text-muted); } dd { margin: 0; overflow-wrap: anywhere; }
.authorization-actions { display: grid; gap: 10px; grid-template-columns: 1fr auto; margin-top: 24px; }
.authorization-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 24px; }
.auth-action { width: 100%; margin-top: 20px; }
.result-panel { padding: 16px; border-radius: 10px; background: var(--surface-2); }
.result-panel h2 { font-size: 18px; margin-top: 0; } .result-panel p { line-height: 1.7; margin-bottom: 0; }
.alert { margin-top: 16px; overflow-wrap: anywhere; }
@media (max-width: 360px) { .authorization-details { grid-template-columns: 80px minmax(0, 1fr); } }
</style>
