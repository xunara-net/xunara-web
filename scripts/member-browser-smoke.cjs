const assert = require('node:assert/strict');

// 仅由隔离组合夹具调用：使用真实邀请成员和真实 API，不修改调试站或输出任何凭据。
async function runMemberSmoke({ page, ownerContext, memberContext, origin, mark }) {
  const readUsers = async () => {
    const response = await ownerContext.request.get(origin + '/api/v1/users');
    assert.equal(response.status(), 200);
    return (await response.json()).users;
  };
  const users = await readUsers();
  const owner = users.find((user) => user.loginName === 'consolesmoke');
  const member = users.find((user) => user.loginName === 'browser-invited-member');
  assert.equal(owner?.role, 'owner');
  assert.equal(member?.role, 'member');
  assert.equal(typeof member.updatedAt, 'string');
  const row = (login) => page.locator('tbody tr').filter({ hasText: login });
  const chooseRole = async (login, role, statusCode) => {
    const answer = page.waitForResponse((response) => response.url().includes('/api/v1/users/') && response.request().method() === 'PATCH');
    page.once('dialog', (dialog) => dialog.accept());
    await row(login).locator('select').selectOption(role);
    const response = await answer;
    assert.equal(response.status(), statusCode);
    assert.equal(typeof response.request().postDataJSON().expectedUpdatedAt, 'string');
    return response;
  };
  const patchRole = async (context, user, role) => {
    const response = await context.request.patch(origin + '/api/v1/users/' + user.id,
      { data: { role, expectedUpdatedAt: user.updatedAt } });
    assert.equal(response.status(), 200);
    return response.json();
  };

  mark('member-role-real-publication-and-live-session-authority');
  await page.goto(origin + '/members');
  const promoted = await (await chooseRole(member.loginName, 'admin', 200)).json();
  assert.equal(promoted.role, 'admin');
  await row(member.loginName).locator('select').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((entry) => entry.textContent.includes('browser-invited-member') && entry.querySelector('select')?.value === 'admin'));
  assert.equal((await memberContext.request.get(origin + '/api/v1/auth/session').then((response) => response.json())).user.role, 'admin');
  assert.equal((await memberContext.request.get(origin + '/api/v1/member-invitations')).status(), 403);

  mark('member-stale-confirmation-conflicts-without-overwrite-or-retry');
  const externallyChanged = await patchRole(ownerContext, promoted, 'member');
  await chooseRole(member.loginName, 'owner', 409);
  await page.getByRole('alert').filter({ hasText: '本次修改未提交' }).waitFor();
  assert.equal(await row(member.loginName).locator('select').isDisabled(), true);
  assert.equal(await row(member.loginName).locator('select').inputValue(), 'admin');
  const stillMember = (await readUsers()).find((user) => user.id === member.id);
  assert.equal(stillMember.role, 'member');
  assert.equal(stillMember.updatedAt, externallyChanged.updatedAt);

  mark('member-explicit-refresh-requires-new-confirmation-on-mobile');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((entry) => entry.textContent.includes('browser-invited-member') && entry.querySelector('select')?.value === 'member' && !entry.querySelector('select')?.disabled));
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  }
  await chooseRole(member.loginName, 'admin', 200);

  mark('member-owner-handoff-removes-controls-and-cannot-self-promote');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((entry) => entry.textContent.includes('browser-invited-member') && entry.querySelector('select')?.value === 'admin'));
  await chooseRole(member.loginName, 'owner', 200);
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((entry) => entry.textContent.includes('consolesmoke') && !entry.querySelector('select')?.disabled));
  const demotedOwner = await (await chooseRole(owner.loginName, 'admin', 200)).json();
  await page.getByText('只有网络所有者可以修改成员角色。', { exact: false }).waitFor();
  assert.equal(await page.locator('tbody select').count(), 0);
  assert.equal((await ownerContext.request.patch(origin + '/api/v1/users/' + owner.id,
    { data: { role: 'owner', expectedUpdatedAt: demotedOwner.updatedAt } })).status(), 403);
  await patchRole(memberContext, demotedOwner, 'owner');
  const currentMember = (await readUsers()).find((user) => user.id === member.id);
  await patchRole(ownerContext, currentMember, 'member');
  await page.reload();
  await row(member.loginName).locator('select').waitFor();
  assert.equal(await row(owner.loginName).locator('select').isDisabled(), true);

  mark('member-missing-version-disables-writes-without-inventing-a-baseline');
  const actualUsers = await readUsers();
  let writes = 0;
  const countWrites = (request) => {
    if (request.url().includes('/api/v1/users/') && request.method() === 'PATCH') writes++;
  };
  page.on('request', countWrites);
  await page.route('**/api/v1/users', (route) => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ users: actualUsers.map((user) => user.id === member.id ? { ...user, updatedAt: undefined } : user) }) }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '缺少可确认的数据版本' }).waitFor();
  assert.equal(await row(member.loginName).locator('select').isDisabled(), true);
  assert.equal(writes, 0);
  await page.unroute('**/api/v1/users');
  page.off('request', countWrites);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((entry) => entry.textContent.includes('browser-invited-member') && !entry.querySelector('select')?.disabled));
}

module.exports = { runMemberSmoke };
