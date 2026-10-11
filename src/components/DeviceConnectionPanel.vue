<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getDeviceConnection, type DeviceConnection } from "../api/device-connection";
import { errorMessage } from "../api/client";
import type { Machine } from "../api/types";
import { formatTime } from "../utils/format";

const props = defineProps<{ machine: Machine }>();
const data = ref<DeviceConnection | null>(null);
const loading = ref(false), error = ref("");
let requestNumber = 0, active = true;
onBeforeUnmount(() => { active = false; requestNumber++; });
watch(() => props.machine, load, { immediate: true });
const homeLabel = computed(() => data.value?.homeRegion ? (data.value.homeRegion.name || `区域 ${data.value.homeRegion.id}`) :
  data.value?.policyMode === "none" ? "网络策略已关闭中继" : data.value?.mapConfigured ? "尚未确定归属" : "使用客户端内置地图，平台未指定");
const sourceLabels: Record<string, string> = { deployment: "部署默认中继", external: "非托管中继", managed: "租户私有中继" };
const linkLabels: Record<string, string> = { wired: "有线网络", wifi: "Wi-Fi", mobile: "移动网络" };
const sourceLabel = computed(() => sourceLabels[data.value?.homeRegion?.source ?? ""] || "来源未确认");
const linkLabel = computed(() => linkLabels[data.value?.network?.linkType ?? ""] || "未上报");
const optionalLabel = (value: boolean | null | undefined, positive = "可用", negative = "不可用") => value === true ? positive : value === false ? negative : "未上报";

async function load() {
  const reference = props.machine.stableId;
  const sequence = ++requestNumber;
  data.value = null; error.value = ""; loading.value = true;
  try {
    const result = await getDeviceConnection(reference);
    if (!active || sequence !== requestNumber || reference !== props.machine.stableId) return;
    if (result.stableId !== reference) throw new Error("设备已变化，请重新读取连接信息");
    data.value = result;
  } catch (failure) {
    if (active && sequence === requestNumber) error.value = errorMessage(failure);
  } finally {
    if (active && sequence === requestNumber) loading.value = false;
  }
}
</script>

<template>
  <section class="card" aria-label="设备连接与中继">
    <div class="card-head"><h2>连接与中继</h2><button class="btn small" :disabled="loading" @click="load">{{ loading ? '正在读取…' : '刷新连接信息' }}</button></div>
    <div class="card-body stack">
      <p v-if="loading" class="muted" role="status">正在读取设备报告与实际下发地图…</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}；基本信息和路由仍可查看，重试不会改变设备配置。</div>
      <template v-if="data">
        <div class="connection-summary">
          <div><span class="muted small-text">控制面连接</span><strong>{{ data.controlOnline ? '在线' : '离线 / 尚未连接' }}</strong></div>
          <div><span class="muted small-text">归属中继</span><strong>{{ homeLabel }}</strong><span v-if="data.homeRegion?.advertised" class="muted small-text">{{ sourceLabel }} · 区域 {{ data.homeRegion.id }}</span></div>
          <div><span class="muted small-text">UDP 网络检测</span><strong>{{ optionalLabel(data.network?.udp) }}</strong></div>
        </div>
        <p class="muted small-text">中继归属用于发现与回退，不表示所有流量正在走中继。实际直连/中继路径请在客户端用 <code>tailscale status</code> 或 <code>tailscale ping</code> 核对。</p>
        <div v-if="!data.controlOnline" class="alert warning">设备当前未连接控制面，下方是缓存报告，不是实时测速。</div>
        <div v-if="data.homeRegion && !data.homeRegion.advertised" class="alert warning">上次归属区域未在当前地图下发，请检查中继策略和客户端连接。</div>
        <div class="kv">
          <div class="k">最后联系控制面</div><div class="v">{{ data.lastControlSeenAt ? formatTime(data.lastControlSeenAt) : '未记录' }}</div>
          <div class="k">客户端首选中继</div><div class="v">{{ data.reportedRegionId ? `区域 ${data.reportedRegionId}` : '未上报 / 未确定' }}<span v-if="data.reportedRegionId && !data.reportedRegionAdvertised" class="muted"> · 未由当前地图确认</span></div>
          <div class="k">网络类型</div><div class="v">{{ linkLabel }}</div>
          <div class="k">IPv6 网络检测</div><div class="v">{{ optionalLabel(data.network?.ipv6) }}</div>
          <div class="k">NAT 映射随目的变化</div><div class="v">{{ optionalLabel(data.network?.mappingVariesByDestIP, '是', '否') }}</div>
        </div>
        <p v-if="!data.reportAvailable" class="muted small-text">客户端尚未上报网络检测信息。客户端连接或网络变化时会自动上报，缺少报告不代表网络检测失败。</p>
        <details v-if="data.homeRegion?.servers.length" class="connection-details">
          <summary>归属中继服务器（{{ data.homeRegion.servers.length }}）</summary>
          <div v-for="server in data.homeRegion.servers" :key="`${server.name}-${server.hostname}`" class="connection-server">
            <strong class="mono">{{ server.hostname }}</strong><span>{{ server.stunOnly ? '仅 STUN' : `DERP TLS 端口 ${server.derpPort}` }} · {{ server.stunPort === -1 ? 'STUN 未启用' : `STUN UDP 端口 ${server.stunPort}` }}</span>
          </div>
          <p v-if="data.homeRegion.serversTruncated" class="muted small-text">只展示前 32 个服务器。</p>
        </details>
        <details v-if="data.latencies.length" class="connection-details">
          <summary>中继探测延迟（{{ data.latencies.length }}）</summary>
          <p class="muted small-text">客户端最近上报的探测值，不是点对点应用 RTT；未测到的区域不显示假延迟。</p>
          <div v-for="measurement in data.latencies" :key="`${measurement.regionId}-${measurement.addressFamily}`" class="connection-measurement">
            <span>{{ measurement.name || measurement.code || `区域 ${measurement.regionId}` }} <span class="muted">{{ measurement.addressFamily === 'ipv4' ? 'IPv4' : 'IPv6' }}</span></span><strong>{{ measurement.milliseconds.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }} ms</strong>
          </div>
          <p v-if="data.latenciesTruncated" class="muted small-text">只展示前 128 项探测。</p>
        </details>
        <details v-if="data.endpoints.length" class="connection-details">
          <summary>候选连接端点（{{ data.endpointCount }}）</summary>
          <p class="muted small-text">这是客户端上报的候选地址，不代表每个地址可达或正在使用。</p>
          <p v-for="endpoint in data.endpoints" :key="endpoint" class="mono">{{ endpoint }}</p>
          <p v-if="data.endpointsTruncated" class="muted small-text">只展示前 32 个端点。</p>
        </details>
        <p class="muted small-text">读取时间：{{ formatTime(data.generatedAt) }}；客户端报告没有独立检测时间，不能据此认定报告刚刚更新。</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.connection-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.connection-summary > div { display: flex; flex-direction: column; gap: 6px; padding: 12px; background: var(--surface-2); border-radius: 8px; min-width: 0; overflow-wrap: anywhere; }
.connection-details { border: 1px solid var(--border); padding: 12px; border-radius: 8px; overflow-wrap: anywhere; }
.connection-details summary { cursor: pointer; font-weight: 600; }
.connection-details p { margin: 10px 0 0; }
.connection-server { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.connection-measurement { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
@media (max-width: 600px) {
  .connection-summary { grid-template-columns: 1fr; gap: 6px; }
  .connection-summary > div { display: grid; grid-template-columns: 94px minmax(0, 1fr); gap: 4px 10px; padding: 8px 10px; }
  .connection-summary > div > strong { font-size: 14px; }
  .connection-summary > div > span:not(:first-child) { grid-column: 2; }
}
</style>
