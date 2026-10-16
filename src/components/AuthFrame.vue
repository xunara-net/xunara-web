<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <main class="auth-wrap authorization-wrap">
    <section class="card authorization-card">
      <router-link to="/dashboard" class="authorization-brand" aria-label="返回玄序">
        <span class="brand-mark">玄</span><span>玄序 <small>Xunara</small></span>
      </router-link>
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="muted authorization-subtitle">{{ subtitle }}</p>
      <slot />
    </section>
  </main>
</template>

<style scoped>
.authorization-wrap { min-height: 100dvh; padding: 24px 16px; }
.authorization-card { width: 100%; max-width: 520px; padding: clamp(20px, 5vw, 36px); }
.authorization-brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: var(--text); margin-bottom: 28px; font-weight: 650; }
.authorization-brand small { color: var(--text-muted); margin-left: 4px; font-weight: 400; }
h1 { font-size: clamp(22px, 5vw, 28px); margin: 0 0 12px; }
.authorization-subtitle { line-height: 1.7; margin-bottom: 24px; }
</style>
