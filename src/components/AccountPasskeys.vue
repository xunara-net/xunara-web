<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import { ApiError, errorMessage } from "../api/client";
import type { AccountPasskey, AccountPasskeys } from "../api/types";
import { session } from "../store";
import { createPasskey, passkeyAvailability, passkeyErrorMessage } from "../utils/passkey";
import { formatTime } from "../utils/format";
import DataTable from "./DataTable.vue";

const router = useRouter();
const account = ref<AccountPasskeys | null>(null);
const loading = ref(true);
const busy = ref("");
const error = ref("");
const success = ref("");
const name = ref("");
const availability = passkeyAvailability();
const canAdd = computed(() => !!account.value?.enabled && availability.supported && !loading.value && !busy.value);
let operation: AbortController | null = null;

onMounted(load);
// 离开页面时取消认证器交互，不能在用户已经退出后继续完成旧页面的注册动作。
onUnmounted(() => operation?.abort());

async function expiredSession(err: unknown) {
  if (err instanceof ApiError && err.status === 401) {
    session.forget();
    await router.replace({ name: "login", query: { return_to: "/security" } });
  }
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    account.value = await ep.getAccountPasskeys();
  } catch (err) {
    account.value = null;
    error.value = errorMessage(err);
    await expiredSession(err);
  } finally {
    loading.value = false;
  }
}

async function add() {
  if (!canAdd.value || !account.value) return;
  const controller = new AbortController();
  operation = controller;
  busy.value = "register";
  error.value = "";
  success.value = "";
  try {
    const begin = await ep.beginAccountPasskey(account.value.csrf_token);
    controller.signal.throwIfAborted();
    const credential = await createPasskey(begin.options.publicKey, controller.signal);
    controller.signal.throwIfAborted();
    busy.value = "saving";
    await ep.finishAccountPasskey(name.value.trim(), credential, account.value.csrf_token);
    name.value = "";
    success.value = "通行密钥已添加，下次可使用设备锁屏验证登录。";
    await load();
  } catch (err) {
    error.value = passkeyErrorMessage(err);
    await expiredSession(err);
  } finally {
    operation = null;
    busy.value = "";
  }
}

async function remove(passkey: AccountPasskey) {
  if (!account.value || loading.value || busy.value) return;
  if (!window.confirm(`删除“${passkey.name}”后，将无法使用它进行新的登录。请确保仍有密码、其他通行密钥或第三方登录可用。已有登录不会自动退出。继续？`)) return;
  busy.value = passkey.id;
  error.value = "";
  success.value = "";
  try {
    await ep.deleteAccountPasskey(passkey.id, account.value.csrf_token);
    success.value = "通行密钥已删除。若怀疑泄露，请同时退出相关活动登录。";
    await load();
  } catch (err) {
    error.value = errorMessage(err);
    await expiredSession(err);
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <section id="passkeys" class="card">
    <div class="card-head"><h2>通行密钥 <span v-if="account" class="badge primary">{{ account.passkeys.length }}</span></h2><button class="btn small" :disabled="loading || !!busy" @click="load">刷新</button></div>
    <div class="card-body passkey-intro">
      <p>使用指纹、面容、设备 PIN 或安全密钥登录，无须输入账户密码。私钥留在你的认证器中，服务端不会保存私钥。</p>
      <div v-if="account && !account.enabled" class="alert info">管理员尚未启用通行密钥。正式使用需要 HTTPS、固定域名及对应租户的 WebAuthn 配置，现有密码或第三方登录不受影响。</div>
      <div v-else-if="account && !availability.supported" class="alert info">{{ availability.reason }}</div>
      <form v-if="account?.enabled" class="passkey-form" @submit.prevent="add">
        <div class="field"><label for="passkey-name">密钥名称</label><input id="passkey-name" v-model="name" class="input" maxlength="64" :disabled="!canAdd" placeholder="例如：我的笔记本（可选）" /></div>
        <button class="btn primary" :disabled="!canAdd">{{ busy === 'register' ? '等待设备验证…' : busy === 'saving' ? '正在保存…' : '添加通行密钥' }}</button>
        <button v-if="busy === 'register'" class="btn" type="button" @click="operation?.abort()">取消</button>
      </form>
      <div v-if="success" class="alert success" role="status">{{ success }}</div>
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
    </div>
    <DataTable v-if="account || !error" :columns="[
      { key: 'name', title: '密钥名称' }, { key: 'created_at', title: '添加时间' },
      { key: 'last_used_at', title: '最近使用' }, { key: 'actions', title: '操作', align: 'right' },
    ]" :rows="account?.passkeys ?? []" :loading="loading" row-key="id" empty-title="尚未添加通行密钥" empty-desc="启用后，可在此添加用于登录的设备凭据。">
      <template #cell-created_at="{ row }">{{ formatTime(row.created_at) }}</template>
      <template #cell-last_used_at="{ row }">{{ row.last_used_at ? formatTime(row.last_used_at) : '尚未用于登录' }}</template>
      <template #cell-actions="{ row }"><button class="btn small danger" :disabled="loading || !!busy" @click="remove(row)">{{ busy === row.id ? '正在删除…' : '删除' }}</button></template>
    </DataTable>
    <div class="card-body passkey-note">通行密钥只用于本账户登录，不代替设备接入审批。请保留至少一种备用登录方式；删除密钥不等于退出已经建立的登录。</div>
  </section>
</template>

<style scoped>
.passkey-intro > p { margin: 0 0 14px; color: var(--text-muted); line-height: 1.8; }
.passkey-form { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.passkey-form .field { flex: 1 1 220px; margin-bottom: 0; }
.passkey-intro .alert + .alert { margin-top: 12px; }
.passkey-note { color: var(--text-muted); font-size: 12.5px; line-height: 1.8; }
@media (max-width: 520px) { .passkey-form .field { flex-basis: 100%; } }
</style>
