import { errorMessage } from "../api/client";
import type { PasskeyCreationOptionsJSON, PasskeyRequestOptionsJSON, PasskeyCredentialJSON } from "../api/types";

export function passkeyAvailability(): { supported: boolean; reason: string } {
  if (!window.isSecureContext) return { supported: false, reason: "当前页面不是安全连接，请通过 HTTPS 访问后使用通行密钥。" };
  if (typeof PublicKeyCredential === "undefined" || !navigator.credentials?.create || !navigator.credentials?.get) {
    return { supported: false, reason: "当前浏览器不支持通行密钥，请使用新版浏览器或其他登录方式。" };
  }
  return { supported: true, reason: "" };
}

export function decodeBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

export function encodeBase64Url(value: ArrayBuffer): string {
  let binary = "";
  for (const byteValue of new Uint8Array(value)) binary += String.fromCharCode(byteValue);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// 不直接修改服务端 JSON 快照，避免重试时把已经解码的 Buffer 当成 base64url。
export function creationOptions(options: PasskeyCreationOptionsJSON): PublicKeyCredentialCreationOptions {
  return {
    ...options, challenge: decodeBase64Url(options.challenge),
    user: { ...options.user, id: decodeBase64Url(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map((credential) => ({ ...credential, id: decodeBase64Url(credential.id) })),
  };
}

export function requestOptions(options: PasskeyRequestOptionsJSON): PublicKeyCredentialRequestOptions {
  return {
    ...options, challenge: decodeBase64Url(options.challenge),
    allowCredentials: options.allowCredentials?.map((credential) => ({ ...credential, id: decodeBase64Url(credential.id) })),
  };
}

function publicKeyCredential(credential: Credential | null): PublicKeyCredential {
  if (!credential || credential.type !== "public-key") throw new Error("没有取得通行密钥响应，请重新尝试。");
  return credential as PublicKeyCredential;
}

function credentialFields(credential: PublicKeyCredential) {
  return {
    id: credential.id, rawId: encodeBase64Url(credential.rawId), type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

export async function createPasskey(options: PasskeyCreationOptionsJSON, signal: AbortSignal): Promise<PasskeyCredentialJSON> {
  const credential = publicKeyCredential(await navigator.credentials.create({ publicKey: creationOptions(options), signal }));
  const response = credential.response as AuthenticatorAttestationResponse;
  return { ...credentialFields(credential), response: {
    clientDataJSON: encodeBase64Url(response.clientDataJSON),
    attestationObject: encodeBase64Url(response.attestationObject),
    transports: typeof response.getTransports === "function" ? response.getTransports() : [],
  } };
}

export async function getPasskey(options: PasskeyRequestOptionsJSON, signal: AbortSignal): Promise<PasskeyCredentialJSON> {
  const credential = publicKeyCredential(await navigator.credentials.get({ publicKey: requestOptions(options), signal }));
  const response = credential.response as AuthenticatorAssertionResponse;
  return { ...credentialFields(credential), response: {
    clientDataJSON: encodeBase64Url(response.clientDataJSON),
    authenticatorData: encodeBase64Url(response.authenticatorData), signature: encodeBase64Url(response.signature),
    userHandle: response.userHandle === null ? null : encodeBase64Url(response.userHandle),
  } };
}

export function passkeyErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "NotAllowedError") return "操作已取消、超时或未获设备许可，账户未发生变更。请重试。";
    if (err.name === "InvalidStateError") return "这台设备可能已经保存此账户的通行密钥，请使用已有密钥或换一台设备。";
    if (err.name === "SecurityError") return "通行密钥的站点域名配置不匹配，请联系管理员检查 HTTPS、RP ID 和允许的来源。";
    if (err.name === "AbortError") return "通行密钥操作已取消，请重新开始。";
  }
  return errorMessage(err);
}
