<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppShell from "./components/AppShell.vue";
import ToastHost from "./components/ToastHost.vue";

// The sign-in and registration pages render bare; every other page renders
// inside the console shell.
const route = useRoute();
const bare = computed(() => route.meta.bare === true);
</script>

<template>
  <AppShell v-if="!bare" />
  <router-view v-else />
  <ToastHost />
</template>
