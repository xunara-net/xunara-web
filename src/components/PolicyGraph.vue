<script setup lang="ts">
import { computed, ref } from "vue";
import type { Machine } from "../api/types";
import { deviceSelector, selectorName, type VisualRule } from "../utils/policy";
const props = defineProps<{ devices: readonly Machine[]; rules: readonly VisualRule[]; readonly?: boolean }>();
const emit = defineEmits<{ (event: "connect", source: string, destination: string): void; (event: "edit", rule: VisualRule): void }>();
const mode = ref("flows");
const search = ref("");
const page = ref(0);
const selectedSource = ref("");
const selectedDestination = ref("");
const filtered = computed(() => props.devices.filter((device) => !device.expired && deviceSelector(device) && `${device.hostname} ${device.ipv4} ${device.userLoginName} ${(device.tags ?? []).join(' ')}`.toLowerCase().includes(search.value.toLowerCase())));
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 8)));
const shown = computed(() => filtered.value.slice(Math.min(page.value, pages.value - 1) * 8, (Math.min(page.value, pages.value - 1) + 1) * 8));
const flows = computed(() => props.rules.filter((rule) => [...rule.sources, ...rule.destinations, ...rule.services].map((selector) => selectorName(selector, props.devices)).join(" ").toLowerCase().includes(search.value.toLowerCase())));
function drop(event: DragEvent, device: Machine) {
  const source = event.dataTransfer?.getData("application/x-xunara-device");
  if (!props.readonly && source && props.devices.some((candidate) => deviceSelector(candidate) === source)) emit("connect", source, deviceSelector(device));
}
function drag(event: DragEvent, device: Machine) { event.dataTransfer?.setData("application/x-xunara-device", deviceSelector(device)); }
</script>
<template>
  <div class="toolbar"><button class="btn" :class="{ primary: mode === 'flows' }" @click="mode = 'flows'">策略关系图</button><button class="btn" :class="{ primary: mode === 'devices' }" @click="mode = 'devices'">按设备创建规则</button></div>
  <template v-if="mode === 'flows'">
    <input v-model="search" class="input" aria-label="搜索权限关系" placeholder="按来源、目标、设备组或服务搜索" />
    <p class="muted small-text" style="margin: 12px 0">每条关系对应当前策略中的实际规则，箭头为单向允许声明；最终结果以权限测试为准，不代表实时连接。</p>
    <div class="flow-list">
      <article v-for="rule in flows" :key="`${rule.section}:${rule.index}`" class="flow-row">
        <div class="flow-selector"><span class="small-text muted">来源</span><strong>{{ rule.sources.map((selector) => selectorName(selector, devices)).join('、') }}</strong></div>
        <div class="flow-service"><span aria-hidden="true">→</span><span>{{ rule.services.join('、') }}</span><span aria-hidden="true">→</span></div>
        <div class="flow-selector"><span class="small-text muted">目标</span><strong>{{ rule.destinations.map((selector) => selectorName(selector, devices)).join('、') }}</strong></div>
        <button v-if="!readonly" class="btn small" :disabled="!rule.editable" @click="emit('edit', rule)">编辑 {{ rule.section }} #{{ rule.index + 1 }}</button>
      </article>
    </div>
    <div v-if="!flows.length" class="empty"><div class="title">{{ rules.length ? '没有匹配关系' : '暂无网络允许关系' }}</div><div class="desc">添加来源、目标及服务规则后，预览并发布生效。</div></div>
  </template>
  <template v-else>
  <div class="toolbar"><input v-model="search" class="input" aria-label="搜索图示设备" placeholder="搜索设备、地址、成员或标签" @input="page = 0" /><button class="btn" :disabled="page <= 0" @click="page--">上一页</button><span class="small-text">{{ Math.min(page + 1, pages) }} / {{ pages }}</span><button class="btn" :disabled="page + 1 >= pages" @click="page++">下一页</button></div>
  <p class="muted small-text" style="margin-bottom: 16px">选择来源和目标，或在电脑上拖动来源到目标。此图用于创建权限，不代表实时网络连接。</p>
  <div class="permission-graph">
    <div><h3>来源设备</h3><div class="graph-devices"><button v-for="device in shown" :key="device.id" class="graph-node" :class="{ selected: selectedSource === deviceSelector(device) }" :draggable="!readonly" @dragstart="drag($event, device)" @click="selectedSource = deviceSelector(device)"><strong>{{ device.hostname }}</strong><span class="mono muted">{{ deviceSelector(device) }}</span></button></div></div>
    <div class="graph-direction" aria-hidden="true">→</div>
    <div><h3>目标设备</h3><div class="graph-devices"><button v-for="device in shown" :key="device.id" class="graph-node" :class="{ selected: selectedDestination === deviceSelector(device) }" @dragover.prevent @drop.prevent="drop($event, device)" @click="selectedDestination = deviceSelector(device)"><strong>{{ device.hostname }}</strong><span class="mono muted">{{ deviceSelector(device) }}</span></button></div></div>
  </div>
  <div v-if="!shown.length" class="empty"><div class="title">没有匹配的可用设备</div><div class="desc">请先添加设备，或调整搜索条件。</div></div>
  <button v-if="!readonly" class="btn primary" style="margin-top: 16px" :disabled="!selectedSource || !selectedDestination" @click="emit('connect', selectedSource, selectedDestination)">选择服务并创建权限</button>
  </template>
</template>
<style scoped>
.flow-list { display: grid; gap: 12px; }
.flow-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(100px, 1fr) minmax(0, 1fr); align-items: center; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
.flow-row > .btn { grid-column: 1 / -1; justify-self: end; }
.flow-selector { display: grid; gap: 8px; overflow-wrap: anywhere; }
.flow-service { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--primary); font-size: 12px; overflow-wrap: anywhere; }
.permission-graph { display: grid; grid-template-columns: minmax(0, 1fr) 32px minmax(0, 1fr); gap: 10px; }
.graph-devices { display: grid; gap: 10px; margin-top: 12px; }
.graph-node { display: grid; gap: 6px; padding: 12px; border: 1px solid var(--border); background: var(--surface-2); border-radius: var(--radius-sm); text-align: left; color: var(--text); cursor: pointer; font: inherit; overflow-wrap: anywhere; min-width: 0; }
.graph-node.selected { border-color: var(--primary); background: var(--primary-soft); }
.graph-direction { align-self: center; font-size: 24px; color: var(--primary); text-align: center; }
@media (max-width: 560px) { .permission-graph { grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr); gap: 5px; } .graph-node { padding: 10px; font-size: 12px; } .graph-node .mono { font-size: 10px; } }
@media (max-width: 560px) { .flow-row { grid-template-columns: 1fr; } .flow-service { justify-content: flex-start; } }
</style>
