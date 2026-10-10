<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { AuditEvent, Machine, Overview, PendingDevice } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import StatCard from "../components/StatCard.vue";
import DataTable from "../components/DataTable.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { formatTime, quotaPercent, quotaText, relativeTime } from "../utils/format";

const loading = ref(true);
const error = ref("");
const overview = ref<Overview | null>(null);
const machines = ref<Machine[]>([]);
const pending = ref<PendingDevice[]>([]);
const audit = ref<AuditEvent[]>([]);

const plan = computed(() => session.state.plan);
const usedPercent = computed(() => quotaPercent(plan.value?.devicesUsed ?? 0, plan.value?.maxDevices));

const auditColumns = [
  { key: "action", title: "操作" },
  { key: "actor", title: "操作者" },
  { key: "resource", title: "对象" },
  { key: "at", title: "时间", align: "right" as const },
];

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [o, m, p, a] = await Promise.all([
      ep.getOverview(),
      ep.listMachines(),
      ep.listPendingDevices(),
      ep.listAudit(10).catch(() => []),
    ]);
    overview.value = o;
    machines.value = m;
    pending.value = p;
    audit.value = a;
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function auditTime(event: AuditEvent): string {
  return formatTime(event.at ?? event.time);
}

// The console is served by the control plane itself, so its own origin is the
// login server a client needs. Nobody should have to derive that.
const loginServer = computed(() => overview.value?.serverUrl || window.location.origin);
const loginCommand = computed(() => `sudo tailscale up --login-server ${loginServer.value}`);
const showOnboarding = computed(() => !loading.value && !error.value && machines.value.length === 0);

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    session.toast("success", `${label}已复制`);
  } catch {
    session.toast("error", "浏览器拒绝了剪贴板访问，请手动复制");
  }
}
</script>

<template>
  <PageHeader title="控制台首页" desc="你的网络一览：设备、在线状态、套餐用量与最近事件。">
    <template #actions>
      <button class="btn" @click="load">刷新</button>
    </template>
  </PageHeader>

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>

  <div class="grid cols-4">
    <StatCard label="设备总数" :value="overview?.machines.total ?? '—'" :sub="`在线 ${overview?.machines.online ?? 0} 台`" />
    <StatCard label="待审批设备" :value="pending.length" :tone="pending.length ? 'warning' : 'default'" sub="需要在设备页批准" />
    <StatCard label="网络地址" :value="plan?.networkPrefix ?? '—'" sub="新设备从该网段分配地址" />
    <StatCard
      label="套餐用量"
      :value="plan ? `${plan.devicesUsed} / ${quotaText(plan.maxDevices)}` : '—'"
      :tone="usedPercent !== null && usedPercent >= 90 ? 'warning' : 'default'"
      :sub="plan ? plan.name : '未启用套餐'"
    />
  </div>

  <div class="card" v-if="showOnboarding">
    <div class="card-head">
      <h2>接入第一台设备</h2>
      <span class="hint">三步把设备接进这个网络</span>
    </div>
    <div class="card-body">
      <ol style="margin: 0; padding-left: 18px; color: var(--text-muted); font-size: 13px; line-height: 1.9">
        <li>
          安装官方 Tailscale 客户端（
          <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">下载页</a>
          ；Linux 可用 <code>curl -fsSL https://tailscale.com/install.sh | sh</code>）。
        </li>
        <li>用你的服务器地址登录（桌面端与服务器端）：</li>
      </ol>
      <div class="snippet">
        <code>{{ loginCommand }}</code>
        <button class="btn small" @click="copy(loginCommand, '登录命令')">复制</button>
      </div>
      <div class="snippet">
        <code>{{ loginServer }}</code>
        <button class="btn small" @click="copy(loginServer, '服务器地址')">复制</button>
      </div>
      <ol start="3" style="margin: 10px 0 0; padding-left: 18px; color: var(--text-muted); font-size: 13px; line-height: 1.9">
        <li>
          设备首次连接后会出现在
          <router-link to="/devices">设备</router-link>
          页的「待审批」里，批准后即可访问网络；需要免交互批量接入时用
          <router-link to="/api">预授权密钥</router-link>。
        </li>
      </ol>
    </div>
  </div>

  <div class="card" v-if="plan">
    <div class="card-head">
      <h2>套餐用量</h2>
      <router-link to="/plan" class="hint">查看套餐详情 →</router-link>
    </div>
    <div class="card-body">
      <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px">
        <span>设备</span>
        <span style="color: var(--text-muted)">{{ plan.devicesUsed }} / {{ quotaText(plan.maxDevices) }}</span>
      </div>
      <div class="progress" :class="usedPercent !== null && usedPercent >= 90 ? 'warning' : ''">
        <span :style="`width: ${usedPercent ?? 4}%`" />
      </div>
      <div v-if="plan.networkPrefix" style="margin-top: 14px; color: var(--text-muted); font-size: 12.5px">
        当前设备分配网段 {{ plan.networkPrefix }}<template v-if="!plan.allowCustomCidr">；当前套餐不可自定义网段</template>。
        <router-link to="/network">{{ plan.allowCustomCidr ? "管理自定义网段 →" : "查看网络网段 →" }}</router-link>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>最近设备</h2>
      <router-link to="/devices" class="hint">全部设备 →</router-link>
    </div>
    <DataTable :columns="[
      { key: 'hostname', title: '设备' },
      { key: 'status', title: '状态' },
      { key: 'ipv4', title: 'Tailscale IP' },
      { key: 'lastSeen', title: '最后在线', align: 'right' },
    ]" :rows="machines.slice(0, 6)" :loading="loading" empty-title="还没有设备" empty-desc="安装官方 Tailscale 客户端并使用本服务器地址登录。">
      <template #cell-hostname="{ row }">
        <router-link :to="`/devices/${row.id}`" class="mono">{{ row.hostname || `设备 #${row.id}` }}</router-link>
      </template>
      <template #cell-status="{ row }"><StatusBadge :online="row.online" :expired="row.expired" /></template>
      <template #cell-ipv4="{ row }"><span class="mono">{{ row.ipv4 || "—" }}</span></template>
      <template #cell-lastSeen="{ row }">{{ relativeTime(row.lastSeen) }}</template>
    </DataTable>
  </div>

  <div class="card">
    <div class="card-head">
      <h2>最近事件</h2>
      <router-link to="/audit" class="hint">审计日志 →</router-link>
    </div>
    <DataTable :columns="auditColumns" :rows="audit" :loading="loading" empty-title="暂无事件">
      <template #cell-at="{ row }">{{ auditTime(row) }}</template>
    </DataTable>
  </div>
</template>
