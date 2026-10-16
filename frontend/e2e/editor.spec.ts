import {
  test,
  expect,
  addMember,
  createComment,
  createPage,
  deleteComment,
  ensureWorkspace,
  getDocument,
  listComments,
  pageCollabPath,
  registerUser,
  sidebarPage,
  uniqueEmail,
  updateComment,
  updateMe,
  workspaceEventsPath,
  PASSWORD,
} from './fixtures'

test.describe('editor and live workspace (F5, F6, F7, F10, F14, F16)', () => {
  test('types, uses the slash menu and imports markdown', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Draft' })
    const collab = page.waitForEvent('websocket', {
      predicate: socket => socket.url().includes(pageCollabPath(note.id)),
      timeout: 20_000,
    })
    await page.goto(`/p/${note.id}`)
    await collab
    const editor = page.getByTestId('editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await editor.click()
    await page.keyboard.type('Hello page')
    await expect(editor).toContainText('Hello page')

    await page.keyboard.press('Enter')
    await page.keyboard.type('/callout')
    await page.locator('.bn-suggestion-menu').getByText('Callout', { exact: true }).click()
    await page.keyboard.type('Stand out')
    await expect(editor).toContainText('Stand out')

    await page.keyboard.press('Enter')
    await page.keyboard.type('/page')
    await page.locator('.bn-suggestion-menu').getByText('Page', { exact: true }).click()
    await expect(page).toHaveURL(/\/p\//, { timeout: 10_000 })
    await page.goto(`/p/${note.id}`)
    await expect(editor).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('import-markdown-input').setInputFiles({
      name: 'note.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# Imported\n\nFrom a file'),
    })
    await expect(editor).toContainText('From a file', { timeout: 10_000 })
    await expect.poll(async () => (await getDocument(api, user, note.id)).state).not.toBeNull()
  })

  test('two people see each other type and each other cursors', async ({
    authedPage: page,
    loginAs,
    api,
    user,
  }) => {
    await updateMe(api, user, { display_name: 'Ada' })
    const workspace = await ensureWorkspace(api, user)
    const blair = await registerUser(api, uniqueEmail('blair'), PASSWORD, 'Blair')
    await addMember(api, user, workspace.id, blair, 'editor')
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Together' })

    await page.goto(`/p/${note.id}`)
    const editor = page.getByTestId('editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })

    const other = await loginAs(blair)
    const otherSocket = other.waitForEvent('websocket', {
      predicate: socket => socket.url().includes(pageCollabPath(note.id)),
      timeout: 20_000,
    })
    await other.goto(`/p/${note.id}`)
    await otherSocket
    const otherEditor = other.getByTestId('editor')
    await expect(otherEditor).toBeVisible({ timeout: 15_000 })

    await expect(
      page.getByTestId('presence-avatars').getByRole('img', { name: 'Blair' })
    ).toBeVisible()
    await expect(
      other.getByTestId('presence-avatars').getByRole('img', { name: 'Ada' })
    ).toBeVisible()

    await editor.click()
    await page.keyboard.type('Ada was here')
    await expect(otherEditor).toContainText('Ada was here', { timeout: 15_000 })
    await expect(other.locator('.bn-collaboration-cursor__label', { hasText: 'Ada' })).toBeVisible()

    await otherEditor.click()
    await other.keyboard.type(' Blair too')
    await expect(editor).toContainText('Blair too', { timeout: 15_000 })
    await expect(
      page.locator('.bn-collaboration-cursor__label', { hasText: 'Blair' })
    ).toBeVisible()

    // Both edits persist: a reload shows them straight from the stored document.
    await other.reload()
    const reloaded = other.getByTestId('editor')
    await expect(reloaded).toContainText('Ada was here', { timeout: 15_000 })
    await expect(reloaded).toContainText('Blair too')
    await expect
      .poll(async () => (await getDocument(api, user, note.id)).state, { timeout: 15_000 })
      .not.toBeNull()
  })

  test('the sidebar updates when another member adds a page', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const events = page.waitForEvent('websocket', {
      predicate: socket => socket.url().includes(workspaceEventsPath(workspace.id)),
      timeout: 20_000,
    })
    await page.goto('/home')
    await events
    await createPage(api, user, { workspace_id: workspace.id, title: 'Live page' })
    await expect(sidebarPage(page, 'Live page')).toBeVisible()
  })

  test('toggles the sidebar, the theme and opens search with the keyboard', async ({
    authedPage: page,
    api,
    user,
  }) => {
    await ensureWorkspace(api, user)
    await page.goto('/home')
    // The shell mounts client-side: wait for it before the shortcuts, or the
    // first keypress lands before the listeners exist.
    await expect(page.getByTestId('workspace-name')).toBeVisible()
    await page.keyboard.press('Control+Backslash')
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-open', 'false')
    await page.keyboard.press('Control+Backslash')
    await expect(page.getByTestId('sidebar')).toHaveAttribute('data-open', 'true')

    const handle = page.getByRole('slider', { name: 'Resize sidebar' })
    await handle.focus()
    const before = Number(await handle.getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', String(before + 16))

    await page.getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Appearance' }).click()
    await settings.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.keyboard.press('Control+Shift+L')
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await settings.getByRole('radio', { name: 'Light' }).click()

    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+p')
    await expect(page.getByRole('dialog', { name: 'Quick find' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Quick find' })).toBeHidden()
  })

  test('adds, replies, resolves and deletes a comment', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Talk' })
    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Comments' }).click()
    const panel = page.getByRole('complementary', { name: 'Comments' })
    await panel.getByLabel('Add a page comment').fill('Looks good')
    await panel.getByRole('button', { name: 'Send comment' }).click()
    const thread = panel.getByRole('article').filter({ hasText: 'Looks good' })
    await expect(thread).toBeVisible()
    expect((await listComments(api, user, note.id)).map(item => item.body)).toContain('Looks good')

    await thread.getByRole('button', { name: 'Reply…' }).click()
    await panel.getByRole('textbox', { name: 'Reply' }).fill('Thanks')
    await panel.getByRole('button', { name: 'Send reply' }).click()
    await expect(panel.getByText('Thanks')).toBeVisible()

    await thread.hover()
    await thread.getByRole('button', { name: 'Resolve discussion' }).click()
    await panel.getByRole('tab', { name: /Resolved/ }).click()
    await expect(panel.getByRole('article').filter({ hasText: 'Looks good' })).toHaveAttribute(
      'data-resolved',
      'true'
    )
    const root = (await listComments(api, user, note.id)).find(item => item.body === 'Looks good')
    expect(root?.resolved).toBe(true)

    const resolved = panel.getByRole('article').filter({ hasText: 'Looks good' })
    await resolved.hover()
    // Only the root comment says "Looks good" (the reply says "Thanks").
    await resolved
      .getByTestId('comment')
      .filter({ hasText: 'Looks good' })
      .getByRole('button', { name: 'Comment options' })
      .click()
    await page.getByRole('menuitem', { name: 'Delete comment' }).click()
    await expect(resolved).toBeHidden()
    const seeded = await createComment(api, user, note.id, { body: 'Seed' })
    expect((await updateComment(api, user, seeded.id, { body: 'Edited seed' })).body).toBe(
      'Edited seed'
    )
    await deleteComment(api, user, seeded.id)
    expect((await listComments(api, user, note.id)).map(item => item.body)).not.toContain('Seed')
  })
})
