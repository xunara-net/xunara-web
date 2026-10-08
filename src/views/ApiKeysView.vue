<script setup lang="ts">
import { onMounted, ref } from "vue";
import * as ep from "../api/endpoints";
import { errorMessage } from "../api/client";
import type { ApiKey, AuthKey } from "../api/types";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import DataTable from "../components/DataTable.vue";
import ModalDialog from "../components/ModalDialog.vue";
import { formatTime } from "../utils/format";

const loading = ref(true);
const error = ref("");
const apiKeys = ref<ApiKey[]>([]);
const authKeys = ref<AuthKey[]>([]);

const showAuthKey = ref(false);
const authReusable = ref(true);
const authEphemeral = ref(false);
const authTTL = ref("24h");
const authTags = ref("");
const newAuthSecret = ref("");

const showAPIKey = ref(false);
const apiName = ref("");
const apiScopes = ref<string[]>(["read"]);
const apiTTL = ref("");
const newAPIToken = ref("");

const plan = () => session.state.plan;

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    [apiKeys.value, authKeys.value] = await Promise.all([ep.listAPIKeys(), ep.listAuthKeys()]);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function createAuth() {
  try {
    const tags = authTags.value.split(",").map((t) => t.trim()).filter(Boolean);
    const created = await ep.createAuthKey({
      reusable: authReusable.value,
      ephemeral: authEphemeral.value,
      ttl: authTTL.value || undefined,
      tags,
    });
    newAuthSecret.value = created.key;
    session.toast("success", "预授权密钥已创建，密钥只显示这一次");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  }
}

async function createAPI() {
  try {
    const created = await ep.createAPIKey({
      name: apiName.value || "未命名密钥",
      scopes: apiScopes.value,
      ttl: apiTTL.value || undefined,
    });
    newAPIToken.value = created.token;
    session.toast("success", "API 密钥已创建，密钥只显示这一次");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  }
}

async function removeAuth(key: AuthKey) {
  if (!window.confirm("删除这个预授权密钥？使用它的设备将无法再加入。")) return;
  try {
    await ep.deleteAuthKey(key.id);
    session.toast("success", "预授权密钥已删除");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  }
}

async function removeAPI(key: ApiKey) {
  if (!window.confirm(`撤销 API 密钥「${key.name}」？`)) return;
  try {
    await ep.revokeAPIKey(key.id);
    session.toast("success", "API 密钥已撤销");
    await load();
  } catch (err) {
    session.toast("error", errorMessage(err));
  }
}
</script>

<template>
  <PageHeader title="API 与密钥" desc="给自动化与设备预授权使用的凭据。密钥只在创建时显示一次。">
    <template #actions>
      <button class="btn" @click="showAuthKey = true">创建预授权密钥</button>
      <button class="btn primary" @click="showAPIKey = true">创建 API 密钥</button>
    </template>
  </PageHeader>

  <div v-if="error" class="alert error" style="margin-bottom: 16px">{{ error }}</div>
  <div v-if="plan() && !plan()!.allowApi" class="alert warning" style="margin-bottom: 16px">
    当前套餐不包含 API 访问权限，创建 API 密钥会被拒绝。
  </div>

  <div class="card">
    <div class="card-head"><h2>API 密钥</h2><span class="hint">供脚本与集成使用（Authorization: Bearer）</span></div>
    <DataTable :columns="[
      { key: 'name', title: '名称' },
      { key: 'scopes', title: '权限' },
      { key: 'createdAt', title: '创建时间' },
      { key: 'lastUsedAt', title: '最后使用' },
      { key: 'actions', title: '操作', align: 'right' },
    ]" :rows="apiKeys" :loading="loading" row-key="id" empty-title="还没有 API 密钥">
      <template #cell-scopes="{ row }">
        <span v-for="scope in row.scopes" :key="scope" class="badge primary" style="margin-right: 4px">{{ scope }}</span>
      </template>
      <template #cell-createdAt="{ row }">{{ formatTime(row.createdAt) }}</template>
      <template #cell-lastUsedAt="{ row }">{{ row.lastUsedAt ? formatTime(row.lastUsedAt) : "从未" }}</template>
      <template #cell-actions="{ row }">
        <div class="row-actions"><button class="btn small danger" @click="removeAPI(row)">撤销</button></div>
      </template>
    </DataTable>
  </div>

  <div class="card">
    <div class="card-head"><h2>预授权密钥</h2><span class="hint">设备用 tailscale up --authkey=… 直接加入</span></div>
    <DataTable :columns="[
      { key: 'id', title: 'ID' },
      { key: 'kind', title: '类型' },
      { key: 'tags', title: '标签' },
      { key: 'expiry', title: '过期时间' },
      { key: 'used', title: '状态' },
      { key: 'actions', title: '操作', align: 'right' },
    ]" :rows="authKeys" :loading="loading" row-key="id" empty-title="还没有预授权密钥">
      <template #cell-id="{ row }"><span class="mono">#{{ row.id }}</span></template>
      <template #cell-kind="{ row }">
        <span class="badge">{{ row.reusable ? "可复用" : "一次性" }}</span>
        <span v-if="row.ephemeral" class="badge" style="margin-left: 4px">临时</span>
      </template>
      <template #cell-tags="{ row }">
        <span v-for="tag in row.tags || []" :key="tag" class="badge" style="margin-right: 4px">{{ tag }}</span>
        <span v-if="!row.tags?.length" style="color: var(--text-faint)">—</span>
      </template>
      <template #cell-expiry="{ row }">{{ row.expiry ? formatTime(row.expiry) : "永不过期" }}</template>
      <template #cell-used="{ row }"><span class="badge" :class="row.used ? '' : 'success'">{{ row.used ? "已使用" : "可用" }}</span></template>
      <template #cell-actions="{ row }">
        <div class="row-actions"><button class="btn small danger" @click="removeAuth(row)">删除</button></div>
      </template>
    </DataTable>
  </div>

  <ModalDialog title="创建预授权密钥" :open="showAuthKey" @close="showAuthKey = false">
    <div v-if="newAuthSecret" class="alert success" style="margin-bottom: 12px">
      <div style="margin-bottom: 6px">密钥已创建，请立即复制（只显示这一次）：</div>
      <code class="mono" style="word-break: break-all">{{ newAuthSecret }}</code>
    </div>
    <div class="field">
      <label>有效期</label>
      <input v-model="authTTL" class="input" placeholder="例如 24h、720h；留空表示永不过期" />
    </div>
    <div class="field">
      <label>标签</label>
      <input v-model="authTags" class="input" placeholder="tag:server, tag:prod（可选，逗号分隔）" />
    </div>
    <label class="checkbox"><input v-model="authReusable" type="checkbox" /> 可复用（同一密钥可加入多台设备）</label>
    <label class="checkbox" style="margin-top: 8px"><input v-model="authEphemeral" type="checkbox" /> 临时设备（离线后自动清理）</label>
    <template #footer>
      <button class="btn" @click="showAuthKey = false; newAuthSecret = ''">关闭</button>
      <button class="btn primary" @click="createAuth">创建</button>
    </template>
  </ModalDialog>

  <ModalDialog title="创建 API 密钥" :open="showAPIKey" @close="showAPIKey = false">
    <div v-if="newAPIToken" class="alert success" style="margin-bottom: 12px">
      <div style="margin-bottom: 6px">密钥已创建，请立即复制（只显示这一次）：</div>
      <code class="mono" style="word-break: break-all">{{ newAPIToken }}</code>
    </div>
    <div class="field">
      <label>名称</label>
      <input v-model="apiName" class="input" placeholder="例如 CI 部署" />
    </div>
    <div class="field">
      <label>权限范围</label>
      <label class="checkbox"><input v-model="apiScopes" type="checkbox" value="read" /> 只读（read）</label>
      <label class="checkbox" style="margin-top: 6px"><input v-model="apiScopes" type="checkbox" value="write" /> 读写（write）</label>
    </div>
    <div class="field">
      <label>有效期</label>
      <input v-model="apiTTL" class="input" placeholder="例如 720h；留空表示长期有效" />
    </div>
    <template #footer>
      <button class="btn" @click="showAPIKey = false; newAPIToken = ''">关闭</button>
      <button class="btn primary" @click="createAPI">创建</button>
    </template>
  </ModalDialog>
</template>
