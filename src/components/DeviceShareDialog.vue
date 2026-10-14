<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { createDeviceShare, getDeviceShares, shareRecipientLogin, type DeviceShares } from "../api/device-shares";
import { errorMessage } from "../api/client";
import { session } from "../store";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ open: boolean; reference: string; hostname: string }>();
const emit = defineEmits<{ close: []; created: [] }>();
const login = ref(""), error = ref(""), loading = ref(false), saving = ref(false), blocked = ref(false);
const snapshot = ref<DeviceShares | null>(null);
let sequence = 0, active = true;
onBeforeUnmount(() => { active = false; sequence++; });
watch(() => [props.open, props.reference], () => {
  sequence++; snapshot.value = null; login.value = ""; error.value = ""; blocked.value = false;
  if (props.open) load();
}, { immediate: true });
const canSend = computed(() => {
  if (loading.value || saving.value || blocked.value || !snapshot.value?.can_manage) return false;
  try { shareRecipientLogin(login.value); return true; } catch { return false; }
});
async function load() {
  if (saving.value) return;
  const request = ++sequence;
  loading.value = true; error.value = ""; snapshot.value = null;
  try {
    const result = await getDeviceShares();
    if (active && request === sequence && props.open) { snapshot.value = result; blocked.value = false; }
  } catch (failure) { if (active && request === sequence) error.value = errorMessage(failure); }
  finally { if (active && request === sequence) loading.value = false; }
}
async function send() {
  if (!canSend.value || !snapshot.value) return;
  saving.value = true; error.value = "";
  try {
    await createDeviceShare(props.reference, login.value, snapshot.value.csrf_token);
    if (active) { session.toast("success", "分享邀请已发送，对方接受后即可访问这台设备"); emit("created"); emit("close"); }
  } catch (failure) {
    // 请求可能已提交，任何失败都先读取真实列表，绝不自动重发邀请。
    if (active) { blocked.value = true; error.value = errorMessage(failure); }
  } finally { if (active) saving.value = false; }
}
</script>

<template>
  <ModalDialog :open="open" title="分享设备" :busy="saving" @close="emit('close')">
    <form class="stack" @submit.prevent="send">
      <p>把 <strong>{{ hostname || reference }}</strong> 分享给另一位用户。</p>
      <p v-if="loading" role="status">正在确认分享权限…</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}<p class="small-text">请先到分享列表检查实际结果，再刷新此窗口。</p><button class="btn small" type="button" :disabled="saving || loading" @click="load">刷新分享权限</button></div>
      <div v-if="snapshot && !snapshot.enabled" class="alert warning">此部署未启用跨网络设备分享，请联系平台管理员。</div>
      <div v-else-if="snapshot?.tailnet_locked" class="alert warning">当前网络启用了 Tailnet Lock，暂不支持跨网络设备分享。</div>
      <div v-else-if="snapshot && !snapshot.can_manage" class="alert warning">只有网络所有者和管理员可以分享设备。</div>
      <label class="field"><span class="label">对方用户名</span><input v-model="login" class="input" name="recipient_login" aria-label="对方用户名" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="128" placeholder="输入对方在玄序的用户名" :disabled="saving || loading || !snapshot?.can_manage" required /><span class="hint">对方须已注册，并拥有自己的网络。无需填写网络标识、邀请码或令牌。</span></label>
      <p class="muted small-text">仅分享这一台设备，不开放其他设备、局域网路由、出口或管理权限。对方需要在「设备分享 → 分享给我」确认接受；访问仍受双方 ACL 约束，你可随时撤销。</p>
      <div class="row-actions"><button class="btn primary" type="submit" :disabled="!canSend">{{ saving ? '正在发送…' : '发送分享邀请' }}</button><router-link v-if="!saving" class="btn" :to="{ path: '/shares', query: { direction: 'outgoing' } }" @click="emit('close')">查看分享列表</router-link></div>
    </form>
  </ModalDialog>
</template>
