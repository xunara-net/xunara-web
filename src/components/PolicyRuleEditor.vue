<script setup lang="ts">
import { ref, watch } from "vue";
import type { Machine, User } from "../api/types";
import type { PolicyDocument } from "../api/network-types";
import { putVisualRule, services, type VisualRule } from "../utils/policy";
import { errorMessage } from "../api/client";
import ModalDialog from "./ModalDialog.vue";
import PolicySelector from "./PolicySelector.vue";
const props = defineProps<{ open: boolean; document: PolicyDocument; devices: readonly Machine[]; users: readonly User[]; grants: boolean; editing?: VisualRule; source?: string; destination?: string; preset?: string }>();
const emit = defineEmits<{ (event: "close"): void; (event: "save", document: PolicyDocument): void }>();
const source = ref("");
const destination = ref("");
const protocol = ref("tcp");
const ports = ref("443");
const service = ref("https");
const error = ref("");
watch(() => props.open, (open) => {
  if (!open) return;
  source.value = props.editing?.sources.join(", ") || props.source || "";
  destination.value = props.editing?.destinations.join(", ") || props.destination || "";
  error.value = "";
  if (props.editing) {
    service.value = "custom";
    const entries = props.editing.services;
    const first = entries[0] || "tcp:443";
    const protocols = entries.map((entry) => entry.includes(":") ? entry.split(":")[0] : "*");
    if (new Set(protocols).size > 1) {
      error.value = "此规则包含多种协议，请用高级模式编辑以保留完整权限。";
    }
    protocol.value = first.includes(":") ? first.split(":")[0]! : "*";
    if (protocol.value === "tcp/udp/icmp") protocol.value = "*";
    ports.value = [...new Set(entries.map((entry) => entry.includes(":") ? entry.slice(entry.indexOf(":") + 1) : entry))].join(",");
  } else {
    service.value = props.preset || "https";
    applyService();
  }
});
function applyService() {
  const preset = services.find((item) => item.id === service.value);
  if (preset) { protocol.value = preset.protocol; ports.value = preset.ports; }
  if (service.value === "all") { protocol.value = "*"; ports.value = "*"; }
}
function save() {
  try {
    if (props.editing && new Set(props.editing.services.map((entry) => entry.includes(":") ? entry.split(":")[0] : "*")).size > 1) throw new Error("多协议规则请使用高级模式编辑");
    emit("save", putVisualRule(props.document, source.value, destination.value, protocol.value, ports.value, props.grants, props.editing));
    emit("close");
  } catch (err) { error.value = errorMessage(err); }
}
</script>
<template>
  <ModalDialog :open="open" :title="editing ? '编辑访问规则' : '允许谁访问谁'" @close="emit('close')">
    <form class="stack" @submit.prevent="save">
      <div v-if="error" class="alert error">{{ error }}</div>
      <PolicySelector v-model="source" label="来源" :devices="devices" :users="users" :document="document" />
      <PolicySelector v-model="destination" label="目标" :devices="devices" :users="users" :document="document" />
      <label class="field"><span class="label">允许的服务</span><select v-model="service" class="select" aria-label="允许的服务" @change="applyService"><option v-for="item in services" :key="item.id" :value="item.id">{{ item.name }}</option><option value="all">完全访问（全部协议 / 端口）</option><option value="custom">自定义协议与端口</option></select></label>
      <div v-if="service === 'custom'" class="grid cols-2"><label class="field"><span class="label">协议</span><select v-model="protocol" class="select"><option value="tcp">TCP</option><option value="udp">UDP</option><option value="*">全部协议</option></select></label><label class="field"><span class="label">端口</span><input v-model="ports" class="input" aria-label="端口" placeholder="22,443 或 8000-8010" /></label></div>
      <div class="alert info">规则为单向允许：来源 → 目标。未匹配的流量默认拒绝；已有宽泛允许规则不会被新规则覆盖。路由审批也不会自动授予访问权限。</div>
      <button type="submit" class="btn primary">加入草稿</button>
    </form>
    <template #footer><button class="btn" @click="emit('close')">取消</button></template>
  </ModalDialog>
</template>
