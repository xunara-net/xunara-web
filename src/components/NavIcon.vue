<script setup lang="ts">
defineProps<{ name: string }>();
const paths: Record<string, string> = {
  home: "M3 10 12 3l9 7v10H3Z M9 20v-7h6v7",
  device: "M3 4h18v12H3Z M8 21h8 M12 16v5",
  network: "M12 8V3 M4 21v-5h16v5 M12 21v-5 M7 8h10v5H7Z",
  topology: "M12 5 4 18h16Z M9 2h6v6H9Z M1 16h6v6H1Z M17 16h6v6h-6Z",
  lock: "M5 10h14v11H5Z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  dns: "M3 4h18v6H3Z M3 14h18v6H3Z M7 7h.01 M7 17h.01 M16 7h2 M16 17h2",
  route: "M5 3v11a5 5 0 0 0 5 5h9 M15 15l4 4-4 4 M14 3v7h6 M17 7l3 3-3 3",
  relay: "M4 5h16v5H4Z M4 14h16v5H4Z M8 7.5h.01 M8 16.5h.01 M12 10v4",
  key: "M14 5a5 5 0 1 1-4 9L3 21v-4l6-6a5 5 0 0 1 5-6Z M17 7h.01",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z M8 12l3 3 5-6",
  audit: "M5 3h14v18H5Z M9 7h6 M9 11h6 M9 15h4",
  members: "M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M5 21v-3a7 7 0 0 1 14 0v3 M3 7a2 2 0 0 0 0 4 M21 7a2 2 0 0 1 0 4",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2",
  plan: "M3 5h18v14H3Z M3 9h18 M7 15h3",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  collapse: "M3 4h18v16H3Z M8 4v16 M16 9l-3 3 3 3",
};
</script>
<template><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.network" /></svg></template>
