<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import * as ep from "../api/endpoints";
import { ApiError, errorMessage } from "../api/client";
import type { AccountSession, AccountSessions, SecuritySnapshot } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import StatCard from "../components/StatCard.vue";
import AccountPasskeys from "../components/AccountPasskeys.vue";
import AccountIdentities from "../components/AccountIdentities.vue";
import AccountLoginHistory from "../components/AccountLoginHistory.vue";
import { formatTime, relativeTime } from "../utils/format";
import { authMethodLabel, sessionClientLabel, securityFindingText, severityLabel, splitAccountSessions } from "../utils/security";

const router = useRouter();
const loading = ref(true);
const error = ref("");
const accountSessions = ref<AccountSessions | null>(null);
const busy = ref("");
const historyRefresh = ref(0);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
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
  if (!disposed && err instanceof ApiError && err.status === 401) {
    session.forget();
    await router.replace({ name: "login", query: { return_to: "/security" } });
  }
}

async function loadSessions() {
  // 读取失败独立显示错误；不能向用户宣称“没有活动登录”。
  loading.value = true;
  error.value = "";
  try {
    const payload = await ep.getAccountSessions();
    if (disposed) return;
    accountSessions.value = payload;
    historyRefresh.value++;
  } catch (err) {
    if (disposed) return;
    accountSessions.value = null;
    error.value = errorMessage(err);
    await handleExpiredSession(err);
  } finally {
    if (!disposed) loading.value = false;
  }
}

async function loadSecurity() {
  securityLoading.value = true;
  securityError.value = "";
  try {
    const payload = await ep.getSecurity();
    if (disposed) return;
    snapshot.value = payload;
  } catch (err) {
    if (disposed) return;
    snapshot.value = null;
    securityError.value = errorMessage(err);
    await handleExpiredSession(err);
  } finally {
    if (!disposed) securityLoading.value = false;
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
    <div v-if="loading" class="page-loading" role="status">正在读取活动登录…</div>
    <div v-else-if="accountSessions" class="card-body session-list">
      <p v-if="!grouped.active.length" class="session-note">没有活动登录，请刷新列表或重新登录。</p>
      <article v-for="row in grouped.active" :key="row.id" class="session-card">
        <div class="session-card-head">
          <div><strong>{{ sessionClientLabel(row.userAgent) }}</strong> <span v-if="row.id === accountSessions.currentSessionId" class="badge success">当前浏览器</span></div>
          <button class="btn small danger" :disabled="disabled" @click="revoke(row)">{{ busy === row.id ? '正在退出…' : row.id === accountSessions.currentSessionId ? '退出当前登录' : '退出此登录' }}</button>
        </div>
        <div class="session-note">{{ authMethodLabel(row.authMethod) }} · <span class="mono">{{ row.clientIP || '来源 IP 未记录' }}</span></div>
        <dl class="session-facts">
          <div><dt>登录时间</dt><dd>{{ formatTime(row.createdAt) }}</dd></div>
          <div><dt>最近活动</dt><dd :title="formatTime(row.lastSeenAt)">{{ row.lastSeenAt ? relativeTime(row.lastSeenAt) : '未记录' }}</dd></div>
          <div><dt>到期时间</dt><dd>{{ formatTime(row.expiresAt) }}</dd></div>
        </dl>
      </article>
    </div>
    <div class="card-body session-note">这里只管理本账户的控制台登录，不影响组网设备和其他用户。浏览器 / 系统为客户端自报，来源 IP 不代表地理位置；旧来源未记录时不会补猜。最近活动按分钟更新，不延长有效期。怀疑密码泄露时，还应<RouterLink to="/settings">修改密码</RouterLink>。</div>
  </div>

  <AccountLoginHistory :refresh-key="historyRefresh" />
  <AccountIdentities />
  <AccountPasskeys />

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
.session-list { padding-top: 0; padding-bottom: 0; }
.session-card { padding: 16px 0; border-top: 1px solid var(--border); min-width: 0; }
.session-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.session-card .session-note { margin-top: 8px; overflow-wrap: anywhere; }
.session-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 14px 0 0; }
.session-facts dt { color: var(--text-muted); font-size: 12px; }
.session-facts dd { margin: 4px 0 0; font-size: 13px; overflow-wrap: anywhere; }
.security-stats { margin-bottom: 20px; }
.security-stats > .card { margin-top: 0; box-shadow: none; }
.security-facts { margin-bottom: 20px; }
.findings-heading { margin-bottom: 12px; }
.finding { padding: 14px 0; border-top: 1px solid var(--border); }
.finding-head { display: flex; align-items: baseline; gap: 8px; }
.finding p { margin: 8px 0; color: var(--text-muted); line-height: 1.8; }
@media (max-width: 640px) {
  .session-facts { grid-template-columns: 1fr; gap: 8px; }
  .session-facts > div { display: flex; justify-content: space-between; gap: 12px; }
  .session-facts dd { margin: 0; text-align: right; }
}
</style>
