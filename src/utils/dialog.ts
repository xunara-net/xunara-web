import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";

// 抽屉与弹窗共用键盘/焦点边界，关闭后归还焦点，不让手机背景继续滚动。
export function useDialogFocus(open: Readonly<Ref<boolean>>, element: Ref<HTMLElement | null>, close: () => void) {
  let previousFocus: HTMLElement | null = null;
  let previousOverflow = "";
  let active = false;

  function keydown(event: KeyboardEvent) {
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(element.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
    ) ?? []).filter((item) => item.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first) {
      event.preventDefault();
      element.value?.focus();
    } else if (event.shiftKey && (document.activeElement === element.value || document.activeElement === first || !element.value?.contains(document.activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (document.activeElement === element.value || document.activeElement === last || !element.value?.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function release() {
    if (!active) return;
    active = false;
    document.body.style.overflow = previousOverflow;
    document.removeEventListener("keydown", keydown);
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  watch(open, async (value) => {
    if (!value) {
      release();
      return;
    }
    await nextTick();
    if (!open.value || active) return;
    active = true;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", keydown);
    element.value?.querySelector<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)')?.focus();
  }, { flush: "post" });
  onBeforeUnmount(release);
}
