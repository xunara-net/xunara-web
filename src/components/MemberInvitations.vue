<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { MemberInvitations, MemberInvitation, MemberInvitationRequest } from "../api/types";
import { session } from "../store";
import { formatTime, roleLabel } from "../utils/format";
import DataTable from "./DataTable.vue";
import ModalDialog from "./ModalDialog.vue";

const emit = defineEmits<{ (event: "changed"): void }>();
const data = ref<MemberInvitations | null>(null);
const loading = ref(true);
const loadError = ref("");
const open = ref(false);
const busy = ref(false);
const formError = ref("");
const code = ref("");
const role = ref<MemberInvitationRequest["role"]>("member");
const note = ref("");
const ttl = ref(168);
const registrationURL = `${window.location.origin}/register`;
const statusLabels = { pending: "待使用", redeemed: "已使用", expired: "已过期" };

onMounted(load);
onUnmounted(() => { code.value = ""; });

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    data.value = await ep.getMemberInvitations();
  } catch (err) {
    data.value = null;
    loadError.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

function begin() {
  if (busy.value || loading.value || !data.value?.enabled) return;
  role.value = "member";
  note.value = "";
  ttl.value = 168;
  formError.value = "";
  code.value = "";
  open.value = true;
}

function close() {
  if (busy.value) return;
  // 明文邀请码只在本次弹窗保留；关闭、离开页面后不能通过列表重新获取。
  code.value = "";
  formError.value = "";
  open.value = false;
}

async function create() {
  if (busy.value || code.value || !data.value?.enabled) return;
  busy.value = true;
  formError.value = "";
  try {
    const result = await ep.createMemberInvitation({ role: role.value, note: note.value.trim(), ttl_hours: ttl.value }, data.value.csrf_token);
    code.value = result.code;
    await load();
    emit("changed");
  } catch (err) {
    formError.value = errorMessage(err);
  } finally {
    busy.value = false;
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(code.value);
    session.toast("success", "邀请码已复制，请通过可信渠道单独发送");
  } catch {
    session.toast("error", "当前浏览器不允许自动复制，请手动选中邀请码复制");
  }
}

async function revoke(invite: MemberInvitation) {
  if (busy.value || !data.value || invite.status === "redeemed") return;
  if (!window.confirm(`撤销「${invite.note || roleLabel(invite.role)}」的邀请码？尚未注册的人将不能再使用它。`)) return;
  busy.value = true;
  try {
    await ep.revokeMemberInvitation(invite.id, data.value.csrf_token);
    session.toast("success", "成员邀请已撤销");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="card" style="margin-top: 20px">
    <div class="card-head">
      <h2>成员邀请</h2>
      <div style="display: flex; gap: 8px; flex-wrap: wrap">
        <button class="btn small" :disabled="loading || busy" @click="load">刷新邀请</button>
        <button class="btn primary small" :disabled="loading || busy || !data?.enabled" @click="begin">创建成员邀请</button>
      </div>
    </div>
    <div class="card-body">
      <div v-if="loadError" class="alert error" role="alert">{{ loadError }}</div>
      <p v-else-if="loading" class="hint">正在读取邀请…</p>
      <template v-else-if="data">
        <p class="hint">邀请他人加入当前网络，不会创建新的网络空间。只有所有者可以管理邀请；邀请码一次有效，注册时再次检查套餐成员额度。</p>
        <p v-if="!data.enabled" class="alert info" style="margin-top: 12px">当前租户未开启邀请码注册。已有邀请记录保留；请联系平台管理员确认注册方式。</p>
      </template>
    </div>
    <DataTable v-if="!loadError && data" :columns="[
      { key: 'note', title: '邀请备注' }, { key: 'role', title: '授予角色' },
      { key: 'expires_at', title: '有效期至' }, { key: 'status', title: '状态' },
      { key: 'actions', title: '操作', align: 'right' },
    ]" :rows="data.items" :loading="loading" row-key="id" empty-title="还没有成员邀请">
      <template #cell-note="{ row }">{{ row.note || '—' }}</template>
      <template #cell-role="{ row }">{{ roleLabel(row.role) }}</template>
      <template #cell-expires_at="{ row }">{{ row.expires_at.startsWith('0001-') ? '无到期时间（旧记录）' : formatTime(row.expires_at) }}</template>
      <template #cell-status="{ row }"><span class="badge">{{ statusLabels[row.status as keyof typeof statusLabels] }}</span></template>
      <template #cell-actions="{ row }"><button v-if="row.status !== 'redeemed'" class="btn danger small" :disabled="busy" @click="revoke(row as unknown as MemberInvitation)">撤销</button><span v-else class="hint">保留记录</span></template>
    </DataTable>
  </div>

  <ModalDialog title="邀请成员加入网络" :open="open" @close="close">
    <div v-if="formError" class="alert error" role="alert">{{ formError }}</div>
    <template v-if="code">
      <div class="alert success" role="status">邀请已创建。邀请码仅展示这一次，关闭后不能找回。</div>
      <div class="field" style="margin-top: 14px"><label for="member-invite-code">一次性邀请码</label><input id="member-invite-code" :value="code" class="input mono" readonly autocomplete="off" /></div>
      <button class="btn" @click="copyCode">复制邀请码</button>
      <div class="field" style="margin-top: 14px"><label for="member-registration-url">注册页面（不含邀请码）</label><input id="member-registration-url" :value="registrationURL" class="input" readonly /></div>
      <p class="hint">请将注册页面与邀请码分别发送给受邀人。不要把代码拼进地址，避免浏览器历史和访问日志泄露。</p>
    </template>
    <form v-else id="member-invite-form" @submit.prevent="create">
      <div class="field"><label for="member-invite-role">授予角色</label><select id="member-invite-role" v-model="role" class="input" :disabled="busy"><option value="member">成员</option><option value="admin">管理员</option></select></div>
      <p class="hint" style="margin-bottom: 14px">管理员可以管理设备和网络配置，但不能管理成员角色或邀请；所有者不能通过邀请码授予。</p>
      <div class="field"><label for="member-invite-note">邀请备注</label><input id="member-invite-note" v-model="note" class="input" maxlength="200" :disabled="busy" placeholder="例如：运维同事（不要填写密码或密钥）" /></div>
      <div class="field"><label for="member-invite-ttl">邀请有效期</label><select id="member-invite-ttl" v-model="ttl" class="input" :disabled="busy"><option :value="1">1 小时</option><option :value="24">24 小时</option><option :value="168">7 天</option><option :value="720">30 天</option></select></div>
    </form>
    <template #footer><button class="btn" :disabled="busy" @click="close">{{ code ? '关闭并清除代码' : '取消' }}</button><button v-if="!code" class="btn primary" form="member-invite-form" :disabled="busy" type="submit">{{ busy ? '创建中…' : '生成一次性邀请码' }}</button></template>
  </ModalDialog>
</template>
