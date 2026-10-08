<script setup lang="ts">
import { session } from "../store";

const state = session.state;
const icon = { success: "✓", error: "✕", info: "ℹ" } as const;
</script>

<template>
  <div class="toasts" aria-live="polite">
    <div v-for="toast in state.toasts" :key="toast.id" class="toast" :class="toast.kind">
      <span>{{ icon[toast.kind] }}</span>
      <span style="flex: 1">{{ toast.text }}</span>
      <button class="btn ghost small" @click="session.dismiss(toast.id)">×</button>
    </div>
  </div>
</template>
