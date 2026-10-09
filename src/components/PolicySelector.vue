<script setup lang="ts">
import { computed, ref } from "vue";
import type { Machine, User } from "../api/types";
import type { PolicyDocument } from "../api/network-types";
import { deviceSelector, selectorName } from "../utils/policy";
const props = defineProps<{ modelValue: string; label: string; devices: readonly Machine[]; users: readonly User[]; document: PolicyDocument; disabled?: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();
const mode = ref("devices");
const selected = ref("");
const selectors = computed(() => props.modelValue.split(/[\s,，]+/).filter(Boolean));
const choices = computed(() => {
  if (mode.value === "users") return props.users.map((user) => ({ value: user.loginName, label: user.displayName || user.loginName }));
  if (mode.value === "groups") return [
    ...Object.keys(props.document.tagOwners ?? {}).map((value) => ({ value, label: `设备组 · ${value.slice(4)}` })),
    ...Object.keys(props.document.groups ?? {}).map((value) => ({ value, label: `成员组 · ${value.slice(6)}` })),
  ];
  return props.devices.filter((device) => !device.expired && deviceSelector(device)).map((device) => ({ value: deviceSelector(device), label: `${device.hostname} · ${deviceSelector(device)}` }));
});
function add() {
  if (selected.value && !selectors.value.includes(selected.value)) emit("update:modelValue", [...selectors.value, selected.value].join(", "));
  selected.value = "";
}
function remove(value: string) { emit("update:modelValue", selectors.value.filter((item) => item !== value).join(", ")); }
</script>
<template>
  <fieldset class="selector-field" :disabled="disabled">
    <legend>{{ label }}</legend>
    <div class="selector-controls">
      <select v-model="mode" class="select" :aria-label="`${label}选择类型`"><option value="devices">设备</option><option value="users">成员</option><option value="groups">设备组 / 成员组</option><option value="custom">高级选择器</option></select>
      <select v-if="mode !== 'custom'" v-model="selected" class="select" :aria-label="label" @change="add"><option value="">请选择，可添加多个</option><option v-for="choice in choices" :key="choice.value" :value="choice.value">{{ choice.label }}</option><option value="*">全部设备（谨慎）</option><option value="autogroup:self">同一成员的设备</option></select>
      <input v-else class="input mono" :aria-label="label" :value="modelValue" placeholder="tag:home、group:office 或 IP / CIDR" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
    </div>
    <div v-if="mode !== 'custom'" class="tag-list selector-tags"><span v-for="value in selectors" :key="value" class="badge">{{ selectorName(value, devices) }}<button type="button" :aria-label="`移除 ${value}`" @click="remove(value)">×</button></span><span v-if="!selectors.length" class="muted small-text">尚未选择</span></div>
  </fieldset>
</template>
<style scoped>
.selector-field { border: 0; padding: 0; margin: 0; min-width: 0; }
legend { font-size: 13px; margin-bottom: 8px; font-weight: 500; }
.selector-controls { display: flex; gap: 8px; }
.selector-controls > :first-child { width: 138px; flex-shrink: 0; }
.selector-controls > :last-child { min-width: 0; flex: 1; }
.selector-tags { margin-top: 8px; }
.selector-tags button { border: 0; background: transparent; color: inherit; cursor: pointer; margin-left: 8px; font-size: 16px; }
@media (max-width: 560px) { .selector-controls { flex-direction: column; } .selector-controls > :first-child { width: 100%; } }
</style>
