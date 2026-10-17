import {
  test,
  expect,
  addMember,
  authHeaders,
  createWorkspace,
  deleteWorkspace,
  ensureWorkspace,
  listMembers,
  listWorkspaces,
  openWorkspaceMenu,
  registerUser,
  sidebar,
  uniqueEmail,
  updateMe,
  updateWorkspace,
} from './fixtures'

test.describe('workspaces (F2, F3, F17)', () => {
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
    expect(
      (await listMembers(api, user, workspace.id)).find(member => member.email === guest.email)
        ?.role
    ).toBe('viewer')

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
