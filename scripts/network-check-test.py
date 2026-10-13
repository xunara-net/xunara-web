import importlib.util
import ipaddress
from pathlib import Path
import unittest
import sys

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


if __name__ == "__main__":
    unittest.main()
