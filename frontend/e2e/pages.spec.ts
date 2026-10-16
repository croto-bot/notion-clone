import {
  test,
  expect,
  createPage,
  duplicatePage,
  ensureWorkspace,
  favoritePage,
  getPage,
  listFavorites,
  listTrash,
  mouseDrag,
  movePage,
  pageTree,
  purgePage,
  searchPages,
  sidebar,
  sidebarPage,
  trashPage,
  updatePage,
} from './fixtures'

test.describe('pages (F4, F8, F9, F11, F12)', () => {
  test('creates, renames, nests and duplicates a page', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    await page.goto('/home')
    await sidebar(page).getByRole('button', { name: 'New page' }).click()
    await expect(page).toHaveURL(/\/p\//)
    const title = page.getByLabel('Page title')
    await title.fill('Parent')
    await title.press('Enter')
    await expect(sidebarPage(page, 'Parent')).toBeVisible()

    const parent = (await pageTree(api, user, workspace.id)).find(item => item.title === 'Parent')
    expect(parent).toBeTruthy()
    const child = await createPage(api, user, {
      workspace_id: workspace.id,
      title: 'Child',
    })
    await expect(sidebarPage(page, 'Child')).toBeVisible()
    await mouseDrag(page, sidebarPage(page, 'Child'), sidebarPage(page, 'Parent'))
    await expect.poll(async () => (await getPage(api, user, child.id)).parent_id).toBe(parent!.id)

    await page.goto(`/p/${child.id}`)
    await page.getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect
      .poll(
        async () =>
          (await pageTree(api, user, workspace.id)).filter(item => item.title === 'Child').length
      )
      .toBeGreaterThan(1)
    expect((await duplicatePage(api, user, child.id)).title).toBe('Child')
  })

  test('moves a page from the Move to dialog', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const parent = await createPage(api, user, { workspace_id: workspace.id, title: 'Folder' })
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Loose note' })
    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Move to' }).click()
    await page.getByRole('option', { name: 'Folder' }).click()
    await expect.poll(async () => (await getPage(api, user, note.id)).parent_id).toBe(parent.id)
    await movePage(api, user, note.id, { parent_id: null })
  })

  test('stars a page and shows it in Favorites', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Starred' })
    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Add to Favorites' }).click()
    await expect(
      sidebar(page).getByRole('region', { name: 'Favorites' }).getByText('Starred')
    ).toBeVisible()
    expect((await listFavorites(api, user, workspace.id)).map(item => item.id)).toContain(note.id)
    await page.getByRole('button', { name: 'Remove from Favorites' }).click()
    await expect(sidebar(page).getByRole('region', { name: 'Favorites' })).toBeHidden()
    await favoritePage(api, user, note.id)
    expect((await listFavorites(api, user, workspace.id)).map(item => item.id)).toContain(note.id)
  })

  test('trashes a page, restores it, then deletes it forever', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Gone' })
    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
    await expect(page).toHaveURL('/home')
    expect((await listTrash(api, user, workspace.id)).map(item => item.id)).toContain(note.id)

    await sidebar(page).getByRole('button', { name: 'Trash' }).click()
    await page.getByRole('button', { name: 'Restore Gone' }).click()
    await expect.poll(async () => (await getPage(api, user, note.id)).deleted_at).toBeNull()

    await trashPage(api, user, note.id)
    await page.goto(`/p/${note.id}`)
    await expect(page.getByTestId('trash-banner')).toContainText('This page is in Trash.')
    await page.getByRole('button', { name: 'Delete permanently' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click()
    await expect(page).toHaveURL('/home')
    expect((await listTrash(api, user, workspace.id)).map(item => item.id)).not.toContain(note.id)
    await purgePage(api, user, note.id).catch(() => undefined)
  })

  test('shows the greeting and a recently visited page', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Recent note' })
    await page.goto(`/p/${note.id}`)
    await page.getByRole('link', { name: 'Home' }).click()
    await expect(page).toHaveURL('/home')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      /Good (morning|afternoon|evening), /
    )
    await expect(
      page.getByRole('region', { name: 'Recently visited' }).getByText('Recent note')
    ).toBeVisible()
  })

  test('changes font, width and lock from the page menu', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Styled' })
    await page.goto(`/p/${note.id}`)
    await expect(page.getByTestId('edited-label')).toContainText('Edited')
    await page.getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitemradio', { name: 'Serif' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Full width' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Lock page' }).click()
    await expect.poll(async () => (await getPage(api, user, note.id)).font).toBe('serif')
    const saved = await getPage(api, user, note.id)
    expect(saved.full_width).toBe(true)
    expect(saved.locked).toBe(true)
    await expect(page.getByTestId('page-scroll')).toHaveAttribute('data-font', 'serif')
    await updatePage(api, user, note.id, { font: 'default', full_width: false, locked: false })
  })

  test('sends anonymous users to login', async ({ page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Private' })
    await page.goto(`/p/${note.id}`)
    await expect(page).toHaveURL(`/login?redirect=${encodeURIComponent(`/p/${note.id}`)}`)
  })

  test('finds a page from quick find', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Needle' })
    await page.goto('/home')
    // The shortcut listener mounts with the client-side shell.
    await expect(page.getByTestId('workspace-name')).toBeVisible()
    await page.keyboard.press('Control+k')
    const quickFind = page.getByRole('dialog', { name: 'Quick find' })
    await expect(quickFind).toBeVisible()
    // Arrow keys move the highlight and Enter opens the page, like Notion.
    await quickFind.getByLabel('Search pages').fill('Needle')
    await expect(quickFind.getByRole('option', { name: /Needle/ })).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`/p/${note.id}`)
    expect((await searchPages(api, user, workspace.id, 'Needle')).map(item => item.id)).toContain(
      note.id
    )
  })
})
