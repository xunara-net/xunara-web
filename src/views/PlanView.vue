<script setup lang="ts">
import { computed } from "vue";
import { session } from "../store";
import PageHeader from "../components/PageHeader.vue";
import { priceText, quotaPercent, quotaText } from "../utils/format";

const plan = computed(() => session.state.plan);

const features = computed(() => {
  const p = plan.value;
  if (!p) return [];
  return [
    { label: "自定义网段", ok: p.allowCustomCidr },
    { label: "子网路由", ok: p.allowSubnetRouter },
    { label: "出口节点", ok: p.allowExitNode },
    { label: "API 访问", ok: p.allowApi },
    { label: "访问策略（ACL）", ok: p.allowAcl },
    { label: "Grants 策略", ok: p.allowGrants },
    { label: "自定义 DNS", ok: p.allowCustomDns },
    { label: "审计日志", ok: p.allowAuditLog },
    { label: "多成员协作", ok: p.allowMultiMember },
  ];
});

const usage = computed(() => {
  const p = plan.value;
  if (!p) return [];
  return [
    { label: "设备", used: p.devicesUsed, limit: p.maxDevices },
  ];
});
</script>

<template>
  <PageHeader title="套餐与用量" desc="当前套餐、额度与能力。套餐变更由平台管理，升级入口将随计费模块开放。" />

  <div v-if="!plan" class="alert info">当前部署未启用套餐（自托管模式），所有能力的额度不受限制。</div>

  <template v-else>
    <div class="grid cols-3">
      <div class="card stat">
        <div class="label">当前套餐</div>
        <div class="value" style="font-size: 22px">{{ plan.name }}</div>
        <div class="sub">{{ priceText(plan.priceCents, plan.currency) }}<template v-if="plan.billingCycle"> / {{ plan.billingCycle === "month" ? "月" : "年" }}</template></div>
      </div>
      <div class="card stat">
        <div class="label">设备额度</div>
        <div class="value">{{ plan.devicesUsed }} / {{ quotaText(plan.maxDevices) }}</div>
        <div class="sub">
          <div class="progress" style="margin-top: 8px" :class="(quotaPercent(plan.devicesUsed, plan.maxDevices) ?? 0) >= 90 ? 'warning' : ''">
            <span :style="`width: ${quotaPercent(plan.devicesUsed, plan.maxDevices) ?? 4}%`" />
          </div>
        </div>
      </div>
      <div class="card stat">
        <div class="label">网络地址</div>
        <div class="value mono" style="font-size: 20px">{{ plan.networkPrefix ?? "—" }}</div>
        <div class="sub">{{ plan.allowCustomCidr ? "可自定义" : "系统自动分配" }}</div>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-head"><h2>额度</h2></div>
        <div class="card-body">
          <div v-for="item in usage" :key="item.label" style="margin-bottom: 14px">
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px">
              <span>{{ item.label }}</span>
              <span style="color: var(--text-muted)">{{ item.used }} / {{ quotaText(item.limit) }}</span>
            </div>
            <div class="progress"><span :style="`width: ${quotaPercent(item.used, item.limit) ?? 4}%`" /></div>
          </div>
          <div class="kv">
            <div class="k">成员上限</div><div class="v">{{ quotaText(plan.maxUsers) }}</div>
            <div class="k">路由上限</div><div class="v">{{ quotaText(plan.maxRoutes) }}</div>
            <div class="k">预授权密钥上限</div><div class="v">{{ quotaText(plan.maxAuthKeys) }}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>能力</h2></div>
        <div class="card-body">
          <div v-for="feature in features" :key="feature.label" style="display: flex; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--border)">
            <span>{{ feature.label }}</span>
            <span class="badge" :class="feature.ok ? 'success' : ''">{{ feature.ok ? "已包含" : "未包含" }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>升级套餐</h2></div>
      <div class="card-body" style="color: var(--text-muted); font-size: 13px">
        在线支付与自助升级将在计费模块上线后开放；在此之前如需升级，请联系平台管理员调整套餐。
      </div>
    </div>
  </template>
</template>
