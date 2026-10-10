<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError, errorMessage } from "../api/client";
import { beginAccountIdentity, getAccountIdentities, unlinkAccountIdentity, type AccountIdentities, type AccountIdentity } from "../api/account-identities";
import { session } from "../store";

const route = useRoute();
const router = useRouter();
const data = ref<AccountIdentities | null>(null);
const loading = ref(true);
const busy = ref("");
const error = ref("");
const available = computed(() => (data.value?.providers ?? []).filter((provider) => !data.value?.items.some((item) => item.provider_id === provider.id)));

onMounted(async () => {
  await load();
  if (route.query.identity_binding === "linked" && data.value) {
    session.toast("success", "第三方账号已绑定，可用于登录当前网络");
    const query = { ...route.query };
    delete query.identity_binding;
    await router.replace({ path: route.path, query, hash: route.hash });
  }
});
async function failure(err: unknown) {
  error.value = errorMessage(err);
  if (err instanceof ApiError && err.status === 401) {
    session.forget();
    await router.replace({ name: "login", query: { return_to: "/security" } });
  }
}
async function load() {
  loading.value = true;
  error.value = "";
  try { data.value = await getAccountIdentities(); }
  catch (err) { data.value = null; await failure(err); }
  finally { loading.value = false; }
}
async function bind(providerID: string) {
  if (!data.value || busy.value) return;
  busy.value = providerID; error.value = "";
  try { window.location.assign(await beginAccountIdentity(providerID, data.value.csrf_token)); }
  catch (err) { await failure(err); busy.value = ""; }
}
async function unlink(item: AccountIdentity) {
  if (!data.value || busy.value || !window.confirm(`解除 ${item.provider_name} 绑定？该来源的控制台登录会一并退出。须保留另一种可用登录方式；组网设备不受影响。`)) return;
  busy.value = item.id; error.value = "";
  try {
    if (await unlinkAccountIdentity(item.id, data.value.csrf_token)) {
      session.forget();
      await router.replace({ name: "login", query: { return_to: "/security" } });
      return;
    }
    session.toast("success", "已解除绑定并退出该来源的登录");
    await load();
  } catch (err) { await failure(err); }
  finally { busy.value = ""; }
}
</script>

<template>
  <section class="card" aria-labelledby="account-identities-title">
    <div class="card-head"><h2 id="account-identities-title">第三方账号绑定</h2><button class="btn small" :disabled="loading || !!busy" @click="load">刷新</button></div>
    <div class="card-body stack">
      <div v-if="loading" role="status">正在读取登录方式…</div>
      <div v-else-if="error" class="alert error" role="alert">{{ error }}</div>
      <template v-if="!loading && data">
        <p class="muted small-text">绑定后可用第三方账号登录本网络，不会新建成员或信任设备。相同邮箱的账户不会自动合并。</p>
        <div v-if="!data.providers.length" class="alert info">此网络尚未配置 OIDC 登录提供方，请联系部署管理员。已有绑定仍可管理。</div>
        <div v-for="item in data.items" :key="item.id" class="identity-row">
          <div class="identity-description"><strong>{{ item.provider_name }}</strong> <span class="badge" :class="item.enabled ? 'success' : ''">{{ item.enabled ? '已绑定' : '提供方已停用' }}</span><p class="muted wrap-anywhere">{{ item.display_name || item.email || '第三方账户' }}<span v-if="item.display_name && item.email"> · {{ item.email }}</span></p></div>
          <button class="btn small danger" :disabled="!!busy" @click="unlink(item)">{{ busy === item.id ? '处理中…' : '解除绑定' }}</button>
        </div>
        <p v-if="!data.items.length && data.providers.length" class="muted">还没有绑定第三方账号。</p>
        <div v-if="available.length" class="identity-actions"><button v-for="provider in available" :key="provider.id" class="btn" :disabled="!!busy" @click="bind(provider.id)">{{ busy === provider.id ? '正在跳转…' : `绑定 ${provider.name}` }}</button></div>
        <p class="hint">解绑必须保留另一种可用登录方式。第三方登录不会替代设备审批或修改成员权限。</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.identity-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 0; border-bottom: 1px solid var(--border); }
.identity-description { min-width: 0; flex: 1 1 180px; }
.identity-description p { margin-top: 6px; }
.identity-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
