<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { ExitNode } from "../api/route-management";
import { exitNodeCommand, stopExitNodeCommand } from "../utils/route-management";
import { copyText } from "../utils/clipboard";
import { session } from "../store";
import { errorMessage } from "../api/client";
import type { ClientPlatform } from "../utils/devices";
import ModalDialog from "./ModalDialog.vue";
const props = defineProps<{ node: ExitNode | null; available: boolean }>();
const emit = defineEmits<{ (event: "close"): void }>();
const options = reactive({ platform: "linux" as ClientPlatform, allowLAN: false });
const error = ref("");
watch(() => props.node?.stableId, () => { error.value = ""; options.allowLAN = false; });
const command = computed(() => {
  if (!props.node) return "";
  try { return exitNodeCommand(props.node.ipv4 || props.node.ipv6 || "", options.platform, options.allowLAN); }
  catch { return ""; }
});
const stop = computed(() => stopExitNodeCommand(options.platform));
async function copy(value: string) {
  try { await copyText(value); error.value = ""; session.toast("success","已复制，请在需要使用出口的设备执行"); }
  catch (failure) { error.value = errorMessage(failure); }
}
</script>
<template>
  <ModalDialog :open="Boolean(node)" title="在自己的设备使用出口节点" @close="emit('close')">
    <div class="stack">
      <p>{{ node?.hostname }} · {{ node?.ipv4 || node?.ipv6 }}。命令只改变执行命令的本机，不会远程切换整个网络。</p>
      <p v-if="node && !available" class="alert warning">出口当前离线、过期、未匹配宣告或状态尚未确认。此说明仅供排查，请先检查出口服务器，避免切换后无法上网。</p>
      <label class="field"><span class="label">我的客户端平台</span><select v-model="options.platform" class="select" aria-label="出口客户端平台"><option value="linux">Linux</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="android">Android</option><option value="ios">iPhone / iPad</option></select></label>
      <label class="checkbox"><input v-model="options.allowLAN" type="checkbox" />使用出口时仍允许访问本地局域网</label>
      <template v-if="command"><pre class="exit-command mono" aria-label="选择出口命令">{{ command }}</pre><button class="btn primary" @click="copy(command)">复制选择出口命令</button><p>停止使用出口：</p><pre class="exit-command mono" aria-label="停止出口命令">{{ stop }}</pre><button class="btn" @click="copy(stop)">复制停止出口命令</button></template>
      <p v-else>在 APP 的「出口节点」选择 {{ node?.hostname }}。局域网访问选项依客户端版本而定，手机不执行 Linux 命令。</p>
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
      <p class="muted small-text">先确认该出口已批准、在线、允许 IP 转发且策略允许访问公网；命令不含认证密钥，不重置登录。自报选择不是实时流量证明。</p>
    </div>
    <template #footer><button class="btn" @click="emit('close')">关闭</button></template>
  </ModalDialog>
</template>
<style scoped>
.exit-command { padding: 12px; background: var(--surface-2); border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-size: 12px; line-height: 1.8; }
</style>
