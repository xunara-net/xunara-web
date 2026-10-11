<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getProviders } from "../api/endpoints";
import { ApiError, errorMessage } from "../api/client";
import { resetPassword } from "../api/password-reset";

const route = useRoute();
const router = useRouter();
const code = ref("");
const password = ref("");
const confirmation = ref("");
const loading = ref(true);
const loadError = ref("");
const available = ref(false);
const busy = ref(false);
const error = ref("");
const uncertain = ref(false);
const completed = ref(false);
let disposed = false;

function clearSecrets() { code.value = ""; password.value = ""; confirmation.value = ""; }
onUnmounted(() => { disposed = true; clearSecrets(); });
onMounted(() => {
  // 不读取任何链接中的码或密码；清掉误粘贴的参数 / fragment，正式入口只有手动输入。
  if (Object.keys(route.query).length || route.hash) void router.replace({ name: "reset-password" });
  void load();
});

async function load() {
  loading.value = true; loadError.value = ""; available.value = false;
  try {
    const methods = await getProviders();
    if (!disposed) available.value = methods.password_reset === true && methods.local_login && !methods.setup_required;
  } catch (err) { if (!disposed) loadError.value = errorMessage(err); }
  finally { if (!disposed) loading.value = false; }
}

async function submit() {
  if (busy.value || loading.value || loadError.value || !available.value || completed.value || uncertain.value) return;
  busy.value = true; error.value = "";
  try {
    await resetPassword(code.value, password.value, confirmation.value);
    if (disposed) return;
    clearSecrets(); completed.value = true;
  } catch (err) {
    if (disposed) return;
    error.value = errorMessage(err);
    uncertain.value = err instanceof ApiError ? err.status >= 500 || err.status === 408 : !(err instanceof Error && /^(请输入|新密码|两次输入)/.test(err.message));
  } finally { if (!disposed) busy.value = false; }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="card auth-card">
      <div class="reset-brand"><span class="brand-mark">玄</span><div><div class="auth-title">重置登录密码</div><div class="auth-sub">只修改本账号的控制台登录密码</div></div></div>
      <div v-if="loading" class="help reset-feedback" role="status">正在确认密码恢复方式…</div>
      <template v-else-if="loadError">
        <div class="alert error reset-feedback" role="alert">{{ loadError }}</div>
        <button class="btn reset-action" @click="load">重新加载</button>
      </template>
      <div v-else-if="!available" class="alert info reset-feedback">当前网络未开启此密码恢复方式，请联系平台管理员；已有第三方或通行密钥仍可按原方式登录。</div>
      <template v-else-if="completed">
        <div class="alert success reset-feedback" role="status">密码已重置，原浏览器登录已退出。请使用新密码重新登录。</div>
        <p class="help reset-feedback">组网设备、中继、API Key、第三方与通行密钥绑定没有被撤销。若怀疑账号被接管，请同时检查这些凭据。</p>
      </template>
      <template v-else>
        <div class="alert info reset-feedback">忘记密码？请联系平台管理员核实身份并获取一次性重置码。当前不通过未经验证的联系邮箱自动找回。</div>
        <p class="help reset-feedback">重置码 15 分钟有效、仅可使用一次，必须在管理员指定的本网络页面输入。不要把码或密码加入网址。</p>
        <div v-if="error" class="alert error reset-feedback" role="alert">{{ error }}</div>
        <div v-if="uncertain" class="alert reset-feedback">尚未确认提交结果。请先尝试使用新密码登录；若不能登录，再联系管理员核对并重新生成。不会自动重试。</div>
        <form class="reset-form" @submit.prevent="submit">
          <div class="field"><label for="reset-code">一次性重置码</label><input id="reset-code" v-model="code" class="input mono" autocomplete="off" spellcheck="false" :disabled="busy || uncertain" placeholder="reset-…" required /></div>
          <div class="field"><label for="reset-password">新密码</label><input id="reset-password" v-model="password" type="password" class="input" autocomplete="new-password" :disabled="busy || uncertain" required /><p class="help">至少 12 个字符，最多 72 字节，不能与登录名相同。</p></div>
          <div class="field"><label for="reset-confirmation">确认新密码</label><input id="reset-confirmation" v-model="confirmation" type="password" class="input" autocomplete="new-password" :disabled="busy || uncertain" required /></div>
          <button class="btn primary reset-action" :disabled="busy || uncertain">{{ busy ? '正在重置…' : '确认重置密码' }}</button>
        </form>
      </template>
      <div class="auth-footer"><router-link to="/login">返回登录</router-link><a href="https://github.com/xunara-net/xunara-docs" target="_blank" rel="noreferrer">帮助文档</a></div>
    </div>
  </div>
</template>

<style scoped>
.reset-brand { display: flex; align-items: center; gap: 10px; }
.reset-feedback { margin-top: 18px; overflow-wrap: anywhere; }
.reset-form { margin-top: 20px; }
.reset-action { width: 100%; margin-top: 12px; }
</style>
