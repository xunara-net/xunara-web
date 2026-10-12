<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { getOverview } from "../api/endpoints";
import { createEnrollmentKey, getEnrollmentCapabilities, type EnrollmentCapabilities } from "../api/device-enrollment";
import { errorMessage } from "../api/client";
import { session } from "../store";
import { copyText } from "../utils/clipboard";
import { deviceInstallCommand, privateDeviceInstallScript, validDeviceAuthKey, type DeviceInstallOptions } from "../utils/device-install";
import { clientLoginCommand, canManageNetwork } from "../utils/devices";
import { formatTime } from "../utils/format";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const serverURL = ref(""), error = ref(""), loading = ref(false);
const enrollment = ref<EnrollmentCapabilities | null>(null), enrollmentError = ref(""), generating = ref(false);
const token = ref(""), generatedExpiry = ref(""), ttlSeconds = ref(900), privateAcknowledged = ref(false);
const options = reactive<DeviceInstallOptions>({ platform: "linux", installClient: true, acceptDNS: true,
  acceptRoutes: false, hostname: "", advertiseSubnets: false, routes: "", advertiseExitNode: false, authMethod: "browser" });
let sequence = 0, active = true;
const downloadURLs = new Set<string>();
function clearToken() { token.value = ""; generatedExpiry.value = ""; privateAcknowledged.value = false; }
function clearDownloads() { for (const url of downloadURLs) URL.revokeObjectURL(url); downloadURLs.clear(); }
onBeforeUnmount(() => { active = false; sequence++; clearToken(); clearDownloads(); });
const permissions = computed(() => ({ allowSubnetRouter: Boolean(session.state.plan?.allowSubnetRouter),
  allowExitNode: Boolean(session.state.plan?.allowExitNode), maxRoutes: session.state.plan?.maxRoutes ?? 0 }));
const mobilePlatform = computed(() => options.platform === "android" || options.platform === "ios");
const tokenMode = computed(() => options.authMethod === "token" && !mobilePlatform.value);
const tokenValid = computed(() => validDeviceAuthKey(token.value.trim()));
const keyLimitReached = computed(() => Boolean(enrollment.value && enrollment.value.max_auth_keys >= 0 && enrollment.value.used >= enrollment.value.max_auth_keys));
const canGenerate = computed(() => Boolean(enrollment.value?.can_manage && enrollment.value.csrf_token && canManageNetwork(session.state.user?.role)));
watch(() => options.authMethod, () => { if (!tokenMode.value) clearToken(); });
watch(mobilePlatform, (mobile) => { if (mobile) { options.authMethod = "browser"; clearToken(); } });
const command = computed(() => {
  if (!serverURL.value) return { text: "", error: "" };
  try { return { text: deviceInstallCommand(serverURL.value, options, permissions.value), error: "" }; }
  catch (failure) { return { text: "", error: errorMessage(failure) }; }
});
const downloads: Record<string, string> = {
  windows: "https://tailscale.com/download/windows", macos: "https://tailscale.com/download/mac",
  android: "https://tailscale.com/download/android", ios: "https://tailscale.com/download/ios",
};
watch(() => props.open, (open) => {
  sequence++;
  clearToken(); clearDownloads(); enrollment.value = null; enrollmentError.value = "";
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
async function copyToken() {
  if (!tokenValid.value) return;
  try { await copyText(token.value.trim()); session.toast("info", "设备 Token 已复制，请勿转发；使用后清理剪贴板"); }
  catch (failure) { session.toast("error", errorMessage(failure)); }
}
function downloadPrivate() {
  if (!privateAcknowledged.value || !tokenValid.value || generating.value || command.value.error) return;
  try {
    const script = privateDeviceInstallScript(serverURL.value, options, permissions.value, token.value.trim());
    const url = URL.createObjectURL(new Blob([script], { type: "text/x-shellscript;charset=utf-8" }));
    downloadURLs.add(url);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "xunara-device-join.sh"; anchor.click();
    setTimeout(() => { URL.revokeObjectURL(url); downloadURLs.delete(url); }, 1000);
  } catch (failure) { session.toast("error", errorMessage(failure)); }
}
async function copy(value: string) {
  try { await copyText(value); session.toast("success", "已复制，不含认证密钥"); }
  catch (failure) { session.toast("error", errorMessage(failure)); }
}
</script>

<template>
  <ModalDialog :open="open" title="添加设备" :busy="loading || generating" @close="emit('close')">
    <div class="stack">
      <p>安装官方 Tailscale 客户端，选择浏览器授权，或用设备预授权 Token 免网页登录直接加入。</p>
      <p v-if="loading" role="status">正在确认本租户的接入地址…</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}<button class="btn small" @click="load">重新读取接入地址</button></div>
      <label class="field"><span class="label">设备平台</span><select v-model="options.platform" class="select" aria-label="设备平台" :disabled="generating"><option value="linux">Linux（curl 一键安装）</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="android">Android</option><option value="ios">iPhone / iPad</option></select></label>
      <template v-if="serverURL">
        <div class="kv"><div class="k">控制面地址</div><div class="v mono">{{ serverURL }}</div></div>
        <a v-if="downloads[options.platform]" class="btn" :href="downloads[options.platform]" target="_blank" rel="noopener noreferrer">打开官方客户端下载</a>
        <p v-if="mobilePlatform" class="muted">在 APP 中选择自定义登录服务器，填入上述地址，再完成浏览器授权与设备审批。手机端不执行 Linux 安装脚本。</p>
        <template v-else>
          <label class="field"><span class="label">接入方式</span><select v-model="options.authMethod" class="select" aria-label="设备接入方式" :disabled="generating"><option value="browser">浏览器授权（需审批）</option><option value="token">预授权 Token（免网页登录）</option></select></label>
          <div v-if="tokenMode" class="stack device-install-options">
            <p class="muted small-text">这里的 Token 是 <strong>设备 Auth Key</strong>（tskey-auth- 开头），不是超级管理员令牌或 API Key。可粘贴已有密钥，或生成短期一次性密钥。</p>
            <label class="field"><span class="label">设备预授权 Token</span><input v-model="token" class="input mono" type="password" aria-label="设备预授权 Token" autocomplete="off" spellcheck="false" maxlength="266" :disabled="generating" placeholder="tskey-auth-…" @input="generatedExpiry = ''; privateAcknowledged = false" /></label>
            <div v-if="token && !tokenValid" class="alert warning">请输入有效的设备 Auth Key，不要填后台令牌或 API Key。</div>
            <p v-if="generatedExpiry" class="muted small-text">一次性密钥有效至 {{ formatTime(generatedExpiry) }}。关闭后不再显示，但未使用的密钥仍有效，可在「API 与密钥」撤销。</p>
            <template v-if="canGenerate">
              <label class="field"><span class="label">新密钥有效期</span><select v-model="ttlSeconds" class="select" aria-label="接入密钥有效期" :disabled="generating"><option :value="900">15 分钟（推荐）</option><option :value="3600">1 小时</option><option :value="86400">24 小时</option></select></label>
              <button class="btn" :disabled="generating || loading || keyLimitReached || Boolean(token)" @click="generate">{{ generating ? '正在生成…' : '生成一次性设备 Token' }}</button>
              <p class="muted small-text">可用密钥 {{ enrollment?.used }} / {{ enrollment?.max_auth_keys === -1 ? '不限' : enrollment?.max_auth_keys }}{{ keyLimitReached ? '，请先清理不再使用的密钥。' : '' }}</p>
            </template>
            <p v-else-if="enrollment && !enrollment.can_manage" class="muted small-text">生成密钥需要网络管理员权限；可以使用管理员提供的设备 Auth Key。</p>
            <div v-if="enrollmentError" class="alert error" role="alert">{{ enrollmentError }}<p>不自动重试生成；结果未确认时请到「API 与密钥」检查记录。</p></div>
            <button v-if="tokenValid" class="btn small" @click="copyToken">复制设备 Token（敏感）</button>
            <button v-if="token" class="btn small" :disabled="generating" @click="clearToken">清除本页 Token</button>
          </div>
          <label v-if="options.platform === 'linux'" class="checkbox"><input v-model="options.installClient" type="checkbox" />同时安装 / 更新官方客户端</label>
          <label class="checkbox"><input v-model="options.acceptDNS" type="checkbox" />接收网络 DNS 配置（MagicDNS）</label>
          <label class="checkbox"><input v-model="options.acceptRoutes" type="checkbox" />接收其他设备发布的子网路由</label>
          <label class="field"><span class="label">设备名称（可选）</span><input v-model="options.hostname" class="input" aria-label="安装设备名称" maxlength="63" placeholder="例如 home-server" /></label>
          <details class="device-install-options"><summary>子网路由与出口节点</summary>
            <label class="checkbox"><input v-model="options.advertiseSubnets" type="checkbox" :disabled="!permissions.allowSubnetRouter" />将此设备设为子网路由器</label>
            <label v-if="options.advertiseSubnets" class="field"><span class="label">宣告 IPv4 子网（逗号分隔）</span><input v-model="options.routes" class="input mono" aria-label="安装宣告子网" placeholder="192.168.1.0/24,10.10.0.0/24" maxlength="4096" /></label>
            <label class="checkbox"><input v-model="options.advertiseExitNode" type="checkbox" :disabled="!permissions.allowExitNode" />将此设备设为出口节点</label>
            <p class="muted small-text">选项按当前套餐开放；宣告不等于批准或 ACL 放行。使用路由/出口功能还需在设备启用 IP 转发，并在控制台批准。</p>
          </details>
          <div v-if="command.error" class="alert error" role="alert">{{ command.error }}</div>
          <button v-if="command.text" class="btn primary" @click="copy(command.text)">复制安装 / 接入命令</button>
          <pre v-if="command.text" class="device-install-command mono" aria-label="设备安装命令">{{ command.text }}</pre>
          <template v-if="tokenMode">
            <p class="muted small-text">复制的命令不含真实密钥；执行时在隐藏输入中粘贴 Token，客户端从 0600 临时文件读取，不需要网页审批。Windows 请用管理员 PowerShell，macOS 先安装官方客户端。</p>
            <div v-if="options.platform === 'linux' && tokenValid" class="stack">
              <div class="alert warning">私有一键脚本<strong>包含真实 Token</strong>。只下载到可信设备，勿转发、上传 Git 或放入公开目录；保存后先限制权限，执行完成删除脚本。</div>
              <label class="checkbox"><input v-model="privateAcknowledged" type="checkbox" />我确认将含 Token 的脚本私有保存和使用</label>
              <button class="btn primary" :disabled="!privateAcknowledged || generating || Boolean(command.error)" @click="downloadPrivate">下载私有一键加入脚本</button>
              <pre class="device-install-command mono">chmod 700 xunara-device-join.sh &amp;&amp; sh ./xunara-device-join.sh</pre>
              <p class="muted small-text">在 Linux 下载目录执行上面的命令，即按勾选参数安装并加入。本页新生成密钥仅可使用一次；已有密钥按原属性处理。脚本不会跳过 TLS 校验。</p>
            </div>
          </template>
          <p v-else class="muted small-text">命令不含 Auth Key；在安装设备上执行，浏览器授权后等待审批。用于新设备，不自动重置已有设备的非默认配置。</p>
          <p class="muted small-text">预授权不是 ACL 放行或路由批准，设备仍受当前套餐额度限制。</p>
        </template>
        <button v-if="mobilePlatform" class="btn primary" @click="copy(serverURL)">复制控制面地址</button>
        <p class="muted small-text">若控制面使用测试证书，请先安装已核实的公有 CA。命令不会跳过 TLS 校验，也不会把网页登录自动变成设备信任。</p>
      </template>
    </div>
    <template #footer><button class="btn" :disabled="loading || generating" @click="emit('close')">关闭</button></template>
  </ModalDialog>
</template>

<style scoped>
.device-install-command { margin: 0; padding: 12px; border-radius: 8px; background: var(--surface-2); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.8; max-height: 240px; overflow-y: auto; }
.device-install-options { border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.device-install-options summary { cursor: pointer; margin-bottom: 12px; }
.device-install-options .checkbox { margin: 12px 0; }
</style>
