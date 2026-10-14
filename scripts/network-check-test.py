import importlib.util
import ipaddress
import contextlib
import io
from pathlib import Path
import unittest
import sys
import subprocess
from unittest.mock import patch

sys.dont_write_bytecode = True


spec = importlib.util.spec_from_file_location("network_check", str(Path(__file__).resolve().parent.parent / "public/network-check.py"))
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class NetworkCheckTests(unittest.TestCase):
    def test_local_quad100_conflict_blocks_even_without_dns_override(self):
        local = check.local_networks([{"ifname": "eth0", "addr_info": [{"local": "100.100.100.2", "prefixlen": 24}]}], [])
        self.assertTrue(check.conflicts(local, [ipaddress.ip_network("100.100.100.100/32")]))

    def test_explicit_apt_host_route_is_preserved(self):
        local = check.local_networks([], [{"dst": "100.100.100.100", "dev": "eth1"}])
        self.assertTrue(check.conflicts(local, [ipaddress.ip_network("100.100.100.100/32")]))

    def test_ipv6_dns_conflict_is_not_ignored(self):
        local = check.local_networks([{"ifname": "eth0", "addr_info": [{"local": "fd7a:115c:a1e0::1", "prefixlen": 64}]}], [])
        self.assertTrue(check.conflicts(local, [ipaddress.ip_network("fd7a:115c:a1e0::53/128")]))

    def test_unrelated_network_and_default_routes_do_not_block(self):
        local = check.local_networks([{"ifname": "eth0", "addr_info": [{"local": "192.168.1.2", "prefixlen": 24}]}],
                                    [{"dst": "default", "dev": "eth0"}, {"dst": "0.0.0.0/0", "dev": "eth0"}])
        self.assertFalse(check.conflicts(local, [ipaddress.ip_network("100.100.100.100/32")]))

    def test_existing_tailscale_interface_is_not_a_false_conflict(self):
        local = check.local_networks([{"ifname": "tailscale0", "addr_info": [{"local": "100.101.50.2", "prefixlen": 32}]}],
                                    [{"dst": "100.100.100.100/32", "dev": "tailscale0"}])
        self.assertFalse(check.conflicts(local, [ipaddress.ip_network("100.101.50.0/24")]))

    def test_secondary_pool_checks_ipv4_and_ipv6_families_separately(self):
        local = check.local_networks([], [{"dst": "192.168.60.0/24", "dev": "eth0"}, {"dst": "2001:db8::/64", "dev": "eth0"}])
        self.assertTrue(check.conflicts(local, [ipaddress.ip_network("192.168.60.0/24")]))

    def run_check(self, ranges, snapshots=None, failure=None):
        output = io.StringIO()
        errors = io.StringIO()
        with patch.object(sys, "argv", ["network-check.py"] + ranges), \
                patch.object(check, "ip_snapshot", side_effect=failure or snapshots or [[], [], []]) as read, \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            status = check.main()
        return status, output.getvalue(), errors.getvalue(), read.call_args_list

    def test_pool_conflict_stops_with_manual_migration_guidance(self):
        status, output, errors, calls = self.run_check(["192.168.60.0/24"],
            [[{"ifname": "eth0", "addr_info": [{"local": "192.168.60.2", "prefixlen": 24}]}], [], []])
        self.assertEqual(status, 1)
        self.assertEqual(output, "")
        self.assertIn("设备分配池 192.168.60.0/24", errors)
        self.assertIn("换默认池不会迁移旧 IP", errors)
        self.assertIn("再移除不用的冲突池", errors)
        self.assertNotIn("Quad100 冲突：", errors)
        self.assertEqual([call[0][0] for call in calls], [["address", "show"], ["-4", "route", "show", "table", "all"], ["-6", "route", "show", "table", "all"]])

    def test_quad100_conflict_does_not_suggest_that_changing_the_pool_solves_it(self):
        status, _, errors, _ = self.run_check(["100.101.50.0/24"],
            [[], [{"dev": "eth0", "dst": "100.100.100.100/32"}], []])
        self.assertEqual(status, 1)
        self.assertIn("客户端固定服务地址（Quad100）", errors)
        self.assertIn("更换默认地址池不能解决", errors)
        self.assertIn("不要仅关闭 MagicDNS / accept-dns", errors)
        self.assertNotIn("设备地址池冲突：", errors)

    def test_mixed_pool_and_quad100_conflicts_report_both_actions(self):
        status, _, errors, _ = self.run_check(["192.168.60.0/24"],
            [[], [{"dev": "eth0", "dst": "192.168.60.0/24"}], [{"dev": "eth1", "dst": "fd7a:115c:a1e0::/64"}]])
        self.assertEqual(status, 1)
        self.assertIn("设备地址池冲突：", errors)
        self.assertIn("Quad100 冲突：", errors)

    def test_no_overlap_reads_only_and_does_not_claim_all_connections_are_safe(self):
        status, output, errors, _ = self.run_check(["100.101.50.0/24"])
        self.assertEqual(status, 0)
        self.assertEqual(errors, "")
        self.assertIn("未修改 DNS、路由或客户端配置", output)
        self.assertIn("未覆盖旧池外的设备 IP", output)

    def test_read_failure_or_timeout_stops_without_assuming_an_empty_network(self):
        for failure in [OSError("ip unavailable"), ValueError("invalid JSON"), subprocess.TimeoutExpired("ip", 10)]:
            with self.subTest(failure=type(failure).__name__):
                status, output, errors, _ = self.run_check(["100.101.50.0/24"], failure=failure)
                self.assertEqual(status, 2)
                self.assertEqual(output, "")
                self.assertIn("未能确认网络安全，已停止接入", errors)

    def test_bad_or_excessive_ranges_stop_before_reading_the_machine(self):
        for ranges in [["not-a-cidr"], ["100.101.50.0/24"] * 130]:
            status, _, errors, calls = self.run_check(ranges)
            self.assertEqual(status, 2)
            self.assertEqual(calls, [])
            self.assertIn("已停止接入", errors)

    def test_unconfirmed_interface_data_does_not_pass_the_check(self):
        for addresses in [[{}], [{"ifname": "eth0", "addr_info": None}],
                          [{"ifname": "eth0", "addr_info": [{"local": "192.168.60.2"}]}]]:
            status, _, errors, _ = self.run_check(["192.168.60.0/24"], [addresses, [], []])
            self.assertEqual(status, 2)
            self.assertIn("已停止接入", errors)

    def test_ip_reader_has_a_timeout_and_rejects_unconfirmed_json(self):
        for output in ["invalid JSON", "{}", '["invalid entry"]']:
            with self.subTest(output=output), patch.object(check.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, output, "")) as process:
                with self.assertRaises(ValueError):
                    check.ip_snapshot(["address", "show"])
                process.assert_called_once_with(["ip", "-j", "address", "show"], stdout=subprocess.PIPE,
                                               stderr=subprocess.PIPE, universal_newlines=True, timeout=10)

    def test_ip_reader_propagates_failed_command_without_using_partial_output(self):
        with patch.object(check.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "[]", "failure")):
            with self.assertRaises(ValueError):
                check.ip_snapshot(["address", "show"])


if __name__ == "__main__":
    unittest.main()
