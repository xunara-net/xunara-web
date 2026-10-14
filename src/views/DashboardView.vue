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
import AddDeviceDialog from "../components/AddDeviceDialog.vue";
import { formatTime, quotaPercent, quotaText, relativeTime } from "../utils/format";

const loading = ref(true);
const error = ref("");
const overview = ref<Overview | null>(null);
const machines = ref<Machine[]>([]);
const pending = ref<PendingDevice[]>([]);
const audit = ref<AuditEvent[]>([]);
const addOpen = ref(false);

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

// 首页只提供统一向导入口，不再另算登录地址；共享网页入口并不是本租户的客户端入口。
const showOnboarding = computed(() => !loading.value && !error.value && machines.value.length === 0);
</script>

<template>
  <PageHeader title="控制台首页" desc="你的网络一览：设备、在线状态、套餐用量与最近事件。">
    <template #actions>
      <button class="btn primary" @click="addOpen = true">添加设备</button>
      <button class="btn" :disabled="loading" @click="load">刷新</button>
    </template>
  </PageHeader>

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>

  <div class="card" v-if="showOnboarding">
    <div class="card-head">
      <h2>{{ pending.length ? "已有设备等待审批" : "添加第一台设备" }}</h2>
    </div>
    <div class="card-body">
      <div class="stack">
        <template v-if="pending.length">
          <p class="muted">{{ pending.length }} 台设备已申请加入，网络管理员批准后即可接入。</p>
          <div><router-link to="/devices" class="btn primary">查看待审批设备</router-link></div>
        </template>
        <template v-else>
          <p class="muted">选择设备平台，使用官方 Tailscale 客户端加入。电脑和服务器可复制一条命令，手机按 APP 提示操作。</p>
          <p class="muted small-text">浏览器授权需要设备审批；使用设备 Token 可免网页登录，仍受设备额度与访问策略约束。</p>
          <div><button class="btn primary" @click="addOpen = true">添加第一台设备</button></div>
        </template>
      </div>
    </div>
  </div>

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
    ]" :rows="machines.slice(0, 6)" :loading="loading" empty-title="还没有设备" empty-desc="点击「添加设备」，选择平台并按接入向导操作。">
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
  <AddDeviceDialog :open="addOpen" @close="addOpen = false" />
</template>
