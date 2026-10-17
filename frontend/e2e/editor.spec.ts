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
  trashPage,
  uniqueEmail,
  updateComment,
  updateMe,
  updatePage,
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
    const live = await createPage(api, user, { workspace_id: workspace.id, title: 'Live page' })
    await expect(sidebarPage(page, 'Live page')).toBeVisible()

    // Renames and the trash arrive the same way, without a reload.
    await updatePage(api, user, live.id, { title: 'Renamed live' })
    await expect(sidebarPage(page, 'Renamed live')).toBeVisible()
    await trashPage(api, user, live.id)
    await expect(sidebarPage(page, 'Renamed live')).toBeHidden()
  })

  test('resizes the sidebar with the pointer', async ({ authedPage: page, api, user }) => {
    await ensureWorkspace(api, user)
    await page.goto('/home')
    await expect(page.getByTestId('workspace-name')).toBeVisible()
    const handle = page.getByRole('slider', { name: 'Resize sidebar' })
    const before = Number(await handle.getAttribute('aria-valuenow'))
    const box = await handle.boundingBox()
    await page.mouse.move(box!.x, box!.y)
    await page.mouse.down()
    await page.mouse.move(box!.x + 80, box!.y, { steps: 8 })
    await page.mouse.up()
    await expect(handle).toHaveAttribute('aria-valuenow', String(before + 80))
  })

  test('slash menu inserts the Notion blocks', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Blocks' })
    const collab = page.waitForEvent('websocket', {
      predicate: socket => socket.url().includes(pageCollabPath(note.id)),
      timeout: 20_000,
    })
    await page.goto(`/p/${note.id}`)
    await collab
    const editor = page.getByTestId('editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await editor.click()

    const pick = async (typed: string, item: string) => {
      await page.keyboard.press('Enter')
      await page.keyboard.type(`/${typed}`)
      await page.locator('.bn-suggestion-menu').getByText(item, { exact: true }).click()
    }

    await pick('heading 1', 'Heading 1')
    await page.keyboard.type('Big heading')
    await expect(editor.locator('[data-content-type="heading"]')).toContainText('Big heading')

    await pick('todo', 'To-do list')
    await page.keyboard.type('A task')
    const checkbox = editor.locator('[data-content-type="checkListItem"] input[type="checkbox"]')
    await checkbox.click()
    await expect(checkbox).toBeChecked()
    // The checkbox took the focus: put the cursor back before the next pick.
    await editor.getByText('A task').click()

    await pick('toggle', 'Toggle list')
    await page.keyboard.type('Hidden inside')
    await expect(editor.locator('[data-content-type="toggleListItem"]')).toContainText(
      'Hidden inside'
    )

    await pick('divider', 'Divider')
    await expect(editor.locator('[data-content-type="divider"]')).toBeVisible()

    // The code block goes last: Enter inside it adds a newline, not a block.
    await pick('code', 'Code')
    await page.keyboard.type('const answer = 42')
    await expect(editor.locator('[data-content-type="codeBlock"]')).toContainText(
      'const answer = 42'
    )

    await expect
      .poll(async () => (await getDocument(api, user, note.id)).state, { timeout: 15_000 })
      .not.toBeNull()
  })

  test('markdown shortcuts and the formatting toolbar', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Shortcuts' })
    const collab = page.waitForEvent('websocket', {
      predicate: socket => socket.url().includes(pageCollabPath(note.id)),
      timeout: 20_000,
    })
    await page.goto(`/p/${note.id}`)
    await collab
    const editor = page.getByTestId('editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await editor.click()

    // "# " turns the block into a heading, "[] " into a to-do, "``` " into code.
    await page.keyboard.type('# ')
    await page.keyboard.type('Shortcut heading')
    await expect(editor.locator('[data-content-type="heading"]')).toContainText('Shortcut heading')

    await page.keyboard.press('Enter')
    await page.keyboard.type('[] ')
    await page.keyboard.type('Shortcut task')
    await expect(editor.locator('[data-content-type="checkListItem"]')).toContainText(
      'Shortcut task'
    )

    await page.keyboard.press('Enter')
    await page.keyboard.type('``` ')
    await page.keyboard.type('x = 1')
    await expect(editor.locator('[data-content-type="codeBlock"]')).toContainText('x = 1')

    // Enter inside a code block is a newline: click the paragraph below it
    // before typing the next block.
    await editor.getByRole('paragraph').last().click()
    await page.keyboard.type('make this bold')
    await page.keyboard.press('Shift+Home')
    const toolbar = page.locator('.bn-formatting-toolbar')
    await expect(toolbar).toBeVisible()
    await toolbar.locator('[data-test="bold"]').click()
    await expect(editor.locator('strong')).toContainText('make this bold')

    await expect
      .poll(async () => (await getDocument(api, user, note.id)).state, { timeout: 15_000 })
      .not.toBeNull()
  })

  test('comments update live for both members', async ({
    authedPage: page,
    loginAs,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const blair = await registerUser(api, uniqueEmail('blair'), PASSWORD, 'Blair')
    await addMember(api, user, workspace.id, blair, 'editor')
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Live comments' })

    const other = await loginAs(blair)
    await other.goto(`/p/${note.id}`)
    await other.getByRole('button', { name: 'Comments', exact: true }).click()
    const otherPanel = other.getByRole('complementary', { name: 'Comments' })
    await expect(otherPanel).toBeVisible()

    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Comments', exact: true }).click()
    const panel = page.getByRole('complementary', { name: 'Comments' })
    await panel.getByLabel('Add a page comment').fill('Live from the other side')
    await panel.getByRole('button', { name: 'Send comment' }).click()

    // Blair's open panel shows the new comment without a reload (F14).
    await expect(otherPanel.getByText('Live from the other side')).toBeVisible({
      timeout: 15_000,
    })
    expect((await listComments(api, user, note.id)).map(item => item.body)).toContain(
      'Live from the other side'
    )
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
    await page.getByRole('button', { name: 'Comments', exact: true }).click()
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

    // The author edits their own comment in place.
    await thread.hover()
    await thread
      .getByTestId('comment')
      .filter({ hasText: 'Looks good' })
      .getByRole('button', { name: 'Comment options' })
      .click()
    await page.getByRole('menuitem', { name: 'Edit comment' }).click()
    await page.getByLabel('Edit comment').fill('Looks great')
    await page.getByLabel('Edit comment').press('Enter')
    await expect(panel.getByText('Looks great')).toBeVisible()
    const edited = (await listComments(api, user, note.id)).find(
      item => item.body === 'Looks great'
    )
    expect(edited?.edited).toBe(true)

    // The thread locator filtered on the pre-edit text: re-anchor it.
    const editedThread = panel.getByRole('article').filter({ hasText: 'Looks great' })
    await editedThread.hover()
    await editedThread.getByRole('button', { name: 'Resolve discussion' }).click()
    await panel.getByRole('tab', { name: /Resolved/ }).click()
    await expect(panel.getByRole('article').filter({ hasText: 'Looks great' })).toHaveAttribute(
      'data-resolved',
      'true'
    )
    const root = (await listComments(api, user, note.id)).find(item => item.body === 'Looks great')
    expect(root?.resolved).toBe(true)

    const resolved = panel.getByRole('article').filter({ hasText: 'Looks great' })
    await resolved.hover()
    // Only the root comment says "Looks great" (the reply says "Thanks").
    await resolved
      .getByTestId('comment')
      .filter({ hasText: 'Looks great' })
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
