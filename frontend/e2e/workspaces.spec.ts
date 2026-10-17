import {
  test,
  expect,
  addMember,
  authHeaders,
  createWorkspace,
  deleteWorkspace,
  ensureWorkspace,
  errorToast,
  getMe,
  listMembers,
  listWorkspaces,
  loginUser,
  openWorkspaceMenu,
  PASSWORD,
  registerUser,
  revokeSession,
  sidebar,
  storedToken,
  uniqueEmail,
  updateMe,
  updateWorkspace,
  type Page,
} from './fixtures'

test.describe('workspaces (F2, F3, F17)', () => {
  test('caps the first-workspace bootstrap name by code points', async ({ loginAs, api }) => {
    // 99 A's plus 🚀 is 100 code points but 101 UTF-16 units: slicing the
    // derived name ("<name>'s Workspace") to 100 units cut the emoji in half,
    // and the database rejected the lone surrogate, stranding the account on
    // the bootstrap error screen forever. Truncating by code points keeps
    // the string valid: the first 100 code points of the derived name are
    // exactly the display name, and the account boots straight in.
    const longName = `${'A'.repeat(99)}🚀`
    const user = await registerUser(api, uniqueEmail('names'), PASSWORD, longName)
    const page = await loginAs(user)

    // Count the create attempts straight off the wire: exactly one per boot,
    // win or lose. This is the retry-cap contract (a failed create must not
    // loop with a toast each time), asserted on the requests themselves.
    const creates: string[] = []
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/workspaces')) {
        creates.push(request.url())
      }
    })

    await page.goto('/home')
    await expect(
      page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })
    ).toBeVisible({ timeout: 20_000 })
    expect((await listWorkspaces(api, user)).map(workspace => workspace.name)).toEqual([longName])
    expect(creates.length).toBe(1)
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
    await expect.poll(async () => (await getMe(api, user)).display_name).toBe('Ada Lovelace')
  })
})

test.describe('workspaces: refused changes in settings (coverage)', () => {
  test('refuses an unknown invitee, the last owner leaving and demoting the last owner', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    await updateMe(api, user, { display_name: 'Olive Owner' })
    await page.goto('/home')
    await sidebar(page).getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Members' }).click()

    const stranger = uniqueEmail('nobody')
    await settings.getByLabel('Email address').fill(stranger)
    await settings.getByRole('button', { name: 'Invite' }).click()
    await expect(errorToast(page).filter({ hasText: 'Could not add the member' })).toBeVisible()
    await expect(settings.getByLabel('Email address')).toHaveValue(stranger)

    // The only owner can neither leave nor give up the owner role.
    await settings.getByRole('button', { name: 'Leave workspace' }).click()
    await expect(
      errorToast(page).filter({ hasText: 'Could not leave the workspace' })
    ).toBeVisible()
    await settings.getByRole('button', { name: 'Role of Olive Owner' }).click()
    await page.getByRole('menuitem', { name: /Can edit/ }).click()
    await expect(errorToast(page).filter({ hasText: 'Could not change the role' })).toBeVisible()
    await expect(settings.getByRole('button', { name: 'Role of Olive Owner' })).toContainText(
      'Full access'
    )

    const members = await listMembers(api, user, workspace.id)
    expect(members.map(member => [member.email, member.role])).toEqual([[user.email, 'owner']])
  })

  test('cancelling the delete confirmation forgets the typed name', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    await page.goto('/home')
    await sidebar(page).getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Workspace' }).click()
    await settings.getByRole('button', { name: 'Delete entire workspace' }).click()
    const confirm = page.getByRole('alertdialog')
    const typed = confirm.getByLabel('Type the workspace name to confirm')
    await typed.fill(workspace.name)
    await expect(confirm.getByRole('button', { name: 'Delete workspace' })).toBeEnabled()
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()

    await settings.getByRole('button', { name: 'Delete entire workspace' }).click()
    await expect(typed).toHaveValue('')
    await expect(confirm.getByRole('button', { name: 'Delete workspace' })).toBeDisabled()
    expect((await listWorkspaces(api, user)).map(item => item.id)).toContain(workspace.id)
  })

  test('logs out from the account settings', async ({ authedPage: page, api, user }) => {
    await ensureWorkspace(api, user)
    await page.goto('/home')
    await sidebar(page).getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL('/login')
    await expect(settings).toBeHidden()
    await expect.poll(() => storedToken(page)).toBeNull()
    const me = await api.get('/users/me', { headers: authHeaders(user) })
    expect(me.status()).toBe(401)
  })

  // Each change is sent after the session ended on another device: the server
  // refuses it (401), the app says what failed and goes to the login page.
  const refused: {
    name: string
    title: string
    /** Opens the right tab: before the session ends, so only the change itself is refused. */
    tab: 'My account' | 'Workspace' | 'Members'
    /** Steps that send nothing, done while the session still works. */
    prepare?: (page: Page, workspaceName: string) => Promise<void>
    act: (page: Page, guestName: string) => Promise<void>
  }[] = [
    {
      name: 'renaming the account',
      title: 'Could not update your name',
      tab: 'My account',
      act: async page => {
        const name = page.getByRole('dialog', { name: 'Settings' }).getByLabel('Preferred name')
        await name.fill('Too late')
        await name.press('Enter')
      },
    },
    {
      name: 'renaming the workspace',
      title: 'Could not rename the workspace',
      tab: 'Workspace',
      act: async page => {
        const settings = page.getByRole('dialog', { name: 'Settings' })
        await settings.getByLabel('Workspace name').fill('Too late')
        await settings.getByLabel('Workspace name').press('Enter')
      },
    },
    {
      name: 'changing the workspace icon',
      title: 'Could not change the icon',
      tab: 'Workspace',
      act: async page => {
        const settings = page.getByRole('dialog', { name: 'Settings' })
        await settings.getByRole('button', { name: 'Change workspace icon' }).click()
        await settings.locator('button[frimousse-emoji]:visible').first().click()
      },
    },
    {
      name: 'deleting the workspace',
      title: 'Could not delete the workspace',
      tab: 'Workspace',
      prepare: async (page, workspaceName) => {
        const settings = page.getByRole('dialog', { name: 'Settings' })
        await settings.getByRole('button', { name: 'Delete entire workspace' }).click()
        const confirm = page.getByRole('alertdialog')
        await confirm.getByLabel('Type the workspace name to confirm').fill(workspaceName)
        await expect(confirm.getByRole('button', { name: 'Delete workspace' })).toBeEnabled()
      },
      act: async page => {
        await page
          .getByRole('alertdialog')
          .getByRole('button', { name: 'Delete workspace' })
          .click()
      },
    },
    {
      name: 'removing a member',
      title: 'Could not remove the member',
      tab: 'Members',
      act: async (page, guestName) => {
        const settings = page.getByRole('dialog', { name: 'Settings' })
        await settings.getByRole('button', { name: `Remove ${guestName}` }).click()
      },
    },
  ]
  for (const { name, title, tab, prepare, act } of refused) {
    test(`${name} after the session ended elsewhere shows the error`, async ({
      authedPage: page,
      api,
      user,
    }) => {
      const workspace = await ensureWorkspace(api, user)
      const guest = await registerUser(api, uniqueEmail('guest'), PASSWORD, 'Gus Guest')
      await addMember(api, user, workspace.id, guest)
      await page.goto('/home')
      await sidebar(page).getByRole('button', { name: 'Settings' }).click()
      const settings = page.getByRole('dialog', { name: 'Settings' })
      await settings.getByRole('button', { name: tab, exact: true }).click()
      await expect(settings.getByRole('heading', { name: tab })).toBeVisible()
      if (tab === 'Members') await expect(settings.getByText(guest.email)).toBeVisible()
      await prepare?.(page, workspace.name)

      await revokeSession(api, user)
      await act(page, guest.displayName)

      await expect(errorToast(page)).toContainText(title)
      await expect(errorToast(page)).toContainText('Your session has expired')
      await expect(page).toHaveURL(/\/login/)
      // Nothing changed on the server.
      const owner = { token: await loginUser(api, user.email, user.password) }
      expect(await listWorkspaces(api, owner)).toEqual([workspace])
      expect((await listMembers(api, owner, workspace.id)).map(member => member.email)).toContain(
        guest.email
      )
    })
  }

  test('creating a workspace after the session ended elsewhere shows the error', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    await page.goto('/home')
    await openWorkspaceMenu(page)
    await page.getByRole('button', { name: 'New workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'New workspace' })
    await dialog.getByLabel('Workspace name').fill('Never made')

    await revokeSession(api, user)
    await dialog.getByRole('button', { name: 'Create workspace' }).click()

    await expect(errorToast(page)).toContainText('Could not create the workspace')
    await expect(page).toHaveURL(/\/login/)
    const owner = { token: await loginUser(api, user.email, user.password) }
    expect((await listWorkspaces(api, owner)).map(item => item.id)).toEqual([workspace.id])
  })
})
