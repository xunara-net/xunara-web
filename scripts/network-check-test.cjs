const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, symlinkSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const script = resolve(__dirname, '../public/network-check.sh');
const readCommands = ['-o address show', '-o -4 route show table all', '-o -6 route show table all'];
const address4 = (cidr, device = 'eth0') => `2: ${device}    inet ${cidr} scope global ${device}\\       valid_lft forever preferred_lft forever\n`;
const address6 = (cidr, device = 'eth0') => `2: ${device}    inet6 ${cidr} scope global \\       valid_lft forever preferred_lft forever\n`;

function check(ranges = ['100.101.50.0/24'], fixture = {}, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'xunara-shell-network-test-'));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  for (const snapshot of ['address', 'route4', 'route6']) writeFileSync(join(directory, snapshot), fixture[snapshot] ?? '');
  // 假 ip 只接受三条只读命令；任何修改命令都导致测试失败。
  writeFileSync(join(bin, 'ip'), `#!/bin/sh
printf '%s\\n' "$*" >>"$FIXTURES/calls"
case "$*" in
  '-o address show') snapshot=address ;;
  '-o -4 route show table all') snapshot=route4 ;;
  '-o -6 route show table all') snapshot=route6 ;;
  *) exit 99 ;;
esac
[ "$*" != "$TEST_HANG_COMMAND" ] || exec sleep 30
cat "$FIXTURES/$snapshot"
[ "$*" != "$TEST_FAIL_COMMAND" ] || exit 1
`, { mode: 0o700 });
  if (options.missing) {
    for (const dependency of ['awk', 'mktemp', 'timeout', 'rm', 'cat']) {
      if (dependency === options.missing) continue;
      const executable = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'lookup', dependency], { encoding: 'utf8' }).stdout.trim();
      assert.ok(executable.startsWith('/'), dependency + ' is required by the test host');
      symlinkSync(executable, join(bin, dependency));
    }
    if (options.missing === 'ip') rmSync(join(bin, 'ip'));
  }
  try {
    const result = spawnSync(options.shell ?? '/bin/sh', options.stdin ? ['-s', '--', ...ranges] : [script, ...ranges], {
      input: options.stdin ? readFileSync(script) : undefined,
      env: { ...process.env, PATH: options.missing ? bin : bin + ':' + process.env.PATH,
        TMPDIR: directory, FIXTURES: directory, TEST_FAIL_COMMAND: options.fail ?? '', TEST_HANG_COMMAND: options.hang ?? '' },
      encoding: 'utf8', timeout: 16000,
    });
    assert.equal(result.error, undefined);
    const calls = existsSync(join(directory, 'calls')) ? readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n') : [];
    assert.equal(readdirSync(directory).some((name) => name.startsWith('xunara-network-check.')), false, 'private snapshots must be removed');
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function blocked(result, status = 2) {
  assert.equal(result.status, status);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes('已停止接入'));
}

test('valid POSIX shell syntax, no Python or JSON runtime', () => {
  assert.equal(spawnSync('/bin/sh', ['-n', script]).status, 0);
  const source = readFileSync(script, 'utf8');
  assert.ok(source.startsWith('#!/bin/sh\n'));
  assert.doesNotMatch(source, /(?:python[0-9]*|node)\s+-|ip -j|ip (?:route|address) (?:add|del|flush)/i);
});

for (const shell of ['/bin/sh', '/bin/bash']) {
  test(`${shell}: pipe/stdin invocation preserves CIDR arguments and conflict status`, () => {
    const result = check(['192.168.60.0/24'], { address: address4('192.168.60.2/24') }, { shell, stdin: true });
    blocked(result, 1);
    assert.ok(result.stderr.includes('设备分配池 192.168.60.0/24'));
    assert.ok(result.stderr.includes('换默认池不会迁移旧 IP'));
    assert.ok(result.stderr.includes('再移除不用的冲突池'));
    assert.ok(!result.stderr.includes('Quad100 冲突：'));
    assert.deepEqual(result.calls, readCommands);
  });
}

test('Quad100 IPv4 LAN and single-host APT routes block even without DNS override', () => {
  for (const fixture of [{ address: address4('100.100.100.2/24') }, { route4: '100.100.100.100 via 10.0.0.1 dev eth1\n' }]) {
    const result = check(undefined, fixture);
    blocked(result, 1);
    assert.ok(result.stderr.includes('客户端固定服务地址（Quad100）'));
    assert.ok(result.stderr.includes('更换默认地址池不能解决'));
    assert.ok(result.stderr.includes('不要仅关闭 MagicDNS / accept-dns'));
    assert.ok(!result.stderr.includes('设备地址池冲突：'));
  }
});

test('compressed, expanded and case-insensitive Quad100 IPv6 remain protected', () => {
  for (const cidr of ['fd7a:115c:a1e0::1/64', 'FD7A:115C:A1E0:0:0:0:0:53/128', 'fd7a:115c:a1e0::52/127']) {
    blocked(check(undefined, { address: address6(cidr) }), 1);
  }
  blocked(check(undefined, { route6: 'fd7a:115c:a1e0::53 dev eth1 metric 1024 pref medium\n' }), 1);
});

test('mixed pool and Quad100 conflicts report separate remedies', () => {
  const result = check(['192.168.60.0/24'], { route4: '192.168.60.0/24 dev eth0\n', route6: 'fd7a:115c:a1e0::/64 dev eth1\n' });
  blocked(result, 1);
  assert.ok(result.stderr.includes('设备地址池冲突：'));
  assert.ok(result.stderr.includes('Quad100 冲突：'));
});

test('secondary IPv4 and IPv6 pools are checked without mixing address families', () => {
  blocked(check(['10.0.0.0/24', '192.168.60.0/24'], { address: address4('192.168.60.3/24') }), 1);
  blocked(check(['2001:db8:1234::/64'], { route6: '2001:db8:1234::1234 dev eth0\n' }), 1);
  assert.equal(check(['2001:db8::/64'], { address: address4('32.1.13.184/32') }).status, 0);
});

test('IPv6 precision, partial-word masks and IPv4-embedded IPv6', () => {
  blocked(check(['2001:db8::/127'], { address: address6('2001:db8::1/128') }), 1);
  assert.equal(check(['2001:db8::/127'], { address: address6('2001:db8::2/128') }).status, 0);
  blocked(check(['2001:db8::8000/113'], { address: address6('2001:db8::ffff/128') }), 1);
  assert.equal(check(['2001:db8::8000/113'], { address: address6('2001:db8::7fff/128') }).status, 0);
  blocked(check(['::ffff:192.168.1.0/120'], { address: address6('::ffff:c0a8:102/128') }), 1);
  assert.equal(check(['::ffff:192.168.1.0/120'], { address: address6('::ffff:c0a8:202/128') }).status, 0);
});

test('unrelated networks, default routes and existing Tailscale interfaces do not falsely block', () => {
  const result = check(undefined, {
    address: address4('192.168.1.2/24', 'eth0@if3') + address4('100.101.50.2/32', 'tailscale0') + address6('fd7a:115c:a1e0::2/64', 'tailscale0'),
    route4: 'default via 192.168.1.1 dev eth0\n0.0.0.0/0 dev eth0\n100.100.100.100 dev tailscale0 table 52\n',
    route6: 'unreachable default dev lo table 123 pref medium\n::/0 dev eth0\nfd7a:115c:a1e0::/48 dev tailscale0 table 52\n',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('未修改 DNS、路由或客户端配置'));
  assert.ok(result.stdout.includes('未覆盖旧池外的设备 IP'));
  assert.deepEqual(result.calls, readCommands);
});

test('point-to-point peer addresses retain their actual prefix', () => {
  blocked(check(['192.168.60.0/24'], { address: '4: ppp0 inet 192.168.60.2 peer 192.168.60.3/32 scope global ppp0\n' }), 1);
  blocked(check(undefined, { address: '4: ppp0 inet 10.0.0.2 peer 100.100.100.100/32 scope global ppp0\n' }), 1);
});

test('route types without dev, multiple tables and mixed multipath next hops remain checked', () => {
  for (const type of ['local', 'broadcast', 'multicast', 'anycast', 'throw', 'unreachable', 'prohibit', 'blackhole', 'nat', 'unicast']) {
    blocked(check(undefined, { route4: `${type} 100.100.100.100 table 123\n` }), 1);
  }
  blocked(check(undefined, { route4: '100.100.100.100 nhid 23 table 123\n' }), 1);
  blocked(check(undefined, { route4: '100.100.100.100 proto static \\ nexthop via 10.0.0.1 dev tailscale0 weight 1 \\ nexthop via 192.168.0.1 dev eth0 weight 1\n' }), 1);
  assert.equal(check(undefined, { route4: '100.100.100.100 \\ nexthop dev tailscale0 weight 1 \\ nexthop dev tailscale1 weight 1\n' }).status, 0);
});

test('default target pools cover their family and no arguments still check fixed service addresses', () => {
  blocked(check(['0.0.0.0/0'], { address: address4('192.168.1.2/24') }), 1);
  blocked(check(['::/0'], { address: address6('2001:db8::1/64') }), 1);
  blocked(check([], { address: address4('100.100.100.2/24') }), 1);
  assert.equal(check([], {}).status, 0);
});

test('invalid or excessive CIDRs fail before reading any interface', () => {
  for (const ranges of [[''], ['not-a-cidr'], ['1.2.3.256/24'], ['01.2.3.4/24'], ['10.0.0.0/33'], ['::/129'],
    ['::1/'], [':::/64'], ['1:2:3:4:5:6:7/64'], ['1:2:3:4:5:6:7:8:9/64'], ['1::2::3/64'], ['::ffff:300.1.2.3/128'],
    ['::ffff:192.168.1.1:abcd/128'], ['fe80::1%eth0/64'], ['10.0.0.0/24\n192.168.0.0/16'], Array(130).fill('10.0.0.0/24')]) {
    const result = check(ranges);
    blocked(result);
    assert.deepEqual(result.calls, []);
  }
});

test('malformed snapshots fail closed rather than becoming empty networks', () => {
  for (const fixture of [{ address: 'unexpected output\n' }, { address: '2: eth0 inet 10.0.0.1\n' },
    { address: '2: eth0 inet6 10.0.0.1/24\n' }, { address: '2: eth0 inet6 ::1/129\n' },
    { address: '2: eth0 inet 10.0.0.1 peer invalid\n' }, { route4: 'invalid route\n' },
    { route4: 'fd7a:115c:a1e0::53 dev eth0\n' }, { route6: '10.0.0.0/24 dev eth0\n' },
    { route4: '100.100.100.100 dev\n' }, { route6: 'default dev\n' }]) blocked(check(undefined, fixture));
  const result = check(undefined, { address: address4('100.100.100.2/24'), route6: 'malformed\n' });
  blocked(result);
  assert.ok(!result.stderr.includes('检查通过'));
});

test('a failing ip reader discards partial output and stops later readers', () => {
  for (const [position, command] of readCommands.entries()) {
    const result = check(undefined, { address: address4('192.168.1.2/24') }, { fail: command });
    blocked(result);
    assert.deepEqual(result.calls, readCommands.slice(0, position + 1));
  }
});

test('missing dependencies stop without reading or modifying networks', () => {
  for (const missing of ['ip', 'awk', 'mktemp', 'timeout', 'cat']) {
    const result = check(undefined, {}, { missing });
    blocked(result);
    assert.deepEqual(result.calls, []);
  }
});

test('a hung ip reader is killed by the real timeout and cannot allow enrollment', { timeout: 17000 }, () => {
  const started = Date.now();
  const result = check(undefined, {}, { hang: readCommands[0] });
  blocked(result);
  assert.ok(Date.now() - started >= 9500 && Date.now() - started < 15500);
  assert.deepEqual(result.calls, [readCommands[0]]);
});
