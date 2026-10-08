<script setup lang="ts">
import { computed } from "vue";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import { roleLabel } from "../utils/format";

const user = computed(() => session.state.user);
const capabilities = computed(() => session.state.capabilities);

const capabilityLabels: Record<string, string> = {
  "auth.password": "密码登录",
  "auth.passkey": "Passkey 登录",
  "auth.oidc": "第三方登录（OIDC）",
  "auth.register.invite": "邀请制注册",
  "identity.id_token": "身份令牌（ID Token）",
  sharing: "跨组织共享",
  webhooks: "Webhook",
  derp: "DERP 中继",
  "dns.managed": "托管 DNS",
  reach: "远程命令（Reach）",
  flux: "文件传输（Flux）",
  "services.agent": "服务发现 Agent",
  "network.custom_cidr": "自定义网段",
  "route.exit_node": "出口节点",
  "route.subnet_router": "子网路由",
  "api.keys": "API 密钥",
  audit: "审计日志",
  "team.members": "多成员",
};
</script>

<template>
  <PageHeader title="个人设置" desc="账号信息与本部署能力。" />

  <div class="grid cols-2">
    <div class="card">
      <div class="card-head"><h2>账号</h2></div>
      <div class="card-body">
        <div class="kv">
          <div class="k">登录名</div><div class="v mono">{{ user?.loginName }}</div>
          <div class="k">昵称</div><div class="v">{{ user?.displayName || "—" }}</div>
          <div class="k">邮箱</div><div class="v">{{ user?.email || "未绑定" }}</div>
          <div class="k">角色</div><div class="v">{{ roleLabel(user?.role || "member") }}</div>
          <div class="k">组织</div><div class="v">{{ session.state.tenant?.organizationName || session.state.tenant?.id || "default" }}</div>
        </div>
        <div class="alert info" style="margin-top: 16px">
          修改昵称、邮箱与密码的功能将随账户服务完善开放；如需立即修改请联系平台管理员。
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>本部署支持的能力</h2></div>
      <div class="card-body">
        <div style="display: flex; flex-wrap: wrap; gap: 8px">
          <span v-for="cap in capabilities" :key="cap" class="badge primary">
            {{ capabilityLabels[cap] ?? cap }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
