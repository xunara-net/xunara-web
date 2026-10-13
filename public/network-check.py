#!/usr/bin/env python3
"""接入前只读检查：遇到本地地址/路由冲突时退出，禁止随后接管网络。"""

import ipaddress
import json
import subprocess
import sys


def ip_snapshot(arguments):
    result = subprocess.run(["ip", "-j"] + arguments, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, universal_newlines=True, timeout=10)
    if result.returncode != 0:
        raise ValueError("无法读取本机网络，需要 iproute2 的 JSON 支持")
    data = json.loads(result.stdout)
    if not isinstance(data, list):
        raise ValueError("本机网络快照格式异常")
    return data


def local_networks(addresses, routes):
    found = set()
    for interface in addresses:
        device = interface.get("ifname", "")
        if device.startswith("tailscale"):
            continue
        for address in interface.get("addr_info", []):
            value = address.get("local")
            bits = address.get("prefixlen")
            if value is not None and bits is not None:
                found.add((device, ipaddress.ip_network("{}/{}".format(value, bits), strict=False)))
    for route in routes:
        device = route.get("dev", "")
        destination = route.get("dst", "default")
        if device.startswith("tailscale") or destination == "default":
            continue
        network = ipaddress.ip_network(destination, strict=False)
        if network.prefixlen:
            found.add((device, network))
    return found


def conflicts(local, remote):
    return sorted({(device, str(existing), str(wanted))
                   for device, existing in local for wanted in remote
                   if existing.version == wanted.version and existing.overlaps(wanted)})


def main():
    try:
        # Quad100 由客户端固定使用。关闭 accept-dns 也不能承诺取消这个目的地址的接管。
        remote = [ipaddress.ip_network("100.100.100.100/32"),
                  ipaddress.ip_network("fd7a:115c:a1e0::53/128")]
        if len(sys.argv) > 130:
            raise ValueError("待检查的网络数量过多")
        remote.extend(ipaddress.ip_network(value, strict=False) for value in sys.argv[1:])
        addresses = ip_snapshot(["address", "show"])
        routes = ip_snapshot(["-4", "route", "show", "table", "all"]) + \
            ip_snapshot(["-6", "route", "show", "table", "all"])
        found = conflicts(local_networks(addresses, routes), remote)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print("未能确认网络安全，已停止接入：{}。不会修改本机 DNS 或路由。".format(error), file=sys.stderr)
        return 2
    if found:
        print("发现网络冲突，已停止接入，避免本地服务/软件源成为黑洞：", file=sys.stderr)
        for device, existing, wanted in found:
            print("  本地 {} ({}) 与 {} 重叠".format(existing, device or "路由", wanted), file=sys.stderr)
        print("请换设备地址池、调整本地地址，或使用经验证的 userspace 模式。"
              "不要仅关闭 accept-dns 后强行接入；服务端不能替官方客户端更改 Quad100。", file=sys.stderr)
        return 1
    print("本地地址/显式路由检查通过；未修改 DNS、路由或客户端配置。"
          "该检查不保证发现未配置本地路由的外部服务冲突，也不能代替接入后实测。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
