<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import * as ep from "../api/endpoints";
import * as network from "../api/network-control";
import { errorMessage } from "../api/client";
import type { Machine, User } from "../api/types";
import type { PolicyConfiguration, PolicyDocument, PolicyDraft, PolicyExplanation, PolicyHistory, PolicyValidation } from "../api/network-types";
import { canManageNetwork } from "../utils/devices";
import { describePolicyDiff, deviceSelector, removeVisualRule, selectorName, trafficTemplate, visualRules, type VisualRule } from "../utils/policy";
import { formatTime } from "../utils/format";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import ModalDialog from "../components/ModalDialog.vue";
import PolicyRuleEditor from "../components/PolicyRuleEditor.vue";
import PolicyGraph from "../components/PolicyGraph.vue";

type Mode = "rules" | "graph" | "matrix" | "groups" | "advanced" | "history";
const modes: { id: Mode; name: string }[] = [{ id: "rules", name: "访问规则" }, { id: "graph", name: "设备图示" }, { id: "matrix", name: "权限矩阵" }, { id: "groups", name: "设备组 / 成员组" }, { id: "advanced", name: "高级策略" }, { id: "history", name: "历史版本" }];
const mode = ref<Mode>("rules");
const configuration = shallowRef<PolicyConfiguration | null>(null);
const document = shallowRef<PolicyDocument>({});
const rawContent = ref("");
const devices = ref<Machine[]>([]);
const users = ref<User[]>([]);
const deviceError = ref("");
const userError = ref("");
const loading = ref(false);
const error = ref("");
const busy = ref(false);
const ruleOpen = ref(false);
const editing = ref<VisualRule>();
const initialSource = ref("");
const initialDestination = ref("");
const preset = ref("https");
const rules = computed(() => visualRules(document.value));
const canWrite = computed(() => canManageNetwork(session.state.user?.role) && configuration.value?.can_edit === true);
const dirty = computed(() => Boolean(configuration.value && (rawContent.value !== configuration.value.content || JSON.stringify(document.value) !== JSON.stringify(configuration.value.document))));
const query = ref("");
const shownRules = computed(() => rules.value.filter((rule) => [...rule.sources, ...rule.destinations, ...rule.services].map((selector) => selectorName(selector, devices.value)).join(" ").toLowerCase().includes(query.value.toLowerCase())));
const validation = shallowRef<PolicyValidation | null>(null);
const previewOpen = ref(false);
const previewBody = shallowRef<PolicyDraft | null>(null);
const previewError = ref("");
const history = ref<PolicyHistory[]>([]);
const historyError = ref("");
const historyLoading = ref(false);
const template = ref("isolate");

onMounted(load);
onBeforeRouteLeave(() => !dirty.value || window.confirm("有尚未发布的权限草稿，确定离开并丢弃吗？"));

async function load() {
  if (loading.value) return;
  if (dirty.value && !window.confirm("刷新会丢弃未发布的草稿，继续吗？")) return;
  loading.value = true;
  error.value = "";
  await Promise.all([
    network.getPolicyConfiguration().then((value) => { configuration.value = value; document.value = value.document; rawContent.value = value.content; }).catch((err) => { error.value = errorMessage(err); configuration.value = null; }),
    ep.listMachines().then((value) => { devices.value = value; deviceError.value = ""; }).catch((err) => { devices.value = []; deviceError.value = errorMessage(err); }),
    ep.listUsers().then((value) => { users.value = value; userError.value = ""; }).catch((err) => { users.value = []; userError.value = errorMessage(err); }),
  ]);
  loading.value = false;
}
function draft(content = rawContent.value): PolicyDraft {
  if (!configuration.value) throw new Error("权限配置尚未读取成功");
  return { revision: configuration.value.revision, base_hash: configuration.value.base_hash, content };
}
function setDocument(value: PolicyDocument) {
  document.value = value;
  rawContent.value = JSON.stringify(value, null, 2);
  validation.value = null;
  matrixItems.value = [];
  probeResult.value = null;
}
async function changeMode(next: Mode) {
  if (busy.value || next === mode.value) return;
  if (mode.value === "advanced" && rawContent.value !== configuration.value?.content) {
    busy.value = true;
    try {
      const result = await network.validatePolicy(draft());
      document.value = result.document;
    } catch (err) {
      session.toast("error", `${errorMessage(err)}；请先修正高级策略，避免转换时丢失字段。`);
      return;
    } finally { busy.value = false; }
  }
  mode.value = next;
  if (next === "history") await loadHistory();
  if (next === "matrix") await runMatrix();
}
function newRule(source = "", destination = "", service = "https") {
  editing.value = undefined;
  initialSource.value = source;
  initialDestination.value = destination;
  preset.value = service;
  ruleOpen.value = true;
}
function editRule(rule: VisualRule) {
  if (!rule.editable) { session.toast("info", "此规则包含应用能力或特殊字段，请用高级模式编辑。"); return; }
  editing.value = rule;
  ruleOpen.value = true;
}
function removeRule(rule: VisualRule) {
  if (window.confirm("从草稿移除此允许规则？只有发布后才会改变实际权限。其他匹配规则仍可能允许访问。")) setDocument(removeVisualRule(document.value, rule));
}
function useTemplate() {
  if (!canWrite.value || !configuration.value) return;
  if (!window.confirm("模板会替换草稿中的网络访问规则，其他 SSH、测试及设备能力配置保留。预览并发布后才生效，继续吗？")) return;
  setDocument(trafficTemplate(document.value, template.value as "isolate" | "all" | "ssh" | "web", configuration.value!.can_grants));
}
async function preview(restore?: number) {
  if (!configuration.value || busy.value) return;
  busy.value = true;
  previewError.value = "";
  const body = restore === undefined ? draft() : { revision: configuration.value.revision, base_hash: configuration.value.base_hash, restore_from: restore };
  try {
    validation.value = await network.validatePolicy(body);
    previewBody.value = body;
    previewOpen.value = true;
  } catch (err) { session.toast("error", errorMessage(err)); }
  finally { busy.value = false; }
}
async function publish() {
  if (!configuration.value || !previewBody.value || !validation.value?.publishable || busy.value || !canWrite.value) return;
  busy.value = true;
  previewError.value = "";
  try {
    const result = await network.publishPolicy(previewBody.value, configuration.value.csrf_token);
    const content = previewBody.value.content ?? history.value.find((item) => item.revision === previewBody.value?.restore_from)?.content;
    if (content === undefined) throw new Error("策略已提交，请刷新读取最终版本");
    configuration.value = { ...configuration.value, ...result, source: "database", content, document: validation.value.document };
    document.value = validation.value.document;
    rawContent.value = content;
    previewOpen.value = false;
    session.toast("success", `权限已发布为版本 ${result.revision}`);
    if (mode.value === "history") await loadHistory();
  } catch (err) { previewError.value = errorMessage(err); }
  finally { busy.value = false; }
}
async function loadHistory() {
  historyLoading.value = true;
  historyError.value = "";
  try { history.value = await network.listPolicyHistory(); }
  catch (err) { history.value = []; historyError.value = errorMessage(err); }
  finally { historyLoading.value = false; }
}

const groupOpen = ref(false);
const group = reactive({ kind: "tag", name: "", members: "" });
const groupError = ref("");
function editGroup(kind: string, name = "", members: string[] = []) {
  group.kind = kind; group.name = name.replace(/^(tag|group):/, ""); group.members = members.join(", "); groupError.value = ""; groupOpen.value = true;
}
function saveGroup() {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(group.name) || !group.members.trim()) { groupError.value = "名称需为字母、数字或 - / _，并至少指定一个成员 / 标签所有者。"; return; }
  const value = structuredClone(document.value);
  const target = group.kind === "tag" ? (value.tagOwners ??= {}) : (value.groups ??= {});
  target[`${group.kind === "tag" ? "tag" : "group"}:${group.name}`] = [...new Set(group.members.split(/[\s,，]+/).filter(Boolean))];
  setDocument(value);
  groupOpen.value = false;
}
function removeGroup(kind: string, name: string) {
  if (!window.confirm("移除该组定义？仍引用它的规则将无法通过发布校验，请同时调整访问规则。")) return;
  const value = structuredClone(document.value);
  delete (kind === "tag" ? value.tagOwners : value.groups)?.[name];
  setDocument(value);
}

const probeOpen = ref(false);
const probe = reactive({ source: "", destination: "", protocol: "tcp" as "tcp" | "udp", port: 443, draft: true });
const probeResult = shallowRef<PolicyExplanation | null>(null);
const probeError = ref("");
const probeBusy = ref(false);
const activeDevices = computed(() => devices.value.filter((device) => !device.expired));
watch(() => [probe.source, probe.destination, probe.protocol, probe.port, probe.draft, rawContent.value], () => { probeResult.value = null; });
function openProbe(source?: number, destination?: number) {
  probe.source = source ? String(source) : ""; probe.destination = destination ? String(destination) : "";
  probeResult.value = null; probeError.value = ""; probeOpen.value = true;
  if (source && destination) { probe.protocol = matrixProtocol.value; probe.port = matrixPort.value; probe.draft = true; void runProbe(); }
}
async function runProbe() {
  if (probeBusy.value) return;
  probeBusy.value = true; probeError.value = ""; probeResult.value = null;
  const body = probeBody();
  try {
    const result = await network.simulatePolicy(body);
    if (JSON.stringify(body) === JSON.stringify(probeBody())) probeResult.value = result;
  } catch (err) { if (JSON.stringify(body) === JSON.stringify(probeBody())) probeError.value = errorMessage(err); }
  finally { probeBusy.value = false; }
}

function probeBody() {
  return { source: Number(probe.source), destination: Number(probe.destination), protocol: probe.protocol, port: Number(probe.port), ...(probe.draft && dirty.value ? { content: rawContent.value } : {}) };
}
function ruleFromProbe() {
  const source = devices.value.find((device) => device.id === Number(probe.source));
  const destination = devices.value.find((device) => device.id === Number(probe.destination));
  if (!source || !destination || !deviceSelector(source) || !deviceSelector(destination)) {
    session.toast("error", "设备已变化，请刷新后重新选择");
    return;
  }
  probeOpen.value = false;
  newRule(deviceSelector(source), deviceSelector(destination));
}

const matrixSearch = ref("");
const matrixSourcePage = ref(0);
const matrixDestinationPage = ref(0);
const matrixProtocol = ref<"tcp" | "udp">("tcp");
const matrixPort = ref(443);
const matrixBusy = ref(false);
const matrixError = ref("");
const matrixItems = ref<{ source: number; destination: number; allowed: boolean }[]>([]);
const matrixDevices = computed(() => activeDevices.value.filter((device) => `${device.hostname} ${device.ipv4} ${device.userLoginName} ${(device.tags ?? []).join(' ')}`.toLowerCase().includes(matrixSearch.value.toLowerCase())));
const matrixPages = computed(() => Math.max(1, Math.ceil(matrixDevices.value.length / 8)));
const matrixSources = computed(() => matrixDevices.value.slice(matrixSourcePage.value * 8, (matrixSourcePage.value + 1) * 8));
const matrixDestinations = computed(() => matrixDevices.value.slice(matrixDestinationPage.value * 8, (matrixDestinationPage.value + 1) * 8));
const matrixValues = computed(() => new Map(matrixItems.value.map((item) => [`${item.source}:${item.destination}`, item.allowed])));
watch(() => [matrixSearch.value, matrixProtocol.value, matrixPort.value, rawContent.value], () => { matrixSourcePage.value = 0; matrixDestinationPage.value = 0; matrixItems.value = []; });
async function runMatrix() {
  if (matrixBusy.value || !matrixSources.value.length || !matrixDestinations.value.length) return;
  matrixBusy.value = true; matrixError.value = ""; matrixItems.value = [];
  const body = matrixBody();
  try {
    const result = await network.policyMatrix(body);
    if (JSON.stringify(body) === JSON.stringify(matrixBody())) matrixItems.value = result.items;
  } catch (err) { if (JSON.stringify(body) === JSON.stringify(matrixBody())) matrixError.value = errorMessage(err); }
  finally { matrixBusy.value = false; }
}
function matrixBody() {
  return { sources: matrixSources.value.map((device) => device.id), destinations: matrixDestinations.value.map((device) => device.id), protocol: matrixProtocol.value, port: Number(matrixPort.value), ...(dirty.value ? { content: rawContent.value } : {}) };
}
async function matrixNavigate(side: "source" | "destination", direction: number) {
  if (side === "source") matrixSourcePage.value += direction; else matrixDestinationPage.value += direction;
  await runMatrix();
}

function labels(selectors: string[]): string { return selectors.map((selector) => selectorName(selector, devices.value)).join("、"); }
</script>

<template>
  <PageHeader title="访问权限" desc="选择谁可以访问谁。图形化与高级策略共用同一个编译器，修改需预览并确认发布。">
    <template #actions><button class="btn" :disabled="loading || busy" @click="load">刷新</button><button class="btn" :disabled="!configuration || Boolean(deviceError)" @click="openProbe()">测试权限</button><button v-if="canWrite" class="btn primary" :disabled="busy || !dirty" @click="preview()">{{ busy ? '处理中…' : '预览并发布' }}</button></template>
  </PageHeader>
  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>
  <div v-if="loading" class="page-loading"><div class="spinner" /></div>
  <template v-else-if="configuration">
    <div class="toolbar small-text"><span class="badge" :class="dirty ? 'warning' : 'success'">{{ dirty ? '未发布草稿' : `生效版本 ${configuration.revision}` }}</span><span class="muted">{{ configuration.source === 'default' ? '兼容默认配置' : configuration.source === 'file' ? '部署文件（首次发布后由控制台管理）' : '控制台托管' }}</span><span v-if="!canWrite" class="badge">只读 · 需网络管理员及套餐授权</span></div>
    <nav class="feature-tabs" aria-label="权限功能"><button v-for="item in modes" :key="item.id" class="btn" :class="{ active: mode === item.id }" :aria-current="mode === item.id ? 'page' : undefined" :disabled="busy" @click="changeMode(item.id)">{{ item.name }}</button></nav>
    <div v-if="configuration.source === 'default'" class="alert warning" style="margin-bottom: 16px">此网络沿用旧默认配置：设备完全互通。增加窄范围规则不会覆盖现有允许；需要收紧权限时先选择「设备隔离」模板，再添加必要规则并预览发布。</div>
    <div v-if="deviceError" class="alert error" style="margin-bottom: 16px">设备读取失败：{{ deviceError }} <button class="btn small" @click="load">重试</button></div>
    <div v-if="userError" class="alert error" style="margin-bottom: 16px">成员读取失败：{{ userError }}；设备规则仍可编辑。</div>

    <section v-if="mode === 'rules'" class="card">
      <div class="card-head"><h2>谁可以访问谁</h2><button v-if="canWrite" class="btn primary" @click="newRule()">添加访问规则</button></div>
      <div class="card-body">
        <div class="toolbar"><input v-model="query" class="input" aria-label="搜索访问规则" placeholder="搜索设备、成员、组或端口" /><template v-if="canWrite"><select v-model="template" class="select" aria-label="权限模板"><option value="isolate">设备隔离 · 默认拒绝</option><option value="ssh">仅 SSH</option><option value="web">仅浏览 Web</option><option value="all">完全互通 · 谨慎</option></select><button class="btn" @click="useTemplate">应用模板到草稿</button></template></div>
        <div class="rule-list"><article v-for="rule in shownRules" :key="`${rule.section}:${rule.index}`" class="rule-item"><div><div class="rule-flow"><span>{{ labels(rule.sources) }}</span><span class="muted">→</span><span>{{ labels(rule.destinations) }}</span></div><div class="small-text muted" style="margin-top: 8px">允许 {{ rule.services.join('、') }} <span class="badge">{{ rule.section === 'grants' ? 'Grants' : 'ACL' }} #{{ rule.index + 1 }}</span></div></div><div v-if="canWrite" class="row-actions"><button class="btn small" :disabled="!rule.editable" @click="editRule(rule)">编辑</button><button class="btn small danger" @click="removeRule(rule)">移除</button></div></article></div>
        <div v-if="!shownRules.length" class="empty"><div class="title">{{ rules.length ? '没有匹配的规则' : '没有网络允许规则，默认拒绝' }}</div><div class="desc">允许规则是叠加关系，没有“拒绝覆盖允许”。用测试权限查看实际结果。</div></div>
      </div>
    </section>

    <section v-else-if="mode === 'graph'" class="card"><div class="card-head"><h2>设备 → 服务 → 设备</h2></div><div class="card-body"><PolicyGraph :devices="devices" :rules="rules" :readonly="!canWrite" @connect="(source, destination) => newRule(source, destination)" @edit="editRule" /></div></section>

    <section v-else-if="mode === 'matrix'" class="card">
      <div class="card-head"><h2>指定服务的权限矩阵</h2><span class="hint">{{ dirty ? '当前草稿' : '生效策略' }} · 不是连通性检测</span></div>
      <div class="card-body">
        <div class="toolbar">
          <input v-model="matrixSearch" class="input" aria-label="搜索矩阵设备" placeholder="按设备、成员或标签筛选" />
          <select v-model="matrixProtocol" class="select" aria-label="矩阵协议"><option value="tcp">TCP</option><option value="udp">UDP</option></select>
          <input v-model.number="matrixPort" class="input" style="max-width: 110px" type="number" min="1" max="65535" aria-label="矩阵端口" />
          <button class="btn primary" :disabled="matrixBusy || !matrixSources.length" @click="runMatrix">{{ matrixBusy ? '计算中…' : '检查权限' }}</button>
        </div>
        <div v-if="matrixError" class="alert error">{{ matrixError }}</div>
        <div class="matrix-scroll">
          <table v-if="matrixSources.length" class="table permission-matrix">
            <thead><tr><th>来源 ↓ / 目标 →</th><th v-for="device in matrixDestinations" :key="device.id">{{ device.hostname }}</th></tr></thead>
            <tbody><tr v-for="source in matrixSources" :key="source.id"><th>{{ source.hostname }}</th>
              <td v-for="destination in matrixDestinations" :key="destination.id">
                <span v-if="source.id === destination.id" class="muted">—</span>
                <button v-else class="matrix-cell" :class="{ allowed: matrixValues.get(`${source.id}:${destination.id}`) === true, denied: matrixValues.get(`${source.id}:${destination.id}`) === false }" :aria-label="`${source.hostname} 到 ${destination.hostname} 查看权限原因`" :disabled="!matrixValues.has(`${source.id}:${destination.id}`)" @click="openProbe(source.id, destination.id)">{{ matrixValues.has(`${source.id}:${destination.id}`) ? matrixValues.get(`${source.id}:${destination.id}`) ? '允许' : '拒绝' : '未检查' }}</button>
              </td>
            </tr></tbody>
          </table>
        </div>
        <div v-if="!matrixSources.length" class="empty"><div class="title">没有匹配的未过期设备</div></div>
        <div class="stack" style="margin-top: 16px">
          <div class="toolbar"><span>来源页 {{ matrixSourcePage + 1 }} / {{ matrixPages }}</span><button class="btn" :disabled="matrixSourcePage <= 0 || matrixBusy" @click="matrixNavigate('source', -1)">上一组来源</button><button class="btn" :disabled="matrixSourcePage + 1 >= matrixPages || matrixBusy" @click="matrixNavigate('source', 1)">下一组来源</button></div>
          <div class="toolbar"><span>目标页 {{ matrixDestinationPage + 1 }} / {{ matrixPages }}</span><button class="btn" :disabled="matrixDestinationPage <= 0 || matrixBusy" @click="matrixNavigate('destination', -1)">上一组目标</button><button class="btn" :disabled="matrixDestinationPage + 1 >= matrixPages || matrixBusy" @click="matrixNavigate('destination', 1)">下一组目标</button></div>
          <p class="small-text muted">来源与目标可分别翻页，每次最多检查 8 × 8 台设备，点击结果查看匹配规则。</p>
        </div>
      </div>
    </section>

    <section v-else-if="mode === 'groups'" class="card"><div class="card-head"><h2>设备组与成员组</h2><div v-if="canWrite" class="row-actions"><button class="btn" @click="editGroup('tag')">添加设备组</button><button class="btn" @click="editGroup('group')">添加成员组</button></div></div><div class="card-body stack">
      <div class="alert info">设备组使用官方标签（tag），成员组使用 group。设备需用已授权的标签注册；创建组不会把设备悄悄改为可信机器。请先发布标签所有者，再用带标签的授权密钥或客户端申请标签。</div>
      <article v-for="(owners, name) in document.tagOwners" :key="name" class="rule-item"><div><strong>设备组 · {{ String(name).replace('tag:', '') }}</strong><p class="muted small-text" style="margin-top: 8px">标签所有者：{{ owners.join('、') }}</p><p class="muted small-text">已上报成员：{{ devices.filter((device) => device.tags?.includes(String(name))).map((device) => device.hostname).join('、') || '暂无' }}</p></div><div v-if="canWrite" class="row-actions"><button class="btn small" @click="editGroup('tag', String(name), owners)">编辑</button><button class="btn small danger" @click="removeGroup('tag', String(name))">移除</button></div></article>
      <article v-for="(members, name) in document.groups" :key="name" class="rule-item"><div><strong>成员组 · {{ String(name).replace('group:', '') }}</strong><p class="muted small-text" style="margin-top: 8px">{{ members.join('、') }}</p></div><div v-if="canWrite" class="row-actions"><button class="btn small" @click="editGroup('group', String(name), members)">编辑</button><button class="btn small danger" @click="removeGroup('group', String(name))">移除</button></div></article>
      <div v-if="!Object.keys(document.tagOwners ?? {}).length && !Object.keys(document.groups ?? {}).length" class="empty"><div class="title">还没有组定义</div></div>
    </div></section>

    <section v-else-if="mode === 'advanced'" class="card"><div class="card-head"><h2>高级 HuJSON / ACL / Grants</h2><span class="hint">可视化修改会规范化格式，规则和其他支持字段保留</span></div><div class="card-body stack"><textarea v-model="rawContent" class="textarea editor-area" aria-label="高级权限策略" spellcheck="false" :readonly="!canWrite" /><div class="alert info">未知字段、重复键、无效规则或测试失败均不能发布。删除最后一条网络允许规则表示默认拒绝，不是恢复完全互通。</div><button class="btn" :disabled="busy" @click="preview()">校验并查看变更</button></div></section>

    <section v-else-if="mode === 'history'" class="card"><div class="card-head"><h2>已发布版本</h2><button class="btn" :disabled="historyLoading" @click="loadHistory">刷新历史</button></div><div class="card-body"><div v-if="historyError" class="alert error">{{ historyError }}</div><div v-else-if="historyLoading" class="page-loading"><div class="spinner" /></div><div v-else class="rule-list"><article v-for="item in history" :key="item.revision" class="rule-item"><div><strong>{{ item.revision === 0 ? '首次发布前的原配置' : `版本 ${item.revision}` }}</strong><p class="muted small-text" style="margin-top: 8px">{{ formatTime(item.created) }} · {{ item.actor }}</p></div><button v-if="canWrite" class="btn" :disabled="busy || item.revision === configuration.revision" @click="preview(item.revision)">预览恢复此版</button></article><div v-if="!history.length" class="empty"><div class="title">尚无控制台发布记录</div><div class="desc">首次发布会保存原配置为版本 0；恢复历史会生成新版本，不覆盖历史。</div></div></div></div></section>
  </template>

  <PolicyRuleEditor :open="ruleOpen" :document="document" :devices="devices" :users="users" :grants="configuration?.can_grants === true" :editing="editing" :source="initialSource" :destination="initialDestination" :preset="preset" @close="ruleOpen = false" @save="setDocument" />

  <ModalDialog :open="previewOpen" title="预览并确认权限变更" :busy="busy" @close="previewOpen = false"><div v-if="validation" class="stack"><div v-if="previewError" class="alert error">{{ previewError }}</div><div class="alert" :class="validation.publishable ? 'success' : 'error'">{{ validation.publishable ? `校验通过 · ${validation.rule_count} 条网络访问规则` : '未通过发布条件，原有权限保持不变' }}</div><div v-if="validation.entitlement_error" class="alert warning">套餐限制：{{ validation.entitlement_error }}</div><div v-for="warning in validation.warnings" :key="warning" class="alert warning">{{ warning }}</div><div v-if="validation.tests.total"><h3>策略自检</h3><p v-if="!validation.tests.ran" class="muted small-text">暂未执行：{{ validation.tests.reason }}</p><div v-for="result in validation.tests.results" :key="result.index" class="alert" :class="result.pass ? 'success' : 'error'">测试 {{ result.index + 1 }}：{{ result.pass ? '通过' : result.failures.join('；') }}</div></div><h3>新增 {{ validation.diff.added.length }} / 移除 {{ validation.diff.removed.length }}</h3><details v-for="row in validation.diff.added" :key="row" class="diff-row added"><summary>+ {{ describePolicyDiff(row, devices) }}</summary><p class="mono">{{ row }}</p></details><details v-for="row in validation.diff.removed" :key="row" class="diff-row removed"><summary>− {{ describePolicyDiff(row, devices) }}</summary><p class="mono">{{ row }}</p></details><p v-if="!validation.diff.sections.length" class="muted">无语义变更。</p><p class="muted small-text">在线客户端将通过正常控制面更新接收规则。权限允许不代表服务已启动、路由可达或防火墙放行；无法凭此推算活跃连接数。</p></div><template #footer><button class="btn" :disabled="busy" @click="previewOpen = false">取消</button><button v-if="canWrite" class="btn primary" :disabled="busy || !validation?.publishable" @click="publish">{{ busy ? '正在发布…' : '确认发布' }}</button></template></ModalDialog>

  <ModalDialog :open="groupOpen" :title="group.kind === 'tag' ? '设备组（标签）' : '成员组'" @close="groupOpen = false"><form class="stack" @submit.prevent="saveGroup"><div v-if="groupError" class="alert error">{{ groupError }}</div><label class="field"><span class="label">组名称</span><input v-model="group.name" class="input" aria-label="组名称" placeholder="home 或 office" /></label><label class="field"><span class="label">{{ group.kind === 'tag' ? '可申请此标签的成员 / 组' : '成员登录名 / 标签 / 其他组' }}</span><input v-model="group.members" class="input" aria-label="组成员或所有者" list="policy-members" placeholder="alice, group:office" /></label><datalist id="policy-members"><option v-for="user in users" :key="user.id" :value="user.loginName">{{ user.displayName }}</option></datalist><button class="btn primary" type="submit">加入草稿</button></form><template #footer><button class="btn" @click="groupOpen = false">取消</button></template></ModalDialog>

  <ModalDialog :open="probeOpen" title="权限测试与原因" :busy="probeBusy" @close="probeOpen = false">
    <form class="stack" @submit.prevent="runProbe">
      <label class="field"><span class="label">来源设备</span><select v-model="probe.source" class="select" aria-label="测试来源设备"><option value="">请选择</option><option v-for="device in activeDevices" :key="device.id" :value="String(device.id)">{{ device.hostname }} · {{ deviceSelector(device) }}</option></select></label>
      <label class="field"><span class="label">目标设备</span><select v-model="probe.destination" class="select" aria-label="测试目标设备"><option value="">请选择</option><option v-for="device in activeDevices" :key="device.id" :value="String(device.id)">{{ device.hostname }} · {{ deviceSelector(device) }}</option></select></label>
      <div class="grid cols-2">
        <label class="field"><span class="label">协议</span><select v-model="probe.protocol" class="select" aria-label="测试协议"><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
        <label class="field"><span class="label">端口</span><input v-model.number="probe.port" class="input" type="number" min="1" max="65535" aria-label="测试端口" /></label>
      </div>
      <label v-if="dirty" class="checkbox"><input v-model="probe.draft" type="checkbox" />使用未发布草稿（取消勾选则检查生效策略）</label>
      <button class="btn primary" type="submit" :disabled="probeBusy || !probe.source || !probe.destination">{{ probeBusy ? '计算中…' : '检查权限' }}</button>
      <div v-if="probeError" class="alert error">{{ probeError }}</div>
      <div v-if="probeResult" class="alert" :class="probeResult.allowed ? 'success' : 'warning'">
        <strong>{{ probeResult.allowed ? '允许访问' : '拒绝访问' }}</strong> · {{ probeResult.draft ? '草稿' : '生效策略' }}
        <p class="small-text" style="margin-top: 8px">{{ probeResult.allowed ? '匹配目标设备实际编译的允许规则：' : '没有匹配的网络允许规则，默认拒绝。' }}</p>
        <p v-for="match in probeResult.matches" :key="`${match.section}:${match.index}`" class="small-text">{{ match.section }} #{{ match.index + 1 }}：{{ labels(match.sources) }} → {{ labels(match.destinations) }}</p>
      </div>
      <p class="muted small-text">这是策略模拟，不向设备发包；设备离线、服务关闭、系统防火墙和路由仍会影响实际连接。</p>
    </form>
    <template #footer><button class="btn" :disabled="probeBusy" @click="probeOpen = false">关闭</button><button v-if="canWrite && probe.source && probe.destination" class="btn" :disabled="probeBusy" @click="ruleFromProbe">为这两台设备创建规则</button></template>
  </ModalDialog>
</template>

<style scoped>
.matrix-scroll { overflow-x: auto; max-width: 100%; }
.permission-matrix th { max-width: 130px; white-space: normal; min-width: 80px; }
.permission-matrix td { padding: 8px; text-align: center; }
.matrix-cell { border: 0; background: var(--surface-2); border-radius: 6px; padding: 9px; color: var(--text-muted); cursor: pointer; font: inherit; min-width: 58px; }
.matrix-cell.allowed { color: var(--success); background: var(--success-soft); }
.matrix-cell.denied { color: var(--danger); background: var(--danger-soft); }
</style>
