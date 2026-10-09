<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import * as network from "../api/network-control";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { AddressRecord, DNSConfiguration, DNSSettings } from "../api/network-types";
import type { Machine } from "../api/types";
import { canManageNetwork } from "../utils/devices";
import { addressRecordProtected } from "../utils/policy";
import { buildDNSSettings, fullRecordName } from "../utils/dns";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import ModalDialog from "../components/ModalDialog.vue";
import DataTable from "../components/DataTable.vue";

type Mode = "records" | "magic" | "servers" | "search" | "split" | "hostnames";
const mode = ref<Mode>("records");
const modes: { id: Mode; name: string }[] = [{ id: "records", name: "自定义记录" }, { id: "magic", name: "MagicDNS" }, { id: "servers", name: "解析器" }, { id: "search", name: "搜索域" }, { id: "split", name: "分流 DNS" }, { id: "hostnames", name: "设备名称" }];
const configuration = shallowRef<DNSConfiguration | null>(null);
const records = ref<AddressRecord[]>([]);
const devices = ref<Machine[]>([]);
const loading = ref(false);
const configError = ref("");
const recordError = ref("");
const deviceError = ref("");
const settingDraft = reactive({ magic: false, nameservers: "", search: "", split: [] as { domain: string; servers: string }[] });
const roleCanWrite = computed(() => canManageNetwork(session.state.user?.role));
const canWrite = computed(() => roleCanWrite.value && configuration.value?.can_edit === true);
const dirty = computed(() => {
  if (!configuration.value) return false;
  try { return JSON.stringify(settings()) !== JSON.stringify(configuration.value.settings); }
  catch { return true; }
});
const busy = ref(false);
const query = ref("");
const shownRecords = computed(() => records.value.filter((record) => `${record.name} ${record.type} ${record.value}`.toLowerCase().includes(query.value.toLowerCase())));
const recordOpen = ref(false);
const recordDraft = reactive({ id: 0, revision: 0, name: "", type: "A" as "A" | "AAAA", value: "" });
const recordWriteError = ref("");
const previewOpen = ref(false);
const preview = shallowRef<DNSSettings | null>(null);
const writeError = ref("");

onMounted(load);
onBeforeRouteLeave(() => !dirty.value || window.confirm("有尚未保存的 DNS 设置，确定离开并丢弃吗？"));
function settings(): DNSSettings { return buildDNSSettings(settingDraft.magic, settingDraft.nameservers, settingDraft.search, settingDraft.split); }
function apply(configurationValue: DNSConfiguration) {
  configuration.value = configurationValue;
  settingDraft.magic = configurationValue.settings.magic_dns;
  settingDraft.nameservers = configurationValue.settings.nameservers.join("\n");
  settingDraft.search = configurationValue.settings.search_domains.join("\n");
  settingDraft.split = Object.entries(configurationValue.settings.split_dns).map(([domain, servers]) => ({ domain, servers: servers.join(", ") }));
}
async function load() {
  if (loading.value || dirty.value && !window.confirm("刷新会丢弃未保存的 DNS 设置，继续吗？")) return;
  loading.value = true;
  await Promise.all([
    network.getDNSConfiguration().then((value) => { apply(value); configError.value = ""; }).catch((err) => { configuration.value = null; configError.value = errorMessage(err); }),
    loadRecords(),
    ep.listMachines().then((value) => { devices.value = value; deviceError.value = ""; }).catch((err) => { devices.value = []; deviceError.value = errorMessage(err); }),
  ]);
  loading.value = false;
}
async function loadRecords() {
  recordError.value = "";
  try { records.value = await network.listAddressRecords(); }
  catch (err) { records.value = []; recordError.value = errorMessage(err); }
}
function editRecord(record?: AddressRecord) {
  if (!canWrite.value || record && addressRecordProtected(record)) return;
  Object.assign(recordDraft, record ? { id: record.id, revision: record.revision, name: record.name, type: record.type, value: record.value } : { id: 0, revision: 0, name: "", type: "A", value: "" });
  recordWriteError.value = "";
  recordOpen.value = true;
}
async function saveRecord() {
  if (busy.value || !canWrite.value || !configuration.value) return;
  busy.value = true; recordWriteError.value = "";
  try {
    await network.saveAddressRecord({ name: fullRecordName(recordDraft.name, configuration.value.domain), type: recordDraft.type, value: recordDraft.value.trim(), ...(recordDraft.id ? { revision: recordDraft.revision } : {}) }, configuration.value.csrf_token, recordDraft.id || undefined);
    recordOpen.value = false;
    session.toast("success", "DNS 地址记录已保存并通知客户端");
    await loadRecords();
  } catch (err) { recordWriteError.value = errorMessage(err); }
  finally { busy.value = false; }
}
async function removeRecord(record: AddressRecord) {
  if (busy.value || !roleCanWrite.value || !configuration.value || addressRecordProtected(record) || !window.confirm(`删除 ${record.name} 的 ${record.type} 记录？不会删除设备。`)) return;
  busy.value = true;
  try {
    await network.deleteAddressRecord(record, configuration.value.csrf_token);
    session.toast("success", "DNS 记录已删除");
    await loadRecords();
  } catch (err) { session.toast("error", errorMessage(err)); }
  finally { busy.value = false; }
}
function previewSettings() {
  try { preview.value = settings(); writeError.value = ""; previewOpen.value = true; }
  catch (err) { session.toast("error", errorMessage(err)); }
}
async function saveSettings() {
  if (busy.value || !canWrite.value || !configuration.value || !preview.value) return;
  busy.value = true; writeError.value = "";
  try {
    const result = await network.saveDNSConfiguration({ revision: configuration.value.revision, base_hash: configuration.value.base_hash, settings: preview.value }, configuration.value.csrf_token);
    apply({ ...configuration.value, ...result });
    previewOpen.value = false;
    session.toast("success", `DNS 设置已保存为版本 ${result.revision}，无需重启客户端`);
  } catch (err) { writeError.value = errorMessage(err); }
  finally { busy.value = false; }
}
</script>

<template>
  <PageHeader title="DNS" desc="设备名称、自定义地址和解析规则。每个功能独立展示，不再堆叠成长页面。">
    <template #actions><button class="btn" :disabled="loading || busy" @click="load">刷新</button><button v-if="mode === 'records' && canWrite" class="btn primary" :disabled="busy || !configuration?.domain" @click="editRecord()">添加 DNS 记录</button><button v-if="canWrite && !['records', 'hostnames'].includes(mode)" class="btn primary" :disabled="!dirty || busy" @click="previewSettings">预览并保存设置</button></template>
  </PageHeader>
  <nav class="feature-tabs" aria-label="DNS 功能"><button v-for="item in modes" :key="item.id" class="btn" :class="{ active: mode === item.id }" :aria-current="mode === item.id ? 'page' : undefined" @click="mode = item.id">{{ item.name }}</button></nav>
  <div v-if="configError" class="alert error" style="margin-bottom: 16px">{{ configError }}</div>
  <div v-if="configuration && !canWrite" class="alert info" style="margin-bottom: 16px">{{ !roleCanWrite ? '当前成员只能查看 DNS，修改请联系网络管理员。' : '当前套餐不包含自定义 DNS，既有记录可查看或清理。' }}</div>
  <div v-if="loading" class="page-loading"><div class="spinner" /></div>
  <template v-else>
    <section v-if="mode === 'records'" class="card"><div class="card-head"><h2>自定义地址记录</h2><span class="hint">A / AAAA · 官方客户端实际支持的地址记录</span></div><div class="card-body"><div class="toolbar"><input v-model="query" class="input" aria-label="搜索 DNS 记录" placeholder="搜索记录名、类型或地址" /><span class="muted small-text">网络域名：{{ configuration?.domain || '管理员未配置' }}</span></div><div v-if="recordError" class="alert error">{{ recordError }} <button class="btn small" @click="loadRecords">重试</button></div><DataTable v-else :rows="shownRecords" :columns="[{ key: 'name', title: '名称' }, { key: 'type', title: '类型' }, { key: 'value', title: '地址 / 值' }, { key: 'actions', title: '管理', align: 'right' }]" empty-title="没有匹配的 DNS 记录" empty-desc="设备自动名称在「设备名称」中查看，不会重复存为自定义记录。"><template #cell-name="{ row }"><span class="mono wrap-anywhere">{{ row.name }}</span></template><template #cell-value="{ row }"><span class="mono wrap-anywhere">{{ addressRecordProtected(row) && !['A', 'AAAA'].includes(row.type) ? '由客户端 / 证书流程管理' : row.value }}</span></template><template #cell-actions="{ row }"><span v-if="addressRecordProtected(row)" class="badge">系统管理</span><div v-else-if="roleCanWrite && configuration" class="row-actions"><button v-if="canWrite" class="btn small" :disabled="busy" @click="editRecord(row)">编辑</button><button class="btn small danger" :disabled="busy" @click="removeRecord(row)">删除</button></div><span v-else class="muted small-text">只读</span></template></DataTable></div></section>

    <section v-else-if="mode === 'magic' && configuration" class="card"><div class="card-head"><h2>用名称访问设备</h2><span class="badge" :class="configuration.settings.magic_dns ? 'success' : 'warning'">{{ configuration.settings.magic_dns ? '已启用' : '未启用' }}</span></div><div class="card-body stack"><p class="muted small-text">例如使用 <code>nas.{{ configuration.domain || '网络域名' }}</code> 代替设备 IP。客户端仍需接受网络 DNS（accept-dns）。</p><label class="checkbox"><input v-model="settingDraft.magic" type="checkbox" :disabled="!canWrite || !configuration.domain || busy" />启用 MagicDNS 自动设备名称</label><div class="kv"><div class="k">网络域名</div><div class="v mono">{{ configuration.domain || '尚未配置' }}</div><div class="k">域名管理</div><div class="v">由部署管理员配置，不能在此隐式改变设备名或证书域名。</div></div><div v-if="!configuration.domain" class="alert warning">当前部署没有网络域名，不能启用设备名称或创建自定义记录。</div><div v-if="dirty" class="alert warning">有未保存设置，点击页首「预览并保存设置」后生效。</div></div></section>

    <section v-else-if="mode === 'servers' && configuration" class="card"><div class="card-head"><h2>DNS 解析器</h2></div><div class="card-body stack"><label class="field"><span class="label">全局解析器（每行一个）</span><textarea v-model="settingDraft.nameservers" class="textarea" rows="5" aria-label="DNS 解析器" :readonly="!canWrite || busy" placeholder="223.5.5.5&#10;119.29.29.29&#10;100.100.1.10:53" /></label><p class="muted small-text">支持 IPv4、IPv6 或 IP:端口，最多 8 个。这里填写的是客户端将使用的服务器，不由控制面代查；内网解析器仍需可达和 ACL 放行。</p><div class="alert info">留空表示不配置全局解析器，客户端保留相应本地解析路径；分流 DNS 和 MagicDNS 另行处理。暂不提供未经实现的 DoH / DoT 地址输入。</div></div></section>

    <section v-else-if="mode === 'search' && configuration" class="card"><div class="card-head"><h2>搜索域</h2></div><div class="card-body stack"><label class="field"><span class="label">附加搜索域（每行一个）</span><textarea v-model="settingDraft.search" class="textarea" rows="5" aria-label="DNS 搜索域" :readonly="!canWrite || busy" placeholder="home.example.com&#10;office.example.com" /></label><p class="muted small-text">输入短名称时，系统会尝试附加这些域名。最多 16 个，按输入顺序下发；MagicDNS 启用时网络域名自动优先加入，不需重复填写。</p></div></section>

    <section v-else-if="mode === 'split' && configuration" class="card"><div class="card-head"><h2>仅对指定域名使用特定解析器</h2><button v-if="canWrite" class="btn" :disabled="busy || settingDraft.split.length >= 32" @click="settingDraft.split.push({ domain: '', servers: '' })">添加分流规则</button></div><div class="card-body stack"><div v-for="(row, index) in settingDraft.split" :key="index" class="split-row"><label class="field"><span class="label">域名</span><input v-model="row.domain" class="input" :aria-label="`分流域名 ${index + 1}`" :readonly="!canWrite || busy" placeholder="office.example.com" /></label><label class="field"><span class="label">解析器</span><input v-model="row.servers" class="input" :aria-label="`分流解析器 ${index + 1}`" :readonly="!canWrite || busy" placeholder="10.0.0.53, 10.0.0.54" /></label><button v-if="canWrite" class="btn danger" :disabled="busy" @click="settingDraft.split.splice(index, 1)">移除</button></div><div v-if="!settingDraft.split.length" class="empty"><div class="title">暂无分流 DNS</div><div class="desc">例如公司域名交给公司 DNS，其他域名仍使用全局或本地解析器。</div></div><p class="muted small-text">最多 32 个域名，每项最多 8 个解析器；不能覆盖系统管理的网络域名。配置分流不等于批准路由或授予访问权限。</p></div></section>

    <section v-else-if="mode === 'hostnames'" class="card"><div class="card-head"><h2>设备自动名称</h2></div><div class="card-body"><div v-if="deviceError" class="alert error">{{ deviceError }}</div><div v-else class="rule-list"><article v-for="device in devices" :key="device.id" class="rule-item"><div><router-link :to="`/devices/${device.id}`">{{ device.hostname }}</router-link><p class="mono muted wrap-anywhere" style="margin-top: 6px">{{ device.dnsName || '该设备未配置 DNS 名称' }}</p><p class="small-text muted">{{ [device.ipv4, device.ipv6].filter(Boolean).join(' · ') }}</p></div><span class="badge">自动生成</span></article><div v-if="!devices.length" class="empty"><div class="title">还没有设备</div></div></div></div></section>
  </template>

  <ModalDialog :open="recordOpen" :title="recordDraft.id ? '编辑 DNS 地址记录' : '添加 DNS 地址记录'" :busy="busy" @close="recordOpen = false"><form class="stack" @submit.prevent="saveRecord"><div v-if="recordWriteError" class="alert error">{{ recordWriteError }}</div><label class="field"><span class="label">名称</span><input v-model="recordDraft.name" class="input" aria-label="记录名称" placeholder="nas 或完整域名" required :disabled="busy" /></label><p class="small-text muted">名称必须在 <code>{{ configuration?.domain }}</code> 下，短名称会自动补全。设备或服务已占用名称不能覆盖。</p><label class="field"><span class="label">类型</span><select v-model="recordDraft.type" class="select" aria-label="记录类型" :disabled="busy"><option value="A">A · IPv4 地址</option><option value="AAAA">AAAA · IPv6 地址</option></select></label><label class="field"><span class="label">地址</span><input v-model="recordDraft.value" class="input" aria-label="记录地址" placeholder="100.100.1.10" required :disabled="busy" /></label><button class="btn primary" :disabled="busy" type="submit">{{ busy ? '保存中…' : '保存记录' }}</button></form><template #footer><button class="btn" :disabled="busy" @click="recordOpen = false">取消</button></template></ModalDialog>
  <ModalDialog :open="previewOpen" title="确认 DNS 设置变更" :busy="busy" @close="previewOpen = false"><div v-if="preview && configuration" class="stack"><div v-if="writeError" class="alert error">{{ writeError }}</div><div class="kv"><div class="k">MagicDNS</div><div class="v">{{ configuration.settings.magic_dns ? '启用' : '关闭' }} → {{ preview.magic_dns ? '启用' : '关闭' }}</div><div class="k">全局解析器</div><div class="v mono">{{ configuration.settings.nameservers.join(', ') || '无' }} → {{ preview.nameservers.join(', ') || '无' }}</div><div class="k">搜索域</div><div class="v">{{ configuration.settings.search_domains.join(', ') || '无' }} → {{ preview.search_domains.join(', ') || '无' }}</div><div class="k">分流域名</div><div class="v">{{ Object.keys(configuration.settings.split_dns).join(', ') || '无' }} → {{ Object.keys(preview.split_dns).join(', ') || '无' }}</div></div><div v-for="(servers, domain) in preview.split_dns" :key="domain" class="diff-row mono">{{ domain }} → {{ servers.join(', ') }}</div><p class="muted small-text">完整配置通过合法性和版本检查后一次性保存，下发给本网络客户端。版本冲突或写入失败不会部分生效。</p></div><template #footer><button class="btn" :disabled="busy" @click="previewOpen = false">取消</button><button class="btn primary" :disabled="busy || !canWrite" @click="saveSettings">{{ busy ? '保存中…' : '确认保存' }}</button></template></ModalDialog>
</template>
<style scoped>
.split-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto; gap: 10px; align-items: end; }
@media (max-width: 650px) { .split-row { grid-template-columns: 1fr; padding-bottom: 16px; border-bottom: 1px solid var(--border); } }
</style>
