<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getDeviceLifecycle, expireDevice, type DeviceLifecycle } from "../api/device-enrollment";
import { errorMessage } from "../api/client";
import { canManageNetwork } from "../utils/devices";
import { formatTime } from "../utils/format";
import { session } from "../store";
import type { Machine } from "../api/types";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ open: boolean; reference: string }>();
const emit = defineEmits<{ close: []; expired: [machine: Machine] }>();
const current = ref<DeviceLifecycle | null>(null), error = ref(""), loading = ref(false), saving = ref(false);
const confirmed = ref(false), blocked = ref(false);
let sequence = 0, active = true;
onBeforeUnmount(() => { active = false; sequence++; });
watch(() => [props.open, props.reference], () => {
  sequence++; current.value = null; error.value = ""; confirmed.value = false; blocked.value = false;
  loading.value = false; saving.value = false;
  if (props.open) load();
}, { immediate: true });
const canExpire = computed(() => Boolean(current.value?.can_expire && current.value.csrf_token &&
  !current.value.machine.expired && canManageNetwork(session.state.user?.role)));
async function load() {
  if (saving.value) return;
  const request = ++sequence, reference = props.reference;
  loading.value = true; error.value = ""; current.value = null; confirmed.value = false; blocked.value = true;
  try {
    const result = await getDeviceLifecycle(reference);
    if (active && request === sequence && props.open && reference === props.reference) { current.value = result; blocked.value = false; }
  } catch (failure) { if (active && request === sequence) error.value = errorMessage(failure); }
  finally { if (active && request === sequence) loading.value = false; }
}
async function expire() {
  if (!current.value || !canExpire.value || !confirmed.value || blocked.value || saving.value || loading.value) return;
  const request = sequence, reference = props.reference, observed = current.value;
  saving.value = true; error.value = "";
  try {
    const result = await expireDevice(reference, observed.revision, observed.csrf_token);
    if (active && request === sequence && props.open && reference === props.reference) {
      emit("expired", result.machine); emit("close"); session.toast("success", "设备密钥已过期，需要重新认证后恢复连接");
    }
  } catch (failure) {
    if (active && request === sequence) { error.value = errorMessage(failure); confirmed.value = false; blocked.value = true; }
  } finally { if (active && request === sequence) saving.value = false; }
}
</script>

<template>
  <ModalDialog :open="open" title="立即使设备过期" :busy="loading || saving" @close="emit('close')">
    <div class="stack">
      <p v-if="loading" role="status">正在读取设备身份和密钥有效期…</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}<p>不自动重试，请读取最新状态后重新确认。</p><button class="btn small" :disabled="saving || loading" @click="load">读取最新设备状态</button></div>
      <template v-if="current">
        <div class="kv"><div class="k">设备</div><div class="v">{{ current.machine.hostname || `设备 #${current.machine.id}` }}</div><div class="k">IP</div><div class="v mono">{{ current.machine.ipv4 || '未分配' }}</div><div class="k">当前有效期</div><div class="v">{{ current.machine.expires ? formatTime(current.machine.expires) : '未设置到期时间' }}</div></div>
        <div class="alert warning">会使这台设备当前的节点密钥立即失效，连接可能中断。若正通过它的 VPN / SSH 远程操作，请先准备其他访问方式。</div>
        <p class="muted">设备记录、IP、标签和路由保留，仍占用设备额度。不删除设备、不退出你的网页账号，也不影响其他设备。需要在原设备重新登录，或使用新的预授权密钥重新认证。</p>
        <p v-if="current.machine.expired" role="status">此设备已经过期，无需重复操作。</p>
        <p v-else-if="!current.can_expire" class="muted">只读 · 需要网络管理员权限。</p>
        <label v-else class="checkbox"><input v-model="confirmed" type="checkbox" :disabled="saving || blocked" />我已准备好重新认证方式，确认让此设备立即过期</label>
      </template>
    </div>
    <template #footer><button class="btn" :disabled="loading || saving" @click="emit('close')">取消</button><button v-if="current && !current.machine.expired && current.can_expire" class="btn danger" :disabled="!canExpire || !confirmed || blocked || loading || saving" @click="expire">{{ saving ? '正在提交…' : '确认立即过期' }}</button></template>
  </ModalDialog>
</template>
