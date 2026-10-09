export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // HTTP 调试入口或浏览器权限可能拒绝现代 API，只在用户点击时尝试旧复制路径。
    }
  }
  const previousFocus = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("浏览器拒绝复制，请选中内容手动复制");
  } finally {
    input.remove();
    previousFocus?.focus();
  }
}
