<script setup lang="ts">
import { computed, reactive } from "vue";
import { privateRelayInstallCommand } from "../utils/relay-install";
import { relayRelease } from "../utils/relay-downloads";
import { copyText } from "../utils/clipboard";
import { errorMessage } from "../api/client";
import { session } from "../store";

const props = defineProps<{ controlUrl?: string; blockedRegions: number[] }>();
let regionId = 40001;
while (props.blockedRegions.includes(regionId)) regionId++;
const options = reactive({ hostname: "", port: 9091, regionId, stun: false, stunPort: 3478, controlCAFile: "", upgrade: false });
const command = computed(() => {
  if (!props.controlUrl) return { text: "", error: "请先成功读取中继配置，确认本租户接入地址" };
  try { return { text: privateRelayInstallCommand(props.controlUrl, options, props.blockedRegions), error: "" }; }
  catch (failure) { return { text: "", error: errorMessage(failure) }; }
});
async function copy() {
  try { await copyText(command.value.text); session.toast("success", "已复制安装命令，执行时再输入令牌"); }
  catch (failure) { session.toast("error", errorMessage(failure)); }
}
</script>

<template>
  <section class="card"><div class="card-head"><h2>接入自己的中继服务器</h2><span class="badge">Linux 一键安装</span></div>
    <div class="card-body stack">
      <p>先创建并保存一次性接入令牌，再在中继服务器执行命令。脚本自动识别 Linux AMD64 / ARM64 / ARMv7，下载 {{ relayRelease.version }} 预编译文件并校验，无需 Go。</p>
      <div class="grid cols-2">
        <label class="field"><span class="label">中继公网域名或 IP</span><input v-model="options.hostname" class="input mono" aria-label="安装中继公网地址" placeholder="relay.example.com / 服务器公网 IP" maxlength="253" /></label>
        <label class="field"><span class="label">DERP TCP/TLS 端口</span><input v-model.number="options.port" class="input" aria-label="安装中继端口" type="number" min="1" max="65535" /></label>
      </div>
      <label class="checkbox"><input v-model="options.stun" type="checkbox" />开启 STUN（需要另外开放 UDP 端口，有助于直连）</label>
      <label v-if="options.stun" class="field"><span class="label">STUN UDP 端口</span><input v-model.number="options.stunPort" class="input" aria-label="安装 STUN 端口" type="number" min="1" max="65535" /></label>
      <details class="install-more"><summary>区域编号、测试 CA 与安全升级</summary>
        <label class="field"><span class="label">区域编号</span><input v-model.number="options.regionId" class="input" aria-label="安装中继区域编号" type="number" min="1" max="2147483647" /></label>
        <label class="field"><span class="label">控制面公有 CA 文件（可选）</span><input v-model="options.controlCAFile" class="input mono" aria-label="安装控制面 CA 文件" placeholder="/root/xunara-test-ca.crt" /><span class="help">先把已核实的公有 CA 放到服务器；只配置中继进程信任，不安装到系统全局，不上传私钥。</span></label>
        <label class="checkbox"><input v-model="options.upgrade" type="checkbox" />升级已有独立私有中继（保留身份、证书和配置）</label>
        <p class="muted small-text">升级必须填写与原安装一致的地址、端口、区域和 STUN 设置；不会重置接入或自动复活已撤销身份。</p>
      </details>
      <p v-if="command.error" class="alert warning" role="status">{{ command.error }}</p>
      <pre v-if="command.text" class="install-command mono" aria-label="私有中继安装命令">{{ command.text }}</pre>
      <button v-if="command.text" class="btn primary" @click="copy">复制私有中继安装命令</button>
      <p class="muted small-text">执行时隐藏输入接入令牌，命令与下载 URL 不含令牌。使用独立 xunara-private-relay 服务和目录，不覆盖平台默认中继。开放所选 TCP/UDP 端口，接入后在列表点「健康检测」。</p>
      <p class="muted small-text">脚本仅用于 Linux systemd；Windows/macOS 请使用程序下载页。测试证书需已核实的 CA，不生成跳过 TLS 校验的命令。</p>
    </div>
  </section>
</template>

<style scoped>
.install-command { margin: 0; padding: 12px; border-radius: 8px; background: var(--surface-2); font-size: 12px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.install-more { padding: 12px; border: 1px solid var(--border); border-radius: 8px; }
.install-more summary { cursor: pointer; margin-bottom: 12px; }
.install-more .field, .install-more .checkbox { margin: 12px 0; }
</style>
