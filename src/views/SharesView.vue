<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { changeDeviceShare, getDeviceShares, type DeviceShare, type DeviceShares } from "../api/device-shares";
import { errorMessage } from "../api/client";
import { formatTime } from "../utils/format";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";

const snapshot = ref<DeviceShares | null>(null), loading = ref(true), error = ref(""), busy = ref(""), blocked = ref(false);
const direction = ref<"incoming" | "outgoing">("incoming");
const route = useRoute();
watch(() => route.query.direction, (value) => { direction.value = value === "outgoing" ? "outgoing" : "incoming"; }, { immediate: true });
const statusNames = { pending: "等待接受", accepted: "已接受", rejected: "已拒绝", revoked: "已撤销" };
const items = computed(() => (snapshot.value?.items ?? []).filter((item) => item.direction === direction.value)
  .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id)));
const pending = computed(() => snapshot.value?.items.filter((item) => item.direction === "incoming" && item.status === "pending").length ?? 0);
let sequence = 0, active = true;
onBeforeUnmount(() => { active = false; sequence++; });
onMounted(load);
async function load() {
  if (busy.value) return;
  const request = ++sequence;
  loading.value = true; error.value = ""; snapshot.value = null;
  try { const result = await getDeviceShares(); if (active && request === sequence) { snapshot.value = result; blocked.value = false; } }
  catch (failure) { if (active && request === sequence) error.value = errorMessage(failure); }
  finally { if (active && request === sequence) loading.value = false; }
}
async function decide(item: DeviceShare, action: "accept" | "reject" | "revoke") {
  if (!snapshot.value || busy.value || loading.value || blocked.value || (action === "revoke" ? !item.can_revoke : !item.can_decide)) return;
  const message = action === "accept" ? `接受「${item.createdBy || '对方'}」分享的「${item.node.hostname || '设备'}」？仅你的设备可以访问它，共享机器不能主动进入你的网络。` : action === "reject" ? "拒绝这份设备分享邀请？" : "撤销这份设备分享？现有访问权限将取消。";
  if (!window.confirm(message)) return;
  busy.value = item.id; error.value = "";
  try {
    const updated = await changeDeviceShare(item.id, action, snapshot.value.csrf_token);
    if (active && snapshot.value) { snapshot.value.items = snapshot.value.items.map((current) => current.id === item.id ? updated : current); session.toast("success", statusNames[updated.status]); }
  } catch (failure) { if (active) { blocked.value = true; error.value = errorMessage(failure); } }
  finally { if (active) busy.value = ""; }
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value); session.toast("success", "已复制共享地址"); }
  catch { session.toast("error", "无法自动复制，请长按地址手动复制"); }
}
</script>

<template>
  <PageHeader title="设备分享" desc="只分享一台设备，不开放整个网络。对方接受后生效，双方均可撤销。">
    <template #actions><router-link class="btn" to="/devices">我的设备</router-link><button class="btn" :disabled="loading || Boolean(busy)" @click="load">刷新分享</button></template>
  </PageHeader>
  <div v-if="error" class="alert error" role="alert">{{ error }}<p v-if="blocked">操作结果尚未确认，请点击「刷新分享」核对后再操作，不会自动重试。</p></div>
  <p v-if="loading" role="status">正在读取设备分享…</p>
  <template v-if="snapshot">
    <div v-if="!snapshot.enabled" class="alert warning">此部署未启用跨网络设备分享，请联系平台管理员。</div>
    <div v-else-if="snapshot.tailnet_locked" class="alert warning">网络启用了 Tailnet Lock，共享访问暂不可用；已有记录仍可撤销。</div>
    <div class="feature-tabs" role="group" aria-label="分享方向"><button class="btn" :class="{ active: direction === 'incoming' }" :aria-pressed="direction === 'incoming'" @click="direction = 'incoming'">分享给我<span v-if="pending">（{{ pending }} 待接受）</span></button><button class="btn" :class="{ active: direction === 'outgoing' }" :aria-pressed="direction === 'outgoing'" @click="direction = 'outgoing'">我分享的</button></div>
    <div v-if="!items.length" class="card"><div class="card-body"><h2>{{ direction === 'incoming' ? '还没有收到设备分享' : '还没有分享设备' }}</h2><p class="muted">{{ direction === 'incoming' ? '让对方在设备列表点击「分享」，输入你的用户名。收到后会在这里确认，不需要更换登录服务器。' : '在「我的设备」列表或设备详情中点击「分享」，输入对方的用户名即可。' }}</p><router-link v-if="direction === 'outgoing' && snapshot.can_manage" class="btn primary" to="/devices">选择要分享的设备</router-link></div></div>
    <div class="share-grid">
      <article v-for="item in items" :key="item.id" class="card share-card" :aria-label="`设备分享 ${item.node.hostname || '设备已不存在'}`">
        <div class="card-head"><h2>{{ item.node.hostname || '设备已不存在' }}</h2><span class="badge" :class="{ primary: item.status === 'accepted' && item.available }">{{ statusNames[item.status] }}</span></div>
        <div class="card-body stack">
          <div class="share-meta"><span>{{ item.direction === 'incoming' ? '分享人' : '接收人' }}</span><strong>{{ (item.direction === 'incoming' ? item.createdBy : item.targetUser) || '原账户已不存在' }}</strong><span>发送时间</span><span>{{ formatTime(item.createdAt) }}</span><template v-if="item.acceptedAt"><span>接受时间</span><span>{{ formatTime(item.acceptedAt) }}</span></template></div>
          <p v-if="item.node.os" class="muted small-text">{{ item.node.os }}</p>
          <p v-if="item.status === 'pending'" class="muted">{{ item.direction === 'incoming' ? '只有你明确接受后，自己的设备才能访问这台设备。' : '等待对方登录用户中心，在「设备分享」接受邀请。' }}</p>
          <div v-if="item.status === 'accepted' && !item.available" class="alert warning">共享设备或账户目前不可用，可能已过期、禁用、删除，或启用了 Tailnet Lock。请联系分享方确认。</div>
          <template v-if="item.direction === 'incoming' && item.status === 'accepted' && item.available">
            <span class="badge" :class="{ ok: item.online }">{{ item.online ? '控制面在线' : '控制面离线' }}</span>
            <div v-if="item.ipv4" class="share-address"><span class="muted">共享 IPv4</span><code>{{ item.ipv4 }}</code><button class="btn small" :aria-label="`复制 ${item.ipv4}`" @click="copy(item.ipv4)">复制</button></div>
            <div v-if="item.ipv6" class="share-address"><span class="muted">共享 IPv6</span><code>{{ item.ipv6 }}</code><button class="btn small" :aria-label="`复制 ${item.ipv6}`" @click="copy(item.ipv6)">复制</button></div>
            <div v-if="item.dns_name" class="share-address"><span class="muted">MagicDNS 名称</span><code>{{ item.dns_name }}</code><button class="btn small" :aria-label="`复制 ${item.dns_name}`" @click="copy(item.dns_name)">复制</button></div>
            <p class="muted small-text">使用已登录你自己网络的 Tailscale 客户端访问共享地址。MagicDNS 名称需开启 DNS；访问仍受 ACL 与设备防火墙限制，在线不等于服务可达。</p>
          </template>
          <div v-if="item.can_decide || item.can_revoke" class="row-actions"><template v-if="item.can_decide"><button class="btn primary" :disabled="Boolean(busy) || blocked" @click="decide(item, 'accept')">接受分享</button><button class="btn" :disabled="Boolean(busy) || blocked" @click="decide(item, 'reject')">拒绝</button></template><button v-if="item.can_revoke" class="btn danger" :disabled="Boolean(busy) || blocked" @click="decide(item, 'revoke')">{{ item.direction === 'incoming' && item.status === 'accepted' ? '移除分享' : '撤销分享' }}</button><span v-if="busy === item.id" role="status">正在处理…</span></div>
        </div>
      </article>
    </div>
  </template>
</template>

<style scoped>
.share-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap: 16px; }
.share-card { min-width: 0; margin: 0; }
.share-card h2 { overflow-wrap: anywhere; }
.share-card .card-body > .badge { justify-self: start; }
.share-meta { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 16px; font-size: 13px; overflow-wrap: anywhere; }
.share-meta > :nth-child(odd) { color: var(--text-muted); }
.share-address { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 13px; }
.share-address > span { flex-basis: 100%; }
.share-address code { flex: 1; min-width: 0; overflow-wrap: anywhere; user-select: all; }
</style>
