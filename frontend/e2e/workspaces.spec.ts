import {
  test,
  expect,
  addMember,
  authHeaders,
  createWorkspace,
  deleteWorkspace,
  ensureWorkspace,
  errorToast,
  listMembers,
  listWorkspaces,
  openWorkspaceMenu,
  PASSWORD,
  registerUser,
  sidebar,
  uniqueEmail,
  updateMe,
  updateWorkspace,
} from './fixtures'

test.describe('workspaces (F2, F3, F17)', () => {
  test('caps the first-workspace bootstrap and offers Try again', async ({ loginAs, api }) => {
    // A display name of exactly 100 UTF-16 units ending in an emoji: the
    // bootstrap name ("<name>'s Notion", sliced to 100 units) cuts the emoji
    // in half, and the database rejects the lone surrogate, so the create
    // fails on the server for real (HTTP 500) on every attempt.
    const longName = `${'A'.repeat(99)}🚀`
    const user = await registerUser(api, uniqueEmail('names'), PASSWORD, longName)
    const page = await loginAs(user)

    await page.goto('/home')
    const failure = page.getByText('Could not create your workspace').first()
    const retry = page.getByRole('button', { name: 'Try again' })
    await expect(retry).toBeVisible({ timeout: 20_000 })
    await expect(failure).toBeVisible()
    await expect(errorToast(page)).toHaveCount(1)

    // Try again re-runs exactly one attempt: the same broken name fails again.
    await retry.click()
    await expect(retry).toBeVisible({ timeout: 20_000 })
    await expect(errorToast(page)).toHaveCount(1, { timeout: 10_000 })

    // A name the server accepts makes the next boot succeed end to end.
    await updateMe(api, user, { display_name: 'Bo' })
    await page.reload()
    await expect(
      page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })
    ).toBeVisible({ timeout: 20_000 })
    expect((await listWorkspaces(api, user)).map(workspace => workspace.name)).toEqual([
      "Bo's Notion",
    ])
  })

  test('creates, renames and switches a workspace', async ({ authedPage: page, api, user }) => {
    const first = await ensureWorkspace(api, user)
    await page.goto('/home')
    await expect(page.getByTestId('workspace-name')).toHaveText(first.name)

    await openWorkspaceMenu(page)
    await page.getByRole('button', { name: 'New workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'New workspace' })
    await dialog.getByLabel('Workspace name').fill('Studio')
    await dialog.getByRole('button', { name: 'Create workspace' }).click()

    await expect(page.getByTestId('workspace-name')).toHaveText('Studio')
    const created = (await listWorkspaces(api, user)).find(item => item.name === 'Studio')
    expect(created).toBeTruthy()

    await sidebar(page).getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Workspace' }).click()
    await settings.getByLabel('Workspace name').fill('Studio notes')
    await settings.getByLabel('Workspace name').press('Enter')
    await expect(page.getByTestId('workspace-name')).toHaveText('Studio notes')
    expect((await updateWorkspace(api, user, created!.id, { name: 'Studio notes' })).name).toBe(
      'Studio notes'
    )
    // The settings dialog is modal (it hides the app from screen readers): close it
    // before the test drives the sidebar again.
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()

    await openWorkspaceMenu(page)
    await page
      .getByRole('list', { name: 'Workspaces' })
      .getByRole('button')
      .filter({ hasText: first.name })
      .click()
    await expect(page.getByTestId('workspace-name')).toHaveText(first.name)
    await deleteWorkspace(api, user, created!.id)
  })

  test('invites a member, changes the role and lets them leave', async ({
    authedPage: page,
    loginAs,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const guest = await registerUser(api, uniqueEmail('guest'), undefined, 'Guest')
    await page.goto('/home')
    await sidebar(page).getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Members' }).click()
    await settings.getByLabel('Email address').fill(guest.email)
    await settings.getByRole('button', { name: 'Invite' }).click()
    await expect(settings.getByText(guest.email)).toBeVisible()
    expect((await listMembers(api, user, workspace.id)).map(member => member.email)).toContain(
      guest.email
    )

    await settings.getByRole('button', { name: 'Role of Guest' }).click()
    await page.getByRole('menuitem', { name: /Can view/ }).click()
    // The menu item click does not wait for the role PATCH: poll the server.
    await expect
      .poll(
        async () =>
          (await listMembers(api, user, workspace.id)).find(member => member.email === guest.email)
            ?.role
      )
      .toBe('viewer')

    const guestPage = await loginAs(guest)
    await guestPage.goto('/home')
    await expect(guestPage.getByTestId('workspace-name')).toHaveText(workspace.name)
    await expect(guestPage.getByRole('button', { name: 'New page' })).toHaveCount(0)
    await guestPage.getByRole('button', { name: 'Settings' }).click()
    await guestPage
      .getByRole('dialog', { name: 'Settings' })
      .getByRole('button', { name: 'Members' })
      .click()
    await guestPage.getByRole('button', { name: 'Leave workspace' }).click()
    await expect(guestPage.getByText(`You left ${workspace.name}`)).toBeVisible()
    expect((await listMembers(api, user, workspace.id)).map(member => member.email)).not.toContain(
      guest.email
    )
  })

  test('removes a member from the workspace', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const guest = await registerUser(api, uniqueEmail('guest'), undefined, 'Guest')
    await addMember(api, user, workspace.id, guest)
    await page.goto('/home')
    await sidebar(page).getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Members' }).click()
    await expect(settings.getByText(guest.email)).toBeVisible()

    await settings.getByRole('button', { name: 'Remove Guest' }).click()
    await expect(settings.getByText(guest.email)).toBeHidden()
    expect((await listMembers(api, user, workspace.id)).map(m => m.email)).not.toContain(
      guest.email
    )
  })

  test('deletes a workspace from settings', async ({ authedPage: page, api, user }) => {
    await ensureWorkspace(api, user)
    const doomed = await createWorkspace(api, user, { name: 'Doomed' })
    await page.goto('/home')
    await openWorkspaceMenu(page)
    await page
      .getByRole('list', { name: 'Workspaces' })
      .getByRole('button')
      .filter({ hasText: 'Doomed' })
      .click()
    await expect(page.getByTestId('workspace-name')).toHaveText('Doomed')

    await sidebar(page).getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Workspace' }).click()
    await settings.getByRole('button', { name: 'Delete entire workspace' }).click()
    const confirm = page.getByRole('alertdialog')
    await confirm.getByLabel('Type the workspace name to confirm').fill('Doomed')
    await confirm.getByRole('button', { name: 'Delete workspace' }).click()

    await expect(page.getByText('Workspace deleted')).toBeVisible()
    await expect(page.getByTestId('workspace-name')).not.toHaveText('Doomed')
    const gone = await api.get(`/workspaces/${doomed.id}`, { headers: authHeaders(user) })
    expect(gone.status()).toBe(404)
  })

  test('changes the workspace icon from settings', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    await page.goto('/home')
    await sidebar(page).getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Workspace' }).click()

    await settings.getByRole('button', { name: 'Change workspace icon' }).click()
    // The picker opens inline in the dialog (a body-portal popover is not
    // clickable while the modal dialog owns pointer events).
    await settings.getByLabel('Filter emoji').fill('rocket')
    const emojiButton = settings.locator('button[frimousse-emoji]:visible').first()
    const emoji = (await emojiButton.textContent()) ?? ''
    await emojiButton.click()

    await expect
      .poll(
        async () => (await listWorkspaces(api, user)).find(item => item.id === workspace.id)?.icon
      )
      .toBe(emoji)
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    await expect(page.getByRole('button', { name: 'Switch workspace' })).toContainText(emoji)
  })

  test('renames the account from settings', async ({ authedPage: page, api, user }) => {
    await ensureWorkspace(api, user)
    await updateMe(api, user, { display_name: 'Ada' })
    await page.goto('/home')
    await sidebar(page).getByRole('button', { name: 'Settings' }).click()
    const name = page.getByRole('dialog', { name: 'Settings' }).getByLabel('Preferred name')
    await expect(name).toHaveValue('Ada')
    await name.fill('Ada Lovelace')
    await name.press('Enter')
    expect((await updateMe(api, user, { display_name: 'Ada Lovelace' })).display_name).toBe(
      'Ada Lovelace'
    )
  })
})
