const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

async function browserRequest(page, endpoint) {
  return page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
    return { status: response.status, body: await response.json() };
  }, endpoint);
}

// 仅由隔离的浏览器夹具调用；数据库路径不得指向部署实例。
async function runLoginHistorySmoke({ page, origin, databaseFile, mark, restart }) {
  assert.match(databaseFile, /^\/tmp\/xunara-(?:authentication|console)-smoke-[^/]+\/(?:portal\/)?state\.db$/);
  mark('login-history-captures-real-browser-source-and-mobile-session-cards');
  const snapshot = await browserRequest(page, '/api/v1/auth/session');
  assert.equal(snapshot.status, 200); assert.equal(snapshot.body.authenticated, true);
  const ownerID = snapshot.body.user.id;
  const currentID = snapshot.body.session.id;
  const active = await browserRequest(page, '/api/v1/account/sessions');
  assert.equal(active.status, 200);
  const current = active.body.sessions.find((entry) => entry.id === currentID);
  assert.equal(!!current, true); assert.equal(current.client_ip, '127.0.0.1');
  assert.match(current.user_agent, /Chrome\//); assert.equal(!!current.last_seen_at, true);
  await page.goto(origin + '/security');
  await page.getByRole('heading', { name: '活动登录', exact: false }).waitFor();
  await page.locator('.session-card').first().getByText('当前浏览器', { exact: true }).waitFor();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.equal(await page.locator('.session-card').first().getByRole('button', { name: '退出当前登录', exact: true }).isVisible(), true);
  }

  mark('login-history-keyset-pages-use-isolated-fixtures-and-keep-old-source-unknown');
  const synthetic = [];
  const now = BigInt(Date.now()) * 1000000n;
  const database = new DatabaseSync(databaseFile);
  try {
    // 分页样本不是新的真实认证，不绕过或重置密码登录限流来凑记录。
    const insert = database.prepare(`INSERT INTO sessions (id, token_hash, user_id, auth_method,
      created_at, expires_at, last_seen_at, client_ip, user_agent) VALUES (?, ?, ?, 'local', ?, ?, ?, '192.0.2.20', 'Firefox/130 Linux')`);
    database.exec('BEGIN IMMEDIATE');
    for (let index = 0; index < 12; index++) {
      const id = crypto.randomBytes(32).toString('base64url');
      synthetic.push(id);
      insert.run(id, crypto.randomBytes(32).toString('hex'), ownerID, now - BigInt(index + 1), now + 3600000000000n, now);
    }
    database.prepare(`INSERT INTO account_login_records (id, user_id, auth_method, kind, created_at, expires_at)
      VALUES (?, ?, 'local', 'legacy', ?, ?)`).run(crypto.randomBytes(32).toString('base64url'), ownerID, now - 172800000000000n, now - 86400000000000n);
    database.exec('COMMIT');
  } finally { database.close(); }
  const first = await browserRequest(page, '/api/v1/account/login-history?limit=10');
  assert.equal(first.status, 200); assert.equal(first.body.records.length, 10); assert.equal(!!first.body.next_cursor, true);
  const second = await browserRequest(page, '/api/v1/account/login-history?limit=10&cursor=' + encodeURIComponent(first.body.next_cursor));
  assert.equal(second.status, 200);
  const seen = new Set(first.body.records.map((record) => record.id));
  for (const record of second.body.records) assert.equal(seen.has(record.id), false);
  assert.equal(second.body.records.some((record) => record.kind === 'legacy' && !record.client_ip && !record.user_agent), true);
  assert.equal((await browserRequest(page, '/api/v1/account/login-history?user_id=' + (ownerID + 1))).status, 400);
  await page.locator('.login-history > summary').click();
  await page.getByText('第 1 页 · 10 条', { exact: true }).waitFor();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByText('旧记录', { exact: true }).waitFor();
  await page.locator('.history-record').filter({ hasText: '旧记录' }).getByText('未记录客户端', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await page.getByText('第 1 页 · 10 条', { exact: true }).waitFor();

  mark('login-history-read-errors-keep-last-confirmed-page-and-retry-explicitly');
  const unavailable = '**/api/v1/account/login-history?**';
  await page.route(unavailable, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'LOGIN_HISTORY_FAILED: isolated read failure' }) }));
  await page.getByRole('button', { name: '刷新最新记录', exact: true }).click();
  await page.getByText('以下保留上次成功读取的记录', { exact: false }).waitFor();
  assert.equal(await page.locator('.history-record').count(), 10);
  await page.unroute(unavailable);
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await page.getByText('以下保留上次成功读取的记录', { exact: false }).waitFor({ state: 'detached' });

  mark('login-history-activity-fails-closed-keeps-cookie-and-does-not-extend-expiry');
  const cookies = await page.context().cookies(origin);
  const stale = new DatabaseSync(databaseFile);
  try {
    stale.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now - 120000000000n, currentID);
    stale.exec("CREATE TRIGGER login_history_activity_fault BEFORE UPDATE ON account_login_records BEGIN SELECT RAISE(IGNORE); END");
  } finally { stale.close(); }
  assert.equal((await browserRequest(page, '/api/v1/auth/session')).status, 503);
  assert.deepEqual(await page.context().cookies(origin), cookies);
  const recovered = new DatabaseSync(databaseFile);
  try { recovered.exec('DROP TRIGGER login_history_activity_fault'); } finally { recovered.close(); }
  const updated = await browserRequest(page, '/api/v1/account/sessions');
  const updatedCurrent = updated.body.sessions.find((entry) => entry.id === currentID);
  assert.equal(updated.status, 200); assert.equal(updatedCurrent.expires_at, current.expires_at);
  assert.equal(Date.parse(updatedCurrent.last_seen_at) >= Number(now / 1000000n), true);

  mark('login-history-survives-expired-session-removal-and-mirrors-revocation');
  const cleanup = new DatabaseSync(databaseFile);
  try {
    cleanup.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(now - 1n, synthetic[0]);
    cleanup.prepare('DELETE FROM sessions WHERE id = ? AND expires_at < ?').run(synthetic[0], now);
    assert.equal(!!cleanup.prepare('SELECT id FROM account_login_records WHERE id = ?').get(synthetic[0]), true);
    assert.equal(cleanup.prepare('PRAGMA table_info(account_login_records)').all().some((column) => /token|hash/.test(column.name)), false);
  } finally { cleanup.close(); }
  await page.reload();
  await page.getByRole('button', { name: '退出其他登录', exact: true }).waitFor({ state: 'visible' });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '退出其他登录', exact: true }).click();
  await page.getByRole('button', { name: '退出其他登录', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === '退出其他登录' && button.disabled));
  const history = await browserRequest(page, '/api/v1/account/login-history?limit=100');
  const expired = history.body.records.find((record) => record.id === synthetic[0]);
  assert.equal(expired.status, 'expired');
  assert.equal(history.body.records.filter((record) => synthetic.slice(1).includes(record.id)).every((record) => record.status === 'revoked' && record.revoked_reason === 'signed out other sessions'), true);
  assert.equal((await browserRequest(page, '/api/v1/auth/session')).body.authenticated, true);
  if (restart) {
    mark('login-history-and-original-human-session-survive-real-daemon-restart');
    const ids = history.body.records.map((record) => record.id);
    await restart();
    const restarted = await browserRequest(page, '/api/v1/account/login-history?limit=100');
    assert.equal(restarted.status, 200); assert.deepEqual(restarted.body.records.map((record) => record.id), ids);
    assert.equal(restarted.body.current_session_id, currentID);
  }
}

module.exports = { runLoginHistorySmoke };
