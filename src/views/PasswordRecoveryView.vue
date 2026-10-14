<script setup lang="ts">
import { onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
onMounted(() => {
  // 旧书签不读取恢复码；清除误粘贴的参数，页面不再提交旧兑换请求。
  if (Object.keys(route.query).length || route.hash) void router.replace({ name: "reset-password" });
});
</script>

<template>
  <div class="auth-wrap">
    <section class="card auth-card">
      <h1 class="auth-title">忘记密码</h1>
      <p class="auth-sub">联系平台管理员恢复账号，无需重置码。</p>
      <ol class="recovery-steps">
        <li>告知管理员你的网络 ID 和登录名，通过可靠渠道核实身份。</li>
        <li>管理员直接重置为随机临时密码，原密码和已有控制台登录立即失效。</li>
        <li>在所属网络的正常登录页输入临时密码，按提示设置自己的新密码。</li>
      </ol>
      <div class="alert info">不要提供旧密码，不要把临时密码加入网址或保存在工单、截图中。旧重置码已停用。</div>
      <p class="help recovery-note">组网设备和 API Key 不受改密影响。已有第三方或通行密钥绑定不删除，但重置后也需完成本人改密才能使用控制台。</p>
      <div class="auth-footer"><router-link to="/login">返回登录</router-link><a href="https://github.com/xunara-net/xunara-docs" target="_blank" rel="noreferrer">帮助文档</a></div>
    </section>
  </div>
</template>

<style scoped>
.recovery-steps { margin: 22px 0; padding-left: 24px; line-height: 1.8; }
.recovery-steps li + li { margin-top: 12px; }
.recovery-note { margin-top: 18px; }
</style>
