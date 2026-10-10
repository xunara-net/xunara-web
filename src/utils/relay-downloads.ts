// 固定到已发布且校验过的版本，不能用 latest 或浏览器架构替用户选择服务器程序。
const version = "v0.1.0-preview.1";
const repository = "https://github.com/xunara-net/xunara-relay";
const base = `${repository}/releases/download/${version}`;
export const relayRelease = {
  version,
  page: `${repository}/releases/tag/${version}`,
  checksums: `${base}/SHA256SUMS`,
  build: `${base}/BUILD.txt`,
  platforms: [
    { system: "Linux", architecture: "AMD64 / x86-64", name: "xunara-relay_linux_amd64" },
    { system: "Linux", architecture: "ARM64 / AArch64", name: "xunara-relay_linux_arm64" },
    { system: "Linux", architecture: "ARMv7（32 位）", name: "xunara-relay_linux_armv7" },
    { system: "macOS", architecture: "Intel x86-64", name: "xunara-relay_darwin_amd64" },
    { system: "macOS", architecture: "Apple Silicon ARM64", name: "xunara-relay_darwin_arm64" },
    { system: "Windows", architecture: "AMD64 / x86-64", name: "xunara-relay_windows_amd64.exe" },
    { system: "Windows", architecture: "ARM64", name: "xunara-relay_windows_arm64.exe" },
  ].map((target) => ({ ...target, url: `${base}/${target.name}` })),
};
