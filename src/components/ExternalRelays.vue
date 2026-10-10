<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import * as external from "../api/external-relays";
import type { DERPMap, ExternalRelayConfiguration, ExternalRelayHistory } from "../api/external-relays";
import { errorMessage } from "../api/client";
import { parseRelayMap, mergeRelayMaps } from "../utils/external-relays";
import { emptyResource, refreshResource } from "../utils/resources";
import { canManageNetwork } from "../utils/devices";
import { formatTime } from "../utils/format";
import { session } from "../store";
import DataTable from "./DataTable.vue";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ blockedRegions: number[] }>();
const emit = defineEmits<{ changed: [] }>();
const configuration = reactive(emptyResource<ExternalRelayConfiguration>());
const busy = ref(false), loading = ref(false), editing = ref(false), draft = ref(""), editError = ref(""), importNote = ref("");
const baseline = ref<ExternalRelayConfiguration | null>(null);
const history = ref<ExternalRelayHistory[]>([]), historyOpen = ref(false), historyError = ref("");
const single = reactive({ id: 901, code: "public", name: "我的公共中继", host: "", derp: 443, stun: 3478, cert: "" });
const canWrite = computed(() => canManageNetwork(session.state.user?.role) && Boolean(configuration.data?.csrf_token) && !configuration.error && Boolean(configuration.data?.applied));
const regions = computed(() => Object.values(configuration.data?.map.Regions ?? {}).sort((first, second) => first.RegionID - second.RegionID));
onMounted(load);
async function load() { loading.value = true; await refreshResource(configuration, external.getExternalRelayConfiguration); loading.value = false; }
function edit() {
  if (!canWrite.value || !configuration.data) return;
  baseline.value = configuration.data; draft.value = JSON.stringify(configuration.data.map, null, 2);
  editError.value = ""; importNote.value = ""; editing.value = true;
}
async function importOfficial() {
  if (!baseline.value || busy.value) return;
  busy.value = true; editError.value = "";
  try {
    const result = mergeRelayMaps(parseRelayMap(draft.value), await external.importOfficialRelayMap(baseline.value.csrf_token), props.blockedRegions);
    draft.value = JSON.stringify(result.map, null, 2);
    importNote.value = `官方地图已加入草稿，尚未发布。${result.skipped.length ? `保留现有配置，跳过 ${result.skipped.length} 个重复或受控地区。` : ''}`;
  } catch (err) { editError.value = errorMessage(err); }
  finally { busy.value = false; }
}
function addSingle() {
  try {
    const current = parseRelayMap(draft.value);
    const identifier = Number(single.id);
    if (!Number.isSafeInteger(identifier) || identifier <= 0 || props.blockedRegions.includes(identifier) || current.Regions[String(identifier)]) throw new Error("地区编号需为未占用的正整数，不能覆盖默认或已有地区");
    const map: DERPMap = { Regions: { [String(identifier)]: { RegionID: identifier, RegionCode: single.code.trim(), RegionName: single.name.trim(), Nodes: [{ Name: `external-${identifier}`, RegionID: identifier, HostName: single.host.trim(), DERPPort: Number(single.derp), STUNPort: Number(single.stun), ...(single.cert.trim() ? { CertName: single.cert.trim() } : {}) }] } } };
    draft.value = JSON.stringify(mergeRelayMaps(current, map, props.blockedRegions).map, null, 2); editError.value = "";
  } catch (err) { editError.value = errorMessage(err); }
}
async function publish() {
  if (!baseline.value || busy.value) return;
  busy.value = true; editError.value = "";
  try {
    const map = parseRelayMap(draft.value);
    if (!window.confirm(`确认发布 ${Object.keys(map.Regions).length} 个非托管地区？默认中继保持不变，离线/维护的托管编号仍受保护；可用性由客户端实际连接判断。`)) return;
    configuration.data = await external.saveExternalRelayMap(map, baseline.value.revision, baseline.value.csrf_token);
    editing.value = false; emit("changed"); session.toast("success", "非托管地图已发布，不代表已验证外部中继在线");
  } catch (err) { editError.value = errorMessage(err); }
  finally { busy.value = false; }
}
async function remove(identifier: number) {
  if (!canWrite.value || !configuration.data || busy.value || !window.confirm("删除这个外部地区？仅撤回本网络的地图，不控制外部服务器。")) return;
  busy.value = true;
  try {
    const map = parseRelayMap(JSON.stringify(configuration.data.map)); delete map.Regions[String(identifier)];
    if (map.HomeParams?.RegionScore) delete map.HomeParams.RegionScore[String(identifier)];
    configuration.data = await external.saveExternalRelayMap(map, configuration.data.revision, configuration.data.csrf_token);
    emit("changed"); session.toast("success", "外部地区已从本网络地图移除");
  } catch (err) { session.toast("error", errorMessage(err)); }
  finally { busy.value = false; }
}
async function showHistory() {
  historyOpen.value = true; history.value = []; historyError.value = "";
  try { history.value = await external.getExternalRelayHistory(); }
  catch (err) { historyError.value = errorMessage(err); }
}
async function restore(item: ExternalRelayHistory) {
  if (!canWrite.value || !configuration.data || busy.value || !window.confirm(`恢复地图 v${item.revision} 为新的配置版本？仍会检查与当前默认/托管地区的冲突。`)) return;
  busy.value = true;
  try { configuration.data = await external.restoreExternalRelayMap(item.revision, configuration.data.revision, configuration.data.csrf_token); emit("changed"); await showHistory(); }
  catch (err) { historyError.value = errorMessage(err); }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="card"><div class="card-head"><h2>非托管 / 公共中继</h2><div class="row-actions"><button class="btn small" :disabled="busy || loading" @click="load">刷新配置</button><button class="btn small" @click="showHistory">地图历史</button><button v-if="canWrite" class="btn primary" :disabled="busy || loading" @click="edit">添加或导入公共中继</button></div></div><div class="card-body stack"><p class="muted small-text">可添加官方公共 DERP 或自己的外部节点。它们不消耗托管接入额度，也没有 Xunara 心跳、远程管理或执行回执；是否允许连接仍由外部服务决定。</p><div v-if="configuration.error" class="alert error" role="alert">{{ configuration.error }}</div><div v-if="configuration.data && !configuration.data.applied" class="alert warning">配置已提交但地图尚未确认应用，请刷新后再修改。</div><DataTable v-if="!configuration.error" :columns="[{key:'RegionName',title:'地区'},{key:'Nodes',title:'地址 / 端口'},{key:'actions',title:'操作',align:'right'}]" :rows="regions" :loading="loading" row-key="RegionID" empty-title="尚未添加外部中继" empty-desc="默认中继始终在可用中继中展示；添加外部节点不会替换默认地区。"><template #cell-RegionName="{row}">{{row.RegionName || row.RegionCode}} #{{row.RegionID}}<div class="muted small-text">非托管 · 未进行健康探测</div></template><template #cell-Nodes="{row}"><div v-for="node in row.Nodes" :key="node.Name" class="small-text mono">{{node.HostName}}:{{node.DERPPort || 443}} · STUN {{node.STUNPort === -1 ? '禁用' : node.STUNPort || 3478}}</div></template><template #cell-actions="{row}"><button v-if="canWrite" class="btn small danger" :disabled="busy" @click="remove(row.RegionID)">移除地区</button><span v-else class="muted">只读</span></template></DataTable></div></section>
  <ModalDialog :open="editing" title="编辑非托管中继地图" :busy="busy" @close="editing = false"><div class="stack"><div v-if="editError" class="alert error" role="alert">{{editError}}<button class="btn small" :disabled="busy" @click="editing = false; load()">关闭并刷新基准</button></div><div v-if="importNote" class="alert info">{{importNote}}</div><button class="btn" :disabled="busy" @click="importOfficial">从官方 HTTPS 源导入到草稿</button><details><summary>手动添加一个中继</summary><form class="stack" @submit.prevent="addSingle"><label class="field"><span class="label">地区编号（建议 900～999）</span><input v-model.number="single.id" class="input" aria-label="外部中继地区编号" type="number" min="1" :disabled="busy" /></label><label class="field"><span class="label">地区代码</span><input v-model="single.code" class="input" aria-label="外部中继地区代码" :disabled="busy" /></label><label class="field"><span class="label">地区名称</span><input v-model="single.name" class="input" aria-label="外部中继地区名称" :disabled="busy" /></label><label class="field"><span class="label">主机域名或 IP（不含协议 / 端口）</span><input v-model="single.host" class="input" aria-label="外部中继主机" :disabled="busy" /></label><div class="grid cols-2"><label class="field"><span class="label">DERP TLS 端口</span><input v-model.number="single.derp" class="input" aria-label="外部 DERP 端口" type="number" min="0" max="65535" :disabled="busy" /></label><label class="field"><span class="label">STUN UDP 端口（-1 禁用）</span><input v-model.number="single.stun" class="input" aria-label="外部 STUN 端口" type="number" min="-1" max="65535" :disabled="busy" /></label></div><label class="field"><span class="label">TLS 证书名或 sha256-raw pin（可选）</span><input v-model="single.cert" class="input mono" aria-label="外部中继证书校验" :disabled="busy" /><span class="help">留空按主机名校验证书；自签证书需正确的 pin，不关闭 TLS 校验。</span></label><button class="btn" type="submit" :disabled="busy">加入地图草稿</button></form></details><label class="field"><span class="label">标准 DERPMap JSON · 基准 v{{baseline?.revision}}</span><textarea v-model="draft" class="textarea mono relay-map-editor" aria-label="非托管中继地图 JSON" :disabled="busy" /></label><p class="muted small-text">导入不会自动发布，不覆盖默认节点。可以编辑多节点地区、IP 和 TLS 字段；平台策略仍决定哪些地区实际下发。未知可用性不显示“在线”。</p><button class="btn primary" :disabled="busy" @click="publish">{{busy ? '正在处理…' : '确认发布中继地图'}}</button></div><template #footer><button class="btn" :disabled="busy" @click="editing = false">取消</button></template></ModalDialog>
  <ModalDialog :open="historyOpen" title="非托管地图历史" :busy="busy" @close="historyOpen = false"><div class="stack"><div v-if="historyError" class="alert error">{{historyError}}</div><p v-if="!history.length && !historyError" class="muted">首次发布后保留原始空地图和后续版本，最多显示 50 项。</p><article v-for="item in history" :key="item.revision" class="card card-body"><div class="toolbar"><strong>v{{item.revision}}</strong><span class="muted small-text">{{formatTime(item.created)}} · {{item.actor}}</span><button v-if="canWrite && item.revision !== configuration.data?.revision" class="btn small" :disabled="busy" @click="restore(item)">恢复地图</button></div></article></div><template #footer><button class="btn" :disabled="busy" @click="historyOpen = false">关闭</button></template></ModalDialog>
</template>
<style scoped>.relay-map-editor { min-height: 260px; font-size: 12px; overflow-wrap: anywhere; } summary { cursor: pointer; padding: 10px 0; } details form { padding: 8px 0; }</style>
