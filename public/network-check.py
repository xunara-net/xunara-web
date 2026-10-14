#!/usr/bin/env python3
"""接入前只读检查：遇到本地地址/路由冲突时退出，禁止随后接管网络。"""

import ipaddress
import json
import subprocess
import sys

QUAD100_NETWORKS = (ipaddress.ip_network("100.100.100.100/32"),
                    ipaddress.ip_network("fd7a:115c:a1e0::53/128"))


def ip_snapshot(arguments):
    result = subprocess.run(["ip", "-j"] + arguments, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, universal_newlines=True, timeout=10)
    if result.returncode != 0:
        raise ValueError("无法读取本机网络，需要 iproute2 的 JSON 支持")
    data = json.loads(result.stdout)
    if not isinstance(data, list) or any(not isinstance(entry, dict) for entry in data):
        raise ValueError("本机网络快照格式异常")
    return data


def local_networks(addresses, routes):
    found = set()
    for interface in addresses:
        device = interface.get("ifname", "")
        if not isinstance(device, str) or not device:
            raise ValueError("本机接口名称未确认")
        if device.startswith("tailscale"):
            continue
        entries = interface.get("addr_info")
        if not isinstance(entries, list) or any(not isinstance(entry, dict) for entry in entries):
            raise ValueError("本机接口地址格式异常")
        for address in entries:
            value = address.get("local")
            bits = address.get("prefixlen")
            if not isinstance(value, str) or type(bits) is not int:
                raise ValueError("本机接口地址或前缀未确认")
            found.add((device, ipaddress.ip_network("{}/{}".format(value, bits), strict=False)))
    for route in routes:
        device = route.get("dev", "")
        if not isinstance(device, str):
            raise ValueError("本机路由接口格式异常")
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
        remote = list(QUAD100_NETWORKS)
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
        fixed = {str(network) for network in QUAD100_NETWORKS}
        for device, existing, wanted in found:
            kind = "客户端固定服务地址（Quad100）" if wanted in fixed else "设备分配池"
            print("  本地 {} ({}) 与 {} {} 重叠".format(existing, device or "路由", kind, wanted), file=sys.stderr)
        if any(wanted not in fixed for _, _, wanted in found):
            print("设备地址池冲突：在「我的网络 → 修改分配网段」选择不与各设备局域网、其他 VPN 和子网路由重叠的网段。"
                  "换默认池不会迁移旧 IP，原池也可能仍是附加池；请逐台迁移旧设备 IP、核对 ACL/应用/DNS，"
                  "再移除不用的冲突池。", file=sys.stderr)
        if any(wanted in fixed for _, _, wanted in found):
            print("Quad100 冲突：更换默认地址池不能解决。请调整本地服务地址，或由管理员另行验证独立网络命名空间 / userspace 方案；"
                  "这不是可在控制台更换的 DNS IP。", file=sys.stderr)
        print("不要仅关闭 MagicDNS / accept-dns 后强行接入。已接入且本地网络失联时，"
              "先准备本地控制台或备用连接，再在受影响设备执行 sudo tailscale down；不会在此自动执行。", file=sys.stderr)
        return 1
    print("本地地址/显式路由与给定地址池及 Quad100 的重叠检查通过；未修改 DNS、路由或客户端配置。"
          "未覆盖旧池外的设备 IP、未给定的子网路由或无显式本地路由的外部服务，不能代替接入后实测。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
