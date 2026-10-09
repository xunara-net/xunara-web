export function passwordChangeError(login: string, current: string, password: string, confirmation: string): string {
  if (!current) return "请输入当前密码";
  if ([...password].length < 12) return "新密码至少需要 12 个字符";
  if (new TextEncoder().encode(password).length > 72) return "新密码不能超过 72 字节（中文和表情会占多个字节）";
  if (password.trim().toLowerCase() === login.trim().toLowerCase()) return "新密码不能与登录名相同";
  if (password === current) return "新密码不能与当前密码相同";
  if (password !== confirmation) return "两次输入的新密码不一致";
  return "";
}
