#!/bin/sh
# 接入前只读检查：使用 Linux 常见工具，不依赖 Python、Node.js 或 root 权限。
# 退出码：0 表示本次检查通过，1 表示冲突，2 表示无法完成检查；均不修改网络。
set -u
LC_ALL=C
export LC_ALL
umask 077

stop_check() {
    printf '未能确认网络安全，已停止接入：%s。不会修改本机 DNS 或路由。\n' "$1" >&2
    exit 2
}

[ "$#" -le 129 ] || stop_check '待检查的网络数量过多'
for dependency in awk ip mktemp timeout rm cat; do
    command -v "$dependency" >/dev/null 2>&1 || stop_check '需要 iproute2、awk、mktemp 和 timeout 等基础工具'
done
work=$(mktemp -d "${TMPDIR:-/tmp}/xunara-network-check.XXXXXX") || stop_check '无法创建私有临时目录'
trap 'rm -rf -- "$work"' 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
: >"$work/ranges" || stop_check '无法保存待检查的网段'
for range in "$@"; do
    case "$range" in
        ''|*[!0-9a-fA-F:./]*) stop_check '待检查的 IP / CIDR 格式异常' ;;
    esac
    printf '%s\n' "$range" >>"$work/ranges" || stop_check '无法保存待检查的网段'
done

check_networks() {
    awk '
    function invalid_snapshot() {
        invalid = 1
        exit 2
    }
    function ipv4_words(address, output, pieces, count, part) {
        count = split(address, pieces, ".")
        if (count != 4) return 0
        for (part = 1; part <= 4; part++) {
            if (pieces[part] !~ /^[0-9]+$/ || length(pieces[part]) > 3 ||
                (length(pieces[part]) > 1 && substr(pieces[part], 1, 1) == "0") || pieces[part] + 0 > 255) return 0
        }
        output[1] = pieces[1] * 256 + pieces[2]
        output[2] = pieces[3] * 256 + pieces[4]
        return 1
    }
    function hex_word(value, position, digit, result) {
        if (!length(value) || length(value) > 4 || value !~ /^[0-9a-fA-F]+$/) return -1
        result = 0
        value = tolower(value)
        for (position = 1; position <= length(value); position++) {
            digit = index("0123456789abcdef", substr(value, position, 1)) - 1
            result = result * 16 + digit
        }
        return result
    }
    function ipv6_words(address, output, halves, left, right, dotted, half_count, left_count, right_count, position, word, last_colon) {
        if (index(address, ":::")) return 0
        if (index(address, ".")) {
            last_colon = 0
            for (position = 1; position <= length(address); position++) {
                if (substr(address, position, 1) == ":") last_colon = position
            }
            if (!last_colon || !ipv4_words(substr(address, last_colon + 1), dotted)) return 0
            address = substr(address, 1, last_colon) sprintf("%x:%x", dotted[1], dotted[2])
        }
        half_count = split(address, halves, "::")
        if (half_count > 2) return 0
        left_count = halves[1] == "" ? 0 : split(halves[1], left, ":")
        right_count = half_count == 2 && halves[2] != "" ? split(halves[2], right, ":") : 0
        if ((half_count == 1 && left_count != 8) || (half_count == 2 && left_count + right_count >= 8)) return 0
        for (position = 1; position <= 8; position++) output[position] = 0
        for (position = 1; position <= left_count; position++) {
            word = hex_word(left[position])
            if (word < 0) return 0
            output[position] = word
        }
        for (position = 1; position <= right_count; position++) {
            word = hex_word(right[position])
            if (word < 0) return 0
            output[8 - right_count + position] = word
        }
        return 1
    }
    function parse_network(value, output, pieces, count, address, maximum, entry) {
        for (entry in output) delete output[entry]
        if (length(value) > 128) return 0
        count = split(value, pieces, "/")
        if (count > 2 || !length(pieces[1])) return 0
        address = pieces[1]
        if (index(address, ":")) {
            output["family"] = 6
            maximum = 128
            if (!ipv6_words(address, output)) return 0
        } else {
            output["family"] = 4
            maximum = 32
            if (!ipv4_words(address, output)) return 0
        }
        if (count == 2 && (pieces[2] !~ /^[0-9]+$/ || length(pieces[2]) > 3 || pieces[2] + 0 > maximum)) return 0
        output["prefix"] = count == 2 ? pieces[2] + 0 : maximum
        return 1
    }
    # IPv6 分成八个 16 位数比较，避免 awk 浮点数丢失 128 位地址精度。
    function overlaps(local_net, target, remaining, position, factor) {
        if (local_net["family"] != networks[target, "family"]) return 0
        remaining = local_net["prefix"] < networks[target, "prefix"] ? local_net["prefix"] : networks[target, "prefix"]
        for (position = 1; remaining > 0; position++) {
            factor = remaining >= 16 ? 1 : 2 ^ (16 - remaining)
            if (int(local_net[position] / factor) != int(networks[target, position] / factor)) return 0
            remaining -= 16
        }
        return 1
    }
    function add_target(value, kind, parsed, entry, fixed) {
        if (!parse_network(value, parsed)) invalid_snapshot()
        for (fixed = 1; fixed <= 2 && fixed <= target_count; fixed++) {
            if (parsed["prefix"] == networks[fixed, "prefix"] && overlaps(parsed, fixed)) kind = "fixed"
        }
        target_count++
        for (entry in parsed) networks[target_count, entry] = parsed[entry]
        networks[target_count, "label"] = value
        networks[target_count, "kind"] = kind
    }
    function inspect_network(device, value, family, parsed, target, key, kind) {
        if (!parse_network(value, parsed) || (family && parsed["family"] != family)) invalid_snapshot()
        if (device ~ /^tailscale/) return
        for (target = 1; target <= target_count; target++) {
            if (!overlaps(parsed, target)) continue
            key = device SUBSEP value SUBSEP networks[target, "label"]
            if (seen[key]++) continue
            kind = networks[target, "kind"]
            if (kind == "fixed") fixed_conflict = 1
            else pool_conflict = 1
            reports[++report_count] = "  本地 " value " (" device ") 与 " \
                (kind == "fixed" ? "客户端固定服务地址（Quad100）" : "设备分配池") " " networks[target, "label"] " 重叠"
        }
    }
    BEGIN {
        # Quad100 是客户端固定服务地址，关闭 accept-dns 不能保证不会接管它。
        add_target("100.100.100.100/32", "fixed")
        add_target("fd7a:115c:a1e0::53/128", "fixed")
    }
    snapshot == "" {
        add_target($0, "pool")
        next
    }
    NF == 0 { next }
    snapshot == "address" {
        if (NF < 4 || $1 !~ /^[0-9]+:$/ || ($3 != "inet" && $3 != "inet6")) invalid_snapshot()
        device = $2
        sub(/@.*/, "", device)
        if (!length(device)) invalid_snapshot()
        family = $3 == "inet" ? 4 : 6
        address = $4
        # 点对点接口可能把前缀放在 peer 后；本地端与对端都必须检查。
        if ($5 == "peer") {
            if (NF < 6 || !index($6, "/") || !parse_network($6, peer) || peer["family"] != family) invalid_snapshot()
            if (!index(address, "/")) address = address "/" peer["prefix"]
            inspect_network(device, $6, family)
        }
        if (!index(address, "/")) invalid_snapshot()
        inspect_network(device, address, family)
        next
    }
    snapshot == "route4" || snapshot == "route6" {
        destination = $1 ~ /^(unicast|local|broadcast|multicast|anycast|throw|unreachable|prohibit|blackhole|nat)$/ ? $2 : $1
        family = snapshot == "route4" ? 4 : 6
        if (destination != "default" && (!parse_network(destination, route) || route["family"] != family)) invalid_snapshot()
        device_count = 0
        for (entry in devices) delete devices[entry]
        for (position = 2; position <= NF; position++) {
            if ($position != "dev") continue
            if (position == NF || $(position + 1) == "\\") invalid_snapshot()
            devices[++device_count] = $(position + 1)
        }
        if (destination == "default" || route["prefix"] == 0) next
        # blackhole / nhid 路由可能没有 dev；多路径路由逐一检查，不能误跳过其他 VPN。
        if (!device_count) inspect_network("路由", destination, family)
        for (position = 1; position <= device_count; position++) inspect_network(devices[position], destination, family)
        next
    }
    { invalid_snapshot() }
    END {
        # 先验证全部快照，再输出结果；格式异常绝不降级为“没有冲突”。
        if (invalid) exit 2
        if (mode == "validate") exit 0
        if (report_count) {
            print "发现网络冲突，已停止接入，避免本地服务/软件源成为黑洞："
            for (position = 1; position <= report_count; position++) print reports[position]
            if (pool_conflict) print "设备地址池冲突：在「我的网络 → 修改分配网段」选择不与各设备局域网、其他 VPN 和子网路由重叠的网段。换默认池不会迁移旧 IP，原池也可能仍是附加池；请逐台迁移旧设备 IP、核对 ACL/应用/DNS，再移除不用的冲突池。"
            if (fixed_conflict) print "Quad100 冲突：更换默认地址池不能解决。请调整本地服务地址，或由管理员另行验证独立网络命名空间 / userspace 方案；这不是可在控制台更换的 DNS IP。"
            print "不要仅关闭 MagicDNS / accept-dns 后强行接入。已接入且本地网络失联时，先准备本地控制台或备用连接，再在受影响设备执行 sudo tailscale down；不会在此自动执行。"
            exit 1
        }
        print "本地地址/显式路由与给定地址池及 Quad100 的重叠检查通过；未修改 DNS、路由或客户端配置。未覆盖旧池外的设备 IP、未给定的子网路由或无显式本地路由的外部服务，不能代替接入后实测。"
    }
    ' "$@"
}

# 参数先验证，再读取本机；超时、非零返回或部分输出均视为检查失败。
check_networks mode=validate "$work/ranges" >"$work/validation" 2>"$work/error" || stop_check '待检查的 IP / CIDR 格式异常'
timeout -s KILL 10 ip -o address show >"$work/address" 2>"$work/error" || stop_check '接口快照读取失败或超时'
timeout -s KILL 10 ip -o -4 route show table all >"$work/route4" 2>"$work/error" || stop_check 'IPv4 路由读取失败或超时'
timeout -s KILL 10 ip -o -6 route show table all >"$work/route6" 2>"$work/error" || stop_check 'IPv6 路由读取失败或超时'
check_networks mode=scan "$work/ranges" snapshot=address "$work/address" \
    snapshot=route4 "$work/route4" snapshot=route6 "$work/route6" >"$work/report" 2>"$work/error"
result=$?
case "$result" in
    0) cat "$work/report" || stop_check '无法读取检查结果' ;;
    1) cat "$work/report" >&2 || stop_check '无法读取检查结果' ;;
    *) stop_check '本机网络快照格式异常' ;;
esac
exit "$result"
