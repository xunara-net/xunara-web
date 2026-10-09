<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import { ApiError, errorMessage } from "../api/client";
import type { AccountSession, AccountSessions, SecuritySnapshot } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import StatCard from "../components/StatCard.vue";
import { formatTime, relativeTime } from "../utils/format";
import { authMethodLabel, revokedReasonLabel, securityFindingText, severityLabel, splitAccountSessions } from "../utils/security";

const router = useRouter();
const loading = ref(true);
const error = ref("");
const accountSessions = ref<AccountSessions | null>(null);
const busy = ref("");
const securityLoading = ref(true);
const securityError = ref("");
const snapshot = ref<SecuritySnapshot | null>(null);
const grouped = computed(() => splitAccountSessions(accountSessions.value?.sessions ?? [], accountSessions.value?.currentSessionId ?? ""));
const disabled = computed(() => loading.value || !!busy.value || !accountSessions.value);
const findings = computed(() => (snapshot.value?.findings ?? []).map((finding) => ({
  id: finding.id, ...securityFindingText(finding), ...severityLabel(finding.severity),
})));

onMounted(() => Promise.all([loadSessions(), loadSecurity()]));

async function handleExpiredSession(err: unknown) {
  if (err instanceof ApiError && err.status === 401) {
    session.forget();
    await router.replace({ name: "login", query: { return_to: "/security" } });
  }
}

async function loadSessions() {
  loading.value = true;
  error.value = "";
  try {
    accountSessions.value = await ep.getAccountSessions();
  } catch (err) {
    accountSessions.value = null;
    error.value = errorMessage(err);
    await handleExpiredSession(err);
  } finally {
    loading.value = false;
  }
}

async function loadSecurity() {
  securityLoading.value = true;
  securityError.value = "";
  try {
    snapshot.value = await ep.getSecurity();
  } catch (err) {
    snapshot.value = null;
    securityError.value = errorMessage(err);
    await handleExpiredSession(err);
  } finally {
    securityLoading.value = false;
  }
}

async function revoke(target: AccountSession | "others" | "all") {
  if (disabled.value || !accountSessions.value) return;
  const current = typeof target !== "string" && target.id === accountSessions.value.currentSessionId;
  let message = "退出此登录后，对应浏览器需要重新登录。继续？";
  if (current) message = "退出当前登录后，需要重新登录。继续？";
  if (target === "others") message = `退出其他 ${grouped.value.otherCount} 个登录，保留当前浏览器登录。继续？`;
  if (target === "all") message = "退出全部控制台登录（包括当前浏览器），之后需要重新登录。继续？";
  if (!window.confirm(`${message} 已连接的组网设备与 API 密钥不受影响。`)) return;
  busy.value = typeof target === "string" ? target : target.id;
  error.value = "";
  try {
    const result = typeof target === "string"
      ? await ep.revokeAccountSessions(target, accountSessions.value.csrfToken)
      : await ep.revokeAccountSession(target.id, accountSessions.value.csrfToken);
    if (result.current_revoked) {
      session.forget();
      await router.replace({ name: "login", query: { signed_out: target === "all" ? "all" : "current" } });
      return;
    }
    session.toast("success", `已退出 ${result.revoked_sessions} 个登录`);
    await loadSessions();
  } catch (err) {
    error.value = errorMessage(err);
    await handleExpiredSession(err);
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <PageHeader title="安全中心" desc="管理控制台登录，查看网络安全提示。退出登录不会断开已连接的组网设备。">
    <template #actions><RouterLink class="btn" to="/settings">修改密码</RouterLink></template>
  </PageHeader>

  <div class="card">
    <div class="card-head session-head">
      <div><h2>活动登录 <span v-if="accountSessions" class="badge primary">{{ grouped.active.length }}</span></h2></div>
      <div class="session-actions">
        <button class="btn small" :disabled="loading || !!busy" @click="loadSessions">刷新</button>
        <button class="btn small" :disabled="disabled || grouped.otherCount === 0" @click="revoke('others')">{{ busy === 'others' ? '正在退出…' : '退出其他登录' }}</button>
        <button class="btn small danger" :disabled="disabled || grouped.active.length === 0" @click="revoke('all')">{{ busy === 'all' ? '正在退出…' : '退出全部登录' }}</button>
      </div>
    </div>
    <div v-if="error" class="alert error session-feedback" role="alert">{{ error }}</div>
    <DataTable v-if="!error || accountSessions" :columns="[
      { key: 'id', title: '登录会话' },
      { key: 'authMethod', title: '登录方式' },
      { key: 'createdAt', title: '登录时间' },
      { key: 'expiresAt', title: '到期时间' },
      { key: 'actions', title: '操作', align: 'right' },
    ]" :rows="grouped.active" :loading="loading" row-key="id" empty-title="没有活动登录" empty-desc="刷新列表或重新登录后再试。">
      <template #cell-id="{ row }">
        <div>{{ row.id === accountSessions?.currentSessionId ? '当前浏览器' : '其他登录会话' }} <span v-if="row.id === accountSessions?.currentSessionId" class="badge success">当前</span></div>
        <div class="hint mono" :title="row.id">{{ row.id.slice(0, 12) }}…</div>
      </template>
      <template #cell-authMethod="{ row }">{{ authMethodLabel(row.authMethod) }}</template>
      <template #cell-createdAt="{ row }"><span :title="formatTime(row.createdAt)">{{ relativeTime(row.createdAt) }}</span></template>
      <template #cell-expiresAt="{ row }">{{ formatTime(row.expiresAt) }}</template>
      <template #cell-actions="{ row }">
        <button class="btn small danger" :disabled="disabled" @click="revoke(row)">{{ busy === row.id ? '正在退出…' : row.id === accountSessions?.currentSessionId ? '退出当前登录' : '退出此登录' }}</button>
      </template>
    </DataTable>
    <div class="card-body session-note">这里只管理本账户的控制台登录，不影响其他用户。怀疑密码泄露时，还应<RouterLink to="/settings">修改密码</RouterLink>。当前未采集浏览器型号与来源位置。</div>
  </div>

  <details v-if="accountSessions && grouped.history.length" class="card session-history">
    <summary>已失效的登录记录 <span class="badge">{{ grouped.history.length }}</span></summary>
    <div class="card-body session-note">这些登录已退出或过期，无须再次撤销。仅展示服务端仍保留的会话记录，不代表完整登录历史。</div>
    <DataTable :columns="[
      { key: 'authMethod', title: '登录方式' },
      { key: 'createdAt', title: '登录时间' },
      { key: 'status', title: '状态' },
      { key: 'endedAt', title: '失效时间' },
      { key: 'revokedReason', title: '原因' },
    ]" :rows="grouped.history" row-key="id">
      <template #cell-authMethod="{ row }">{{ authMethodLabel(row.authMethod) }}</template>
      <template #cell-createdAt="{ row }">{{ formatTime(row.createdAt) }}</template>
      <template #cell-status="{ row }"><span class="badge">{{ row.status === 'expired' ? '已过期' : '已退出' }}</span></template>
      <template #cell-endedAt="{ row }">{{ formatTime(row.revokedAt || row.expiresAt) }}</template>
      <template #cell-revokedReason="{ row }">{{ row.status === 'expired' ? '会话到期' : revokedReasonLabel(row.revokedReason) }}</template>
    </DataTable>
  </details>

  <div class="card">
    <div class="card-head"><h2>网络安全概览</h2><button class="btn small" :disabled="securityLoading" @click="loadSecurity">刷新</button></div>
    <div v-if="securityLoading" class="page-loading" role="status">正在读取安全状态…</div>
    <div v-else-if="securityError" class="alert error session-feedback" role="alert">{{ securityError }}</div>
    <div v-else-if="snapshot" class="card-body">
      <div class="grid cols-4 security-stats">
        <StatCard label="待审批设备" :value="snapshot.devices.pending" :tone="snapshot.devices.pending ? 'warning' : 'default'" sub="请核实设备来源" />
        <StatCard label="设备密钥即将到期" :value="snapshot.nodes.expiringSoon" :tone="snapshot.nodes.expiringSoon ? 'warning' : 'default'" sub="未来 30 天内" />
        <StatCard label="已过期设备密钥" :value="snapshot.nodes.expired" :tone="snapshot.nodes.expired ? 'danger' : 'default'" sub="相关设备须重新认证" />
        <StatCard label="长期有效 API 密钥" :value="snapshot.apiKeys.neverExpires" :tone="snapshot.apiKeys.neverExpires ? 'warning' : 'default'" sub="建议设置有效期" />
      </div>
      <div class="kv security-facts">
        <div class="k">设备访问规则</div><div class="v">{{ snapshot.policy.loadError ? '加载失败，仍执行上次有效规则' : snapshot.policy.configured ? `已配置 · ${snapshot.policy.ruleCount} 条规则` : '未配置 · 网络内设备默认互通' }}</div>
        <div class="k">网络锁</div><div class="v">{{ snapshot.tailnetLock.enabled ? '已启用' : '未启用' }}</div>
        <div class="k">中继配置</div><div class="v">{{ snapshot.derp.mapConfigured ? `已配置 · ${snapshot.derp.regionsServed} 个区域（不代表实时健康状态）` : '未配置' }}</div>
        <div class="k">更新时间</div><div class="v">{{ formatTime(snapshot.generatedAt) }}</div>
      </div>
      <h3 class="findings-heading">安全提示</h3>
      <div v-if="!findings.length" class="alert info">当前检查项未发现需要提示的问题，不代表完整安全审计。</div>
      <div v-for="finding in findings" :key="finding.id" class="finding">
        <div class="finding-head"><span class="badge" :class="finding.tone">{{ finding.label }}</span><strong>{{ finding.title }}</strong></div>
        <p>{{ finding.detail }}</p>
        <RouterLink v-if="finding.route" :to="finding.route">查看相关设置 →</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.session-head { flex-wrap: wrap; gap: 12px; }
.session-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.session-feedback { margin: 16px 18px; }
.session-note { color: var(--text-muted); font-size: 12.5px; line-height: 1.8; }
.session-history summary { padding: 16px 18px; cursor: pointer; font-weight: 600; }
.security-stats { margin-bottom: 20px; }
.security-stats > .card { margin-top: 0; box-shadow: none; }
.security-facts { margin-bottom: 20px; }
.findings-heading { margin-bottom: 12px; }
.finding { padding: 14px 0; border-top: 1px solid var(--border); }
.finding-head { display: flex; align-items: baseline; gap: 8px; }
.finding p { margin: 8px 0; color: var(--text-muted); line-height: 1.8; }
</style>
