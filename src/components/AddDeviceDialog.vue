<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { getOverview } from "../api/endpoints";
import { createEnrollmentKey, getEnrollmentCapabilities, type EnrollmentCapabilities } from "../api/device-enrollment";
import { errorMessage } from "../api/client";
import { session } from "../store";
import { copyText } from "../utils/clipboard";
import { deviceInstallCommand, type DeviceInstallOptions } from "../utils/device-install";
import { clientLoginCommand, canManageNetwork } from "../utils/devices";
import { formatTime } from "../utils/format";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const serverURL = ref(""), error = ref(""), loading = ref(false);
const enrollment = ref<EnrollmentCapabilities | null>(null), enrollmentError = ref(""), generating = ref(false);
const token = ref(""), generatedExpiry = ref(""), ttlSeconds = ref(900);
const copied = ref(false), copyError = ref("");
const options = reactive<DeviceInstallOptions>({ platform: "linux", installClient: true, acceptDNS: true,
  acceptRoutes: false, hostname: "", advertiseSubnets: false, routes: "", advertiseExitNode: false, authMethod: "browser" });
let sequence = 0, active = true;
let copyTimer: ReturnType<typeof setTimeout> | undefined;
function clearToken() { token.value = ""; generatedExpiry.value = ""; }
function resetCopy() { copied.value = false; copyError.value = ""; clearTimeout(copyTimer); }
onBeforeUnmount(() => { active = false; sequence++; clearToken(); resetCopy(); });
const permissions = computed(() => ({ allowSubnetRouter: Boolean(session.state.plan?.allowSubnetRouter),
  allowExitNode: Boolean(session.state.plan?.allowExitNode), maxRoutes: session.state.plan?.maxRoutes ?? 0 }));
const mobilePlatform = computed(() => options.platform === "android" || options.platform === "ios");
const tokenMode = computed(() => options.authMethod === "token" && !mobilePlatform.value);
const useToken = computed({ get: () => tokenMode.value,
  set: (enabled: boolean) => { options.authMethod = enabled ? "token" : "browser"; } });
const keyLimitReached = computed(() => Boolean(enrollment.value && enrollment.value.max_auth_keys >= 0 && enrollment.value.used >= enrollment.value.max_auth_keys));
const canGenerate = computed(() => Boolean(enrollment.value?.can_manage && enrollment.value.csrf_token && canManageNetwork(session.state.user?.role)));
watch(() => options.authMethod, () => { if (!tokenMode.value) clearToken(); });
watch(() => options.platform, (platform) => {
  options.acceptRoutes = platform === "windows" || platform === "macos";
  if (mobilePlatform.value) { options.authMethod = "browser"; clearToken(); }
});
const command = computed(() => {
  if (!serverURL.value || (tokenMode.value && !token.value.trim())) return { text: "", error: "" };
  try { return { text: deviceInstallCommand(serverURL.value, options, permissions.value, token.value.trim()), error: "" }; }
  catch (failure) { return { text: "", error: errorMessage(failure) }; }
});
watch(() => command.value.text, resetCopy);
const downloads: Record<string, string> = {
  windows: "https://tailscale.com/download/windows", macos: "https://tailscale.com/download/mac",
  android: "https://tailscale.com/download/android", ios: "https://tailscale.com/download/ios",
};
watch(() => props.open, (open) => {
  sequence++;
  clearToken(); resetCopy(); enrollment.value = null; enrollmentError.value = ""; generating.value = false; loading.value = false;
  if (open) {
    Object.assign(options, { platform: "linux", installClient: true, acceptDNS: true, acceptRoutes: false,
      hostname: "", advertiseSubnets: false, routes: "", advertiseExitNode: false, authMethod: "browser" });
    ttlSeconds.value = 900;
    load();
  } else { serverURL.value = ""; error.value = ""; }
}, { immediate: true });
async function load() {
  if (generating.value) return;
  const request = ++sequence;
  serverURL.value = ""; error.value = ""; loading.value = true;
  enrollment.value = null; enrollmentError.value = "";
  await Promise.all([
    (async () => {
      try {
        const overview = await getOverview();
        clientLoginCommand(overview.serverUrl, "linux");
        if (active && props.open && request === sequence) serverURL.value = new URL(overview.serverUrl).origin;
      } catch (failure) { if (active && props.open && request === sequence) error.value = errorMessage(failure); }
    })(),
    (async () => {
      try { const result = await getEnrollmentCapabilities(); if (active && props.open && request === sequence) enrollment.value = result; }
      catch (failure) { if (active && props.open && request === sequence) enrollmentError.value = errorMessage(failure); }
    })(),
  ]);
  if (active && request === sequence) loading.value = false;
}
async function generate() {
  if (!canGenerate.value || !enrollment.value || generating.value || loading.value || keyLimitReached.value || token.value) return;
  const request = sequence;
  generating.value = true; enrollmentError.value = "";
  try {
    const result = await createEnrollmentKey(ttlSeconds.value, enrollment.value.csrf_token);
    if (active && props.open && request === sequence && tokenMode.value) {
      token.value = result.key; generatedExpiry.value = result.expiry;
      if (enrollment.value) enrollment.value.used++;
    }
  } catch (failure) { if (active && props.open && request === sequence) enrollmentError.value = errorMessage(failure); }
  finally { if (active && request === sequence) generating.value = false; }
}
async function copy(value: string) {
  if (!value || !active || !props.open || loading.value || generating.value) return;
  const request = sequence;
  resetCopy();
  try {
    await copyText(value);
    if (active && props.open && request === sequence && value === (mobilePlatform.value ? serverURL.value : command.value.text)) {
      copied.value = true;
      copyTimer = setTimeout(() => { copied.value = false; }, 2000);
    }
  } catch (failure) { if (active && props.open && request === sequence) copyError.value = errorMessage(failure); }
}
</script>

<template>
  <ModalDialog :open="open" title="添加设备" :busy="loading || generating" @close="emit('close')">
    <div class="stack">
      <p class="muted">选择平台，在新设备上运行命令即可接入。</p>
      <p v-if="loading" role="status">正在读取接入地址…</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}<button class="btn small" @click="load">重新读取接入地址</button></div>
      <label class="field"><span class="label">设备平台</span><select v-model="options.platform" class="select" aria-label="设备平台" :disabled="generating"><option value="linux">Linux</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="android">Android</option><option value="ios">iPhone / iPad</option></select></label>
      <template v-if="serverURL">
        <template v-if="mobilePlatform">
          <a class="btn" :href="downloads[options.platform]" target="_blank" rel="noopener noreferrer">下载官方客户端</a>
          <p class="muted">在 APP 中选择自定义登录服务器，填入以下地址，再完成浏览器授权。</p>
          <pre class="device-install-command mono">{{ serverURL }}</pre>
          <button class="btn primary" aria-label="复制控制面地址" @click="copy(serverURL)">{{ copied ? '已复制' : '复制控制面地址' }}</button>
        </template>
        <template v-else>
          <a v-if="downloads[options.platform]" :href="downloads[options.platform]" target="_blank" rel="noopener noreferrer">先下载并安装官方客户端</a>
          <label v-if="options.platform === 'linux'" class="checkbox"><input v-model="options.installClient" type="checkbox" />同时安装 / 更新官方客户端</label>
          <label class="checkbox"><input v-model="useToken" type="checkbox" aria-label="使用 Token 免网页登录" :disabled="generating" />使用 Token 免网页登录</label>
          <div v-if="tokenMode" class="stack device-token-options">
            <div class="device-token-row">
              <input v-model="token" class="input mono" type="password" aria-label="设备预授权 Token" autocomplete="off" spellcheck="false" maxlength="266" :disabled="generating" placeholder="粘贴设备 Token，或点击生成" @input="generatedExpiry = ''" />
              <button v-if="canGenerate && !token" class="btn" :disabled="generating || loading || keyLimitReached" @click="generate">{{ generating ? '正在生成…' : '生成一次性 Token' }}</button>
              <button v-if="token" class="btn small" :disabled="generating" @click="clearToken">清除</button>
            </div>
            <p v-if="generatedExpiry" class="muted small-text">一次性 Token 有效至 {{ formatTime(generatedExpiry) }}；已自动填入命令。</p>
            <p v-if="keyLimitReached" class="muted small-text">可用密钥已达额度，请在「API 与密钥」清理不用的记录。</p>
            <p v-if="enrollment && !enrollment.can_manage" class="muted small-text">生成密钥需要网络管理员权限；可以使用管理员提供的设备 Auth Key。</p>
            <div v-if="enrollmentError" class="alert error" role="alert">{{ enrollmentError }}<p>不自动重试生成；可重新打开弹窗读取权限，结果未知时在「API 与密钥」检查。</p></div>
            <p class="muted small-text">仅支持设备 Auth Key。命令含 Token，可能留在终端历史、进程参数和剪贴板，勿分享；建议短期一次性密钥。</p>
          </div>
          <div v-if="command.error" class="alert error" role="alert">{{ command.error }}</div>
          <div class="device-command-box">
            <div class="device-command-toolbar"><strong>{{ options.platform === 'linux' && options.installClient ? '安装并加入' : '加入网络' }}</strong><button class="btn primary small" aria-label="复制命令" :disabled="!command.text || generating" @click="copy(command.text)">{{ copied ? '已复制' : '复制命令' }}</button></div>
            <pre v-if="command.text" class="device-install-command mono" aria-label="设备安装命令">{{ command.text }}</pre>
            <p v-else-if="tokenMode && !token" class="muted small-text">填入或生成 Token 后，复制一次即可安装并加入。</p>
          </div>
          <p v-if="copyError" class="alert error" role="alert">{{ copyError }}</p>
          <p class="muted small-text">{{ tokenMode ? '无需网页登录，仍受设备额度和访问策略约束。' : '运行后打开终端给出的链接，登录并完成设备审批。' }}</p>
          <details class="device-install-options"><summary>高级选项</summary>
            <div class="stack">
              <label class="field"><span class="label">设备名称（可选）</span><input v-model="options.hostname" class="input" aria-label="安装设备名称" maxlength="63" placeholder="例如 home-server" /></label>
              <label class="checkbox"><input v-model="options.acceptDNS" type="checkbox" />接收网络 DNS 配置（MagicDNS）</label>
              <label class="checkbox"><input v-model="options.acceptRoutes" type="checkbox" />接收其他设备发布的子网路由</label>
              <label class="checkbox"><input v-model="options.advertiseSubnets" type="checkbox" :disabled="!permissions.allowSubnetRouter" />将此设备设为子网路由器</label>
              <label v-if="options.advertiseSubnets" class="field"><span class="label">宣告 IPv4 子网</span><input v-model="options.routes" class="input mono" aria-label="安装宣告子网" placeholder="192.168.1.0/24,10.10.0.0/24" maxlength="4096" /></label>
              <label class="checkbox"><input v-model="options.advertiseExitNode" type="checkbox" :disabled="!permissions.allowExitNode" />将此设备设为出口节点</label>
              <label v-if="tokenMode && canGenerate" class="field"><span class="label">新 Token 有效期</span><select v-model="ttlSeconds" class="select" aria-label="接入密钥有效期" :disabled="generating || Boolean(token)"><option :value="900">15 分钟（默认）</option><option :value="3600">1 小时</option><option :value="86400">24 小时</option></select></label>
              <p class="muted small-text">路由 / 出口按套餐开放，宣告不等于批准，设备还需启用 IP 转发。Linux 安装需要 Bash / curl；Windows 请用管理员终端。用于新设备，不重置已有配置，不跳过 TLS 校验。关闭弹窗会清除本页 Token，但未使用的密钥仍有效，可在密钥页撤销。</p>
            </div>
          </details>
        </template>
        <p v-if="mobilePlatform && copyError" class="alert error" role="alert">{{ copyError }}</p>
        <span v-if="copied" class="copy-status" role="status">已复制</span>
      </template>
    </div>
    <template #footer><button class="btn" :disabled="loading || generating" @click="emit('close')">关闭</button></template>
  </ModalDialog>
</template>

<style scoped>
.device-install-command { margin: 0; padding: 12px; border-radius: 8px; background: var(--surface-2); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.7; }
.device-command-box { min-width: 0; }
.device-command-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.device-token-options { gap: 8px; }
.device-token-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.device-token-row .input { flex: 1 1 180px; min-width: 0; }
.device-token-row .btn { white-space: nowrap; }
.device-install-options { border-top: 1px solid var(--border); padding-top: 12px; }
.device-install-options summary { cursor: pointer; }
.device-install-options[open] summary { margin-bottom: 12px; }
.copy-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
