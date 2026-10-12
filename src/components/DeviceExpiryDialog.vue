<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getDeviceLifecycle, expireDevice, updateDeviceExpiry, hasDeviceExpiryPolicy, type DeviceLifecycle } from "../api/device-enrollment";
import { localExpiryInput, localExpiryToISO, validateDeviceExpirySetting, type DeviceExpirySetting } from "../utils/device-expiry";
import { errorMessage } from "../api/client";
import { canManageNetwork } from "../utils/devices";
import { formatTime } from "../utils/format";
import { session } from "../store";
import type { Machine } from "../api/types";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ open: boolean; reference: string }>();
const emit = defineEmits<{ close: []; updated: [machine: Machine] }>();
const current = ref<DeviceLifecycle | null>(null), error = ref(""), loading = ref(false), saving = ref(false);
const confirmed = ref(false), blocked = ref(false), mode = ref("schedule"), period = ref("180"), customTime = ref("");
const elapsed = ref(0);
let sequence = 0, active = true, observedAt = 0, timer: ReturnType<typeof setInterval> | undefined;
function stopClock() { clearInterval(timer); timer = undefined; }
onBeforeUnmount(() => { active = false; sequence++; stopClock(); });
watch(() => [props.open, props.reference], () => {
  sequence++; stopClock(); current.value = null; error.value = ""; confirmed.value = false; blocked.value = false;
  loading.value = false; saving.value = false;
  if (props.open) load();
}, { immediate: true });
const serverNow = computed(() => Date.parse(current.value?.server_time || "") + elapsed.value);
const expired = computed(() => Boolean(current.value?.machine.expired || (current.value?.machine.expires && Date.parse(current.value.machine.expires) <= serverNow.value)));
const canManage = computed(() => Boolean(current.value?.can_expire && current.value.csrf_token && hasDeviceExpiryPolicy(current.value) && canManageNetwork(session.state.user?.role)));
watch(expired, (value) => {
  if (value) {
    mode.value = "extend"; confirmed.value = false;
    if (current.value && !current.value.machine.expired) {
      blocked.value = true; error.value = "设备在此期间已到期，请读取最新状态，再确认临时续期";
    }
  }
});
watch([mode, period, customTime], () => { confirmed.value = false; });
function setting(): DeviceExpirySetting {
  if (mode.value === "disable" || mode.value === "extend") return { mode: mode.value };
  if (period.value !== "custom") return { mode: "schedule", duration_seconds: Number(period.value) * 86400 };
  // 未改动日期输入时保留服务器的秒/纳秒，避免分钟控件把原有效期意外缩短。
  const original = current.value?.machine.expires;
  return { mode: "schedule", expires_at: original && customTime.value === localExpiryInput(original) ? original : localExpiryToISO(customTime.value) };
}
const validation = computed(() => {
  if (mode.value !== "schedule") return "";
  try { validateDeviceExpirySetting(setting(), serverNow.value, current.value?.expiry_policy?.max_duration_seconds || 0); return ""; }
  catch (failure) { return errorMessage(failure); }
});
const preview = computed(() => {
  if (mode.value === "disable") return "永不过期";
  if (mode.value === "expire") return "立即过期";
  if (mode.value === "extend") return "临时恢复 30 分钟，请在窗口内重新认证";
  if (validation.value) return "";
  const selected = setting();
  return formatTime(selected.expires_at || new Date(serverNow.value + (selected.duration_seconds || 0) * 1000).toISOString());
});
const confirmation = computed(() => mode.value === "expire" ? "我已准备好重新认证方式，确认让此设备立即过期" : mode.value === "extend" ? "确认临时恢复此设备 30 分钟" : mode.value === "disable" ? "我信任此设备，确认关闭自动过期" : "确认修改此设备的密钥到期时间");
const buttonText = computed(() => mode.value === "expire" ? "确认立即过期" : mode.value === "extend" ? "临时续期 30 分钟" : "保存有效期");
async function load() {
  if (saving.value) return;
  const request = ++sequence, reference = props.reference;
  stopClock(); loading.value = true; error.value = ""; current.value = null; confirmed.value = false; blocked.value = true;
  try {
    const result = await getDeviceLifecycle(reference);
    if (active && request === sequence && props.open && reference === props.reference) {
      current.value = result; elapsed.value = 0; observedAt = performance.now(); blocked.value = false;
      mode.value = result.machine.expired ? "extend" : "schedule";
      customTime.value = result.machine.expires ? localExpiryInput(result.machine.expires) : "";
      period.value = result.machine.expires ? "custom" : "180";
      timer = setInterval(() => { elapsed.value = performance.now() - observedAt; }, 1000);
    }
  } catch (failure) { if (active && request === sequence) error.value = errorMessage(failure); }
  finally { if (active && request === sequence) loading.value = false; }
}
async function save() {
  if (!current.value || !canManage.value || !confirmed.value || validation.value || blocked.value || saving.value || loading.value) return;
  const request = sequence, reference = props.reference, observed = current.value, selectedMode = mode.value;
  saving.value = true; error.value = "";
  try {
    if (selectedMode !== "expire") validateDeviceExpirySetting(setting(), Date.parse(observed.server_time!) + performance.now() - observedAt, observed.expiry_policy!.max_duration_seconds);
    const result = selectedMode === "expire" ? await expireDevice(reference, observed.revision, observed.csrf_token) : await updateDeviceExpiry(reference, observed, setting());
    if (active && request === sequence && props.open && reference === props.reference) {
      emit("updated", result.machine); emit("close");
      session.toast("success", selectedMode === "expire" ? "设备密钥已过期，需要重新认证" : selectedMode === "extend" ? "已临时续期 30 分钟，请及时重新认证" : "设备有效期已更新");
    }
  } catch (failure) {
    if (active && request === sequence) { error.value = errorMessage(failure); confirmed.value = false; blocked.value = true; }
  } finally { if (active && request === sequence) saving.value = false; }
}
</script>

<template>
  <ModalDialog :open="open" title="设备有效期设置" :busy="loading || saving" @close="emit('close')">
    <div class="stack">
      <p v-if="loading" role="status">正在读取设备密钥有效期…</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}<p>不自动重试，请读取最新状态后重新确认。</p><button class="btn small" :disabled="saving || loading" @click="load">读取最新设备状态</button></div>
      <template v-if="current">
        <div class="kv"><div class="k">设备</div><div class="v">{{ current.machine.hostname || `设备 #${current.machine.id}` }}</div><div class="k">当前有效期</div><div class="v">{{ current.machine.expires ? formatTime(current.machine.expires) : '永不过期' }}{{ expired ? ' · 已过期' : '' }}</div></div>
        <p v-if="!hasDeviceExpiryPolicy(current)" class="alert warning">服务器尚未提供有效期设置，请升级或重新读取。</p>
        <p v-else-if="!canManage" class="muted">只读 · 需要网络管理员权限。</p>
        <template v-else>
          <label class="field"><span class="muted">过期方式</span><select v-model="mode" class="select" aria-label="过期方式" :disabled="saving || blocked"><template v-if="!expired"><option value="schedule">设置到期时间</option><option value="disable">永不过期</option><option value="expire">立即过期</option></template><option v-else value="extend">临时续期 30 分钟</option></select></label>
          <template v-if="mode === 'schedule'">
            <label class="field"><span class="muted">有效期</span><select v-model="period" class="select" aria-label="有效期" :disabled="saving || blocked"><option v-for="days in [1, 7, 30, 90, 180]" :key="days" :value="String(days)">{{ days }} 天后</option><option value="custom">指定日期和时间</option></select></label>
            <label v-if="period === 'custom'" class="field"><span class="muted">到期时间（本地时区）</span><input v-model="customTime" class="input" aria-label="到期时间（本地时区）" type="datetime-local" :disabled="saving || blocked" /></label>
            <p v-if="validation" class="alert warning" role="status">{{ validation }}</p>
            <p v-else class="muted">预计到期：{{ preview }}。天数以服务器时间计算。</p>
          </template>
          <div v-if="mode === 'expire'" class="alert warning">当前节点密钥将立即失效，连接可能中断。若正在使用此设备的 VPN / SSH，请先准备其他访问方式。</div>
          <div v-else-if="mode === 'disable'" class="alert warning">密钥不再自动过期，仅建议用于可信的服务器或路由设备。</div>
          <div v-else-if="mode === 'extend'" class="alert warning">显式恢复已过期密钥 30 分钟。请在窗口内重新认证，或为可信设备关闭过期；不会自动续期。</div>
          <p class="muted">只修改这台设备当前的节点密钥，不删除设备、IP 或路由，不影响其他设备和网页登录。与加入设备的 Token 有效期不同。</p>
          <label class="checkbox"><input v-model="confirmed" type="checkbox" :disabled="saving || blocked || Boolean(validation)" />{{ confirmation }}</label>
        </template>
      </template>
    </div>
    <template #footer><button class="btn" :disabled="loading || saving" @click="emit('close')">取消</button><button v-if="canManage" class="btn" :class="mode === 'expire' ? 'danger' : 'primary'" :disabled="!confirmed || Boolean(validation) || blocked || loading || saving" @click="save">{{ saving ? '正在提交…' : buttonText }}</button></template>
  </ModalDialog>
</template>

<style scoped>
.field { display: grid; gap: 6px; margin-bottom: 0; min-width: 0; }
.input, .select { min-width: 0; max-width: 100%; }
</style>
