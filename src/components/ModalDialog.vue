<script setup lang="ts">
import { ref, toRef, useId } from "vue";
import { useDialogFocus } from "../utils/dialog";
const props = defineProps<{ title: string; open: boolean; busy?: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();
const dialog = ref<HTMLElement | null>(null);
const titleId = useId();
function close() { if (!props.busy) emit("close"); }
useDialogFocus(toRef(props, "open"), dialog, close);
</script>

<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div ref="dialog" class="card modal-card" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
      <div class="card-head">
        <h2 :id="titleId">{{ title }}</h2>
        <button class="btn ghost small" aria-label="关闭弹窗" :disabled="busy" @click="close">×</button>
      </div>
      <div class="card-body"><slot /></div>
      <div v-if="$slots.footer" class="card-head modal-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgb(15 17 21 / 45%);
  display: grid;
  place-items: center;
  z-index: 60;
  padding: 16px;
}
.modal-card { width: min(620px, 100%); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; margin: 0; }
.modal-card > .card-head { flex-shrink: 0; }
.modal-card > .card-body { overflow-y: auto; min-height: 0; }
.modal-footer { border-top: 1px solid var(--border); border-bottom: none; justify-content: flex-end; }
@media (max-width: 560px) { .modal-mask { padding: 10px; } .modal-card { max-height: calc(100dvh - 20px); } }
</style>
