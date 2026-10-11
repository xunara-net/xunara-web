<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { getOverview } from "../api/endpoints";
import { errorMessage } from "../api/client";
import { session } from "../store";
import { copyText } from "../utils/clipboard";
import { deviceInstallCommand, type DeviceInstallOptions } from "../utils/device-install";
import { clientLoginCommand } from "../utils/devices";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const serverURL = ref(""), error = ref(""), loading = ref(false);
const options = reactive<DeviceInstallOptions>({ platform: "linux", installClient: true, acceptDNS: true,
  acceptRoutes: false, hostname: "", advertiseSubnets: false, routes: "", advertiseExitNode: false });
let sequence = 0, active = true;
onBeforeUnmount(() => { active = false; sequence++; });
const permissions = computed(() => ({ allowSubnetRouter: Boolean(session.state.plan?.allowSubnetRouter),
  allowExitNode: Boolean(session.state.plan?.allowExitNode), maxRoutes: session.state.plan?.maxRoutes ?? 0 }));
const mobilePlatform = computed(() => options.platform === "android" || options.platform === "ios");
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
  if (open) {
    Object.assign(options, { platform: "linux", installClient: true, acceptDNS: true, acceptRoutes: false,
      hostname: "", advertiseSubnets: false, routes: "", advertiseExitNode: false });
    load();
  } else { serverURL.value = ""; error.value = ""; }
});
async function load() {
  const request = ++sequence;
  serverURL.value = ""; error.value = ""; loading.value = true;
  try {
    const overview = await getOverview();
    clientLoginCommand(overview.serverUrl, "linux");
    if (active && props.open && request === sequence) serverURL.value = new URL(overview.serverUrl).origin;
  } catch (failure) { if (active && props.open && request === sequence) error.value = errorMessage(failure); }
  finally { if (active && request === sequence) loading.value = false; }
}
async function copy(value: string) {
  try { await copyText(value); session.toast("success", "已复制，不含认证密钥"); }
  catch (failure) { session.toast("error", errorMessage(failure)); }
}
</script>

<template>
  <ModalDialog :open="open" title="添加设备" :busy="loading" @close="emit('close')">
    <div class="stack">
      <p>安装官方 Tailscale 客户端，登录本网络；新设备仍需管理员批准，并受设备额度限制。</p>
      <p v-if="loading" role="status">正在确认本租户的接入地址…</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}<button class="btn small" @click="load">重新读取接入地址</button></div>
      <label class="field"><span class="label">设备平台</span><select v-model="options.platform" class="select" aria-label="设备平台"><option value="linux">Linux（curl 一键安装）</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="android">Android</option><option value="ios">iPhone / iPad</option></select></label>
      <template v-if="serverURL">
        <div class="kv"><div class="k">控制面地址</div><div class="v mono">{{ serverURL }}</div></div>
        <a v-if="downloads[options.platform]" class="btn" :href="downloads[options.platform]" target="_blank" rel="noopener noreferrer">打开官方客户端下载</a>
        <p v-if="mobilePlatform" class="muted">在 APP 中选择自定义登录服务器，填入上述地址，再完成浏览器授权与设备审批。手机端不执行 Linux 安装脚本。</p>
        <template v-else>
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
          <pre v-if="command.text" class="device-install-command mono" aria-label="设备安装命令">{{ command.text }}</pre>
          <button v-if="command.text" class="btn primary" @click="copy(command.text)">复制安装 / 接入命令</button>
          <p class="muted small-text">命令不含 Auth Key；在安装设备上执行，浏览器授权后等待审批。用于新设备，不自动重置已有设备的非默认配置。</p>
        </template>
        <button v-if="mobilePlatform" class="btn primary" @click="copy(serverURL)">复制控制面地址</button>
        <p class="muted small-text">若控制面使用测试证书，请先安装已核实的公有 CA。命令不会跳过 TLS 校验，也不会把网页登录自动变成设备信任。</p>
      </template>
    </div>
    <template #footer><button class="btn" :disabled="loading" @click="emit('close')">关闭</button></template>
  </ModalDialog>
</template>

<style scoped>
.device-install-command { margin: 0; padding: 12px; border-radius: 8px; background: var(--surface-2); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.8; }
.device-install-options { border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.device-install-options summary { cursor: pointer; margin-bottom: 12px; }
.device-install-options .checkbox { margin: 12px 0; }
</style>
