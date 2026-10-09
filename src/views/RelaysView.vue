<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import * as ep from "../api/endpoints";
import * as network from "../api/network-control";
import { errorMessage } from "../api/client";
import type { DERPInfo, ManagedRelay } from "../api/types";
import type { RelayEnrollment, RelayPool } from "../api/network-types";
import { session } from "../store";
import { canManageNetwork } from "../utils/devices";
import { copyText } from "../utils/clipboard";
import { emptyResource, refreshResource } from "../utils/resources";
import { enrollmentStatus, relayInstallCommand, relayStatus } from "../utils/relays";
import { formatTime } from "../utils/format";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import ModalDialog from "../components/ModalDialog.vue";

const tab = ref("managed");
const pool = reactive(emptyResource<RelayPool>());
const derp = reactive(emptyResource<DERPInfo>());
const tokens = reactive(emptyResource<RelayEnrollment[]>());
const loading = ref(false);
const busy = ref(false);
const canWrite = computed(() => canManageNetwork(session.state.user?.role) && Boolean(pool.data?.csrf_token));
const canCreate = computed(() => canWrite.value && pool.data !== null && (pool.data.limit < 0 || pool.data.used < pool.data.limit));
const createOpen = ref(false);
const name = ref("");
const ttl = ref(24);
const secret = ref("");
let active = true;
const createError = ref("");
const editing = ref<ManagedRelay | null>(null);
const editError = ref("");
const draft = reactive({ desired_state: "online", bandwidth_limit: 0, region_name: "" });
const command = computed(() => {
  try { return pool.data ? relayInstallCommand(pool.data.control_url) : ""; }
  catch { return ""; }
});

onMounted(load);
onBeforeUnmount(() => { active = false; secret.value = ""; });
watch(createOpen, (open) => { if (!open) secret.value = ""; });

async function load() {
  if (loading.value) return;
  loading.value = true;
  await Promise.all([refreshResource(pool, network.getRelayPool), refreshResource(derp, ep.getDERP), refreshResource(tokens, network.listRelayEnrollments)]);
  loading.value = false;
}
function openCreate() { name.value = ""; ttl.value = 24; secret.value = ""; createError.value = ""; createOpen.value = true; }
async function createToken() {
  if (!pool.data || busy.value || !canCreate.value) return;
  busy.value = true; createError.value = "";
  try {
    const result = await network.createRelayEnrollment(name.value, Number(ttl.value) * 3600, pool.data.csrf_token);
    if (!active || !createOpen.value) return;
    secret.value = result.token;
    await refreshResource(tokens, network.listRelayEnrollments);
  } catch (err) { createError.value = errorMessage(err); }
  finally { busy.value = false; }
}
async function copy(value: string) {
  try { await copyText(value); session.toast("success", "已复制，请妥善保管"); }
  catch (err) { session.toast("error", errorMessage(err)); }
}
async function revoke(token: RelayEnrollment) {
  if (!pool.data || !canWrite.value || busy.value || !window.confirm("撤销此接入令牌？未接入的中继将不能使用它注册，已接入的中继不受影响。")) return;
  busy.value = true;
  try { await network.revokeRelayEnrollment(token.id, pool.data.csrf_token); session.toast("success", "接入令牌已撤销"); await refreshResource(tokens, network.listRelayEnrollments); }
  catch (err) { session.toast("error", errorMessage(err)); }
  finally { busy.value = false; }
}
function edit(relay: ManagedRelay) {
  editing.value = relay;
  Object.assign(draft, { desired_state: relay.desiredState, bandwidth_limit: relay.bandwidthLimit, region_name: relay.regionName ?? "" });
  editError.value = "";
}
async function saveRelay() {
  if (!editing.value || !pool.data || !canWrite.value || busy.value) return;
  if (draft.desired_state === "revoked" && !window.confirm("撤销后中继将停止服务，请确认不会影响仍依赖此节点的设备。")) return;
  busy.value = true; editError.value = "";
  try {
    await network.updateManagedRelay(editing.value.id, { ...draft }, pool.data.csrf_token);
    editing.value = null;
    session.toast("success", "配置已保存，中继将在下一次心跳读取；停用节点会退出下发地图");
    await load();
  } catch (err) { editError.value = errorMessage(err); }
  finally { busy.value = false; }
}
async function remove(relay: ManagedRelay) {
  if (!pool.data || !canWrite.value || busy.value || !window.confirm(`删除「${relay.name}」及其服务凭证？节点将从地图移除，重新接入需签发新令牌。`)) return;
  busy.value = true;
  try { await network.deleteManagedRelay(relay.id, pool.data.csrf_token); session.toast("success", "中继已删除"); await load(); }
  catch (err) { session.toast("error", errorMessage(err)); }
  finally { busy.value = false; }
}
</script>

<template>
  <PageHeader title="我的中继" desc="管理本网络的私有中继。下发地图、节点心跳与客户端真实连接是不同的状态。">
    <template #actions><button class="btn" :disabled="loading || busy" @click="load">刷新</button><button v-if="canWrite" class="btn primary" :disabled="!canCreate || busy" @click="openCreate">接入私有中继</button></template>
  </PageHeader>
  <div v-if="pool.error" class="alert error" role="alert">托管中继读取失败：{{ pool.error }}</div>
  <div v-if="pool.data" class="toolbar small-text"><span class="badge">已接入 {{ pool.data.used }} / {{ pool.data.limit < 0 ? '不限' : pool.data.limit }}</span><span v-if="!canWrite" class="muted">只读 · 需网络管理员</span><router-link v-if="!canCreate && canWrite" to="/plan">查看套餐额度</router-link></div>
  <nav class="feature-tabs" aria-label="中继功能"><button v-for="item in [{ id: 'managed', name: '私有中继' }, { id: 'map', name: '下发地图' }, { id: 'tokens', name: '接入令牌' }, { id: 'guide', name: '接入指南' }]" :key="item.id" class="btn" :class="{ active: tab === item.id }" :aria-current="tab === item.id ? 'page' : undefined" @click="tab = item.id">{{ item.name }}</button></nav>

  <section v-if="tab === 'managed'" class="card">
    <div class="card-head"><h2>本网络的托管中继</h2></div>
    <DataTable v-if="!pool.error" :columns="[{ key: 'name', title: '节点' }, { key: 'regionName', title: '地区' }, { key: 'online', title: '上报状态' }, { key: 'lastSeen', title: '最近心跳' }, { key: 'actions', title: '操作', align: 'right' }]" :rows="pool.data?.items ?? []" :loading="loading || pool.data === null" row-key="id" empty-title="还没有私有中继" empty-desc="公共或静态中继在下发地图中查看。自建中继需一次性令牌与可达的 TLS 端口。">
      <template #cell-name="{ row }"><strong>{{ row.name }}</strong><div class="muted small-text mono">{{ row.hostname }}</div></template>
      <template #cell-regionName="{ row }">{{ row.regionName || row.regionCode || '—' }}<div class="muted small-text">{{ row.regionId ? `区域 ${row.regionId}` : '旧版本 · 未提供地图信息' }}</div></template>
      <template #cell-online="{ row }"><span class="badge">{{ relayStatus(row) }}</span><div class="muted small-text">{{ row.healthy ? '健康上报正常' : '未确认健康' }}</div></template>
      <template #cell-lastSeen="{ row }">{{ formatTime(row.lastSeen) }}</template>
      <template #cell-actions="{ row }"><div v-if="canWrite" class="row-actions"><button class="btn small" :disabled="busy" @click="edit(row)">管理</button><button class="btn small danger" :disabled="busy" @click="remove(row)">删除</button></div><span v-else class="muted">只读</span></template>
    </DataTable>
  </section>

  <section v-else-if="tab === 'map'" class="card"><div class="card-head"><h2>客户端实际下发地图</h2></div><div class="card-body stack"><div v-if="derp.error" class="alert error">{{ derp.error }}</div><template v-else-if="derp.data"><div class="alert info">{{ !derp.data.mapConfigured ? '未设置自定义地图，客户端可能使用内置地图。' : `当前下发 ${derp.data.regionsServed} 个中继地区。` }} 心跳在线不等于客户端正在使用该节点；地图不显示虚构的延迟或连接质量。</div><DataTable :columns="[{ key: 'name', title: '地区' }, { key: 'hosts', title: '中继地址' }, { key: 'nodeCount', title: '设备 Home DERP' }]" :rows="derp.data.regions" row-key="id" empty-title="当前未下发中继地区"><template #cell-name="{ row }">{{ row.name || row.code }} #{{ row.id }}</template><template #cell-hosts="{ row }"><span class="mono">{{ row.hosts.join('、') }}</span></template></DataTable></template><div v-else class="page-loading"><div class="spinner" /></div></div></section>

  <section v-else-if="tab === 'tokens'" class="card"><div class="card-head"><h2>一次性接入令牌</h2></div><div v-if="tokens.error" class="alert error">{{ tokens.error }}</div><DataTable v-else :columns="[{ key: 'name', title: '名称' }, { key: 'used', title: '状态' }, { key: 'expiresAt', title: '有效期至' }, { key: 'actions', title: '操作', align: 'right' }]" :rows="tokens.data ?? []" :loading="loading || tokens.data === null" row-key="id" empty-title="暂无接入令牌"><template #cell-name="{ row }">{{ row.name || '未命名令牌' }}</template><template #cell-used="{ row }"><span class="badge">{{ enrollmentStatus(row) }}</span></template><template #cell-expiresAt="{ row }">{{ formatTime(row.expiresAt) }}</template><template #cell-actions="{ row }"><button v-if="canWrite && !row.used" class="btn small danger" :disabled="busy" @click="revoke(row)">撤销</button><span v-else class="muted">—</span></template></DataTable></section>

  <section v-else class="card"><div class="card-head"><h2>接入自己的中继服务器</h2></div><div class="card-body stack"><p>1. 创建一次性接入令牌并保存。2. 安装 xunara-relay。3. 将命令中的 YOUR_RELAY_IP 换成服务器公网 IP，选择不与地图冲突的区域编号，并开放 TCP 443 与 UDP 3478。</p><p class="muted small-text">以下为 Bash 示例；令牌通过隐藏输入读取，不写入命令参数或历史。IP 调试使用自签证书和自动提交的 SHA-256 pin，不关闭 TLS 校验。正式部署可使用域名与受信任证书。</p><pre v-if="command" class="relay-command mono">{{ command }}</pre><button v-if="command" class="btn" @click="copy(command)">复制接入命令（不含令牌）</button><div v-else class="alert warning">请先成功读取中继配置，确认租户控制面地址。</div><p>中继注册后需上报健康心跳才加入本租户地图。旧版本缺少地区 / 证书信息的记录不猜测下发，需升级后重新接入。公共中继发布仅由平台管理员管理。</p></div></section>

  <ModalDialog :open="createOpen" title="接入私有中继" :busy="busy" @close="createOpen = false"><div class="stack"><div v-if="createError" class="alert error">{{ createError }}</div><template v-if="secret"><div class="alert warning">令牌只显示这一次，关闭或离开页面后清除。不要发送到聊天、日志或截图中；未使用的令牌可在列表中撤销。</div><textarea class="textarea mono" aria-label="一次性中继接入令牌" readonly :value="secret" /><button class="btn primary" @click="copy(secret)">复制令牌</button></template><form v-else class="stack" @submit.prevent="createToken"><label class="field"><span class="label">名称</span><input v-model="name" class="input" aria-label="中继令牌名称" placeholder="家中服务器 / 上海节点" maxlength="128" /></label><label class="field"><span class="label">有效期</span><select v-model.number="ttl" class="select" aria-label="令牌有效期"><option :value="1">1 小时</option><option :value="24">24 小时</option><option :value="168">7 天</option></select></label><button class="btn primary" type="submit" :disabled="busy">{{ busy ? '正在创建…' : '创建一次性令牌' }}</button></form></div><template #footer><button class="btn" :disabled="busy" @click="createOpen = false">{{ secret ? '已保存，关闭' : '取消' }}</button></template></ModalDialog>
  <ModalDialog :open="editing !== null" title="管理中继" :busy="busy" @close="editing = null"><form class="stack" @submit.prevent="saveRelay"><div v-if="editError" class="alert error">{{ editError }}</div><label class="field"><span class="label">期望状态</span><select v-model="draft.desired_state" class="select" aria-label="中继期望状态"><option value="online">启用</option><option value="maintenance">维护</option><option value="disabled">停用</option><option value="revoked">撤销</option></select></label><label class="field"><span class="label">地区名称</span><input v-model="draft.region_name" class="input" aria-label="中继地区名称" maxlength="128" /></label><label class="field"><span class="label">每连接带宽上限（字节 / 秒）</span><input v-model.number="draft.bandwidth_limit" class="input" aria-label="中继带宽上限" type="number" min="-1" step="1" /><span class="help">0 保持节点本地设置；-1 取消限速；正整数设为每连接字节速率。不是套餐用量计费。</span></label><p v-if="editing?.certName" class="muted small-text mono">TLS 校验：{{ editing.certName }}</p><button class="btn primary" :disabled="busy" type="submit">{{ busy ? '正在保存…' : '保存配置' }}</button></form><template #footer><button class="btn" :disabled="busy" @click="editing = null">取消</button></template></ModalDialog>
</template>

<style scoped>
.relay-command { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface-2); padding: 16px; border-radius: 8px; font-size: 12px; line-height: 1.8; }
</style>
