import {
  test,
  expect,
  createComment,
  createPage,
  ensureWorkspace,
  errorToast,
  listComments,
  liveEventsSettled,
  revokeSession,
} from './fixtures'

/** One character over the server's 10,000-character limit for a comment body. */
const TOO_LONG = 'x'.repeat(10_001)

test.describe('comments: keyboard and refused writes', () => {
  test('Enter sends, Shift+Enter adds a line and Escape cancels', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Keys' })
    await page.goto(`/p/${note.id}`)
    await expect(page.getByLabel('Page title')).toBeVisible()

    // The "Add comment" box under the title: Escape closes it unsent.
    await page.getByLabel('Page title').hover()
    await page.getByRole('button', { name: 'Add comment' }).click()
    const discussions = page.getByRole('region', { name: 'Discussions' })
    const box = discussions.getByLabel('Add a comment')
    await box.fill('Never sent')
    await box.press('Escape')
    await expect(discussions).toBeHidden()

    await page.getByLabel('Page title').hover()
    await page.getByRole('button', { name: 'Add comment' }).click()
    await box.pressSequentially('First line')
    await box.press('Shift+Enter')
    await box.pressSequentially('second line')
    await box.press('Enter')
    const thread = discussions.getByRole('article')
    await expect(thread).toContainText('First line')
    await expect(box).toBeHidden()
    await expect
      .poll(async () => (await listComments(api, user, note.id)).map(item => item.body))
      .toEqual(['First line\nsecond line'])

    // A reply: Escape closes the box, Enter sends it.
    await thread.getByRole('button', { name: 'Reply…' }).click()
    await thread.getByRole('textbox', { name: 'Reply' }).fill('Not this')
    await thread.getByRole('textbox', { name: 'Reply' }).press('Escape')
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toBeHidden()
    await thread.getByRole('button', { name: 'Reply…' }).click()
    await thread.getByRole('textbox', { name: 'Reply' }).fill('Agreed')
    await thread.getByRole('textbox', { name: 'Reply' }).press('Enter')
    await expect(thread.getByText('Agreed')).toBeVisible()

    // Escape while editing drops the edit.
    const root = thread.getByTestId('comment').first()
    await root.hover()
    await root.getByRole('button', { name: 'Comment options' }).click()
    await page.getByRole('menuitem', { name: 'Edit comment' }).click()
    await page.getByLabel('Edit comment').fill('Changed my mind')
    await page.getByLabel('Edit comment').press('Escape')
    await expect(page.getByLabel('Edit comment')).toBeHidden()
    await expect(root).toContainText('First line')
    await expect
      .poll(async () => (await listComments(api, user, note.id)).map(item => item.body))
      .toEqual(['First line\nsecond line', 'Agreed'])
  })

  test('a comment, a reply or an edit over the size limit shows the error and keeps the text', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Long talk' })
    await createComment(api, user, note.id, { body: 'Short and fine' })
    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Comments', exact: true }).click()
    const panel = page.getByRole('complementary', { name: 'Comments' })
    const thread = panel.getByRole('article').filter({ hasText: 'Short and fine' })
    await expect(thread).toBeVisible()

    // A new discussion in the panel.
    await panel.getByLabel('Add a page comment').fill(TOO_LONG)
    await panel.getByRole('button', { name: 'Send comment' }).click()
    await expect(errorToast(page)).toContainText('Could not add the comment')
    await expect(errorToast(page)).toContainText('body')
    await expect(panel.getByLabel('Add a page comment')).toHaveValue(TOO_LONG)

    // A reply.
    await thread.getByRole('button', { name: 'Reply…' }).click()
    await thread.getByRole('textbox', { name: 'Reply' }).fill(TOO_LONG)
    await thread.getByRole('textbox', { name: 'Reply' }).press('Enter')
    await expect(errorToast(page).filter({ hasText: 'Could not add the reply' })).toBeVisible()
    await expect(thread.getByRole('textbox', { name: 'Reply' })).toHaveValue(TOO_LONG)

    // An edit stays open with the refused text.
    await thread.getByTestId('comment').first().hover()
    await thread.getByRole('button', { name: 'Comment options' }).click()
    await page.getByRole('menuitem', { name: 'Edit comment' }).click()
    await page.getByLabel('Edit comment').fill(TOO_LONG)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(errorToast(page).filter({ hasText: 'Could not save the comment' })).toBeVisible()
    await expect(page.getByLabel('Edit comment')).toHaveValue(TOO_LONG)
    // An empty edit is not sent at all.
    await page.getByLabel('Edit comment').fill('   ')
    await page.getByLabel('Edit comment').press('Enter')
    await expect(page.getByLabel('Edit comment')).toBeVisible()

    // The "Add comment" box under the title.
    await page.getByLabel('Page title').hover()
    await page.getByRole('button', { name: 'Add comment' }).click()
    const box = page.getByRole('region', { name: 'Discussions' }).getByLabel('Add a comment')
    await box.fill(TOO_LONG)
    // Wait for the first "Could not add the comment" toast to go, so the next one is new.
    const addFailed = errorToast(page).filter({ hasText: 'Could not add the comment' })
    await expect(addFailed).toHaveCount(0)
    await box.press('Enter')
    await expect(addFailed).toHaveCount(1)
    await expect(box).toHaveValue(TOO_LONG)

    const stored = await listComments(api, user, note.id)
    expect(stored.map(item => [item.body, item.edited])).toEqual([['Short and fine', false]])
  })

  for (const action of ['Resolve discussion', 'Delete comment'] as const) {
    test(`${action} after the session ended elsewhere shows the error`, async ({
      authedPage: page,
      api,
      user,
    }) => {
      const workspace = await ensureWorkspace(api, user)
      const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Ended' })
      await createComment(api, user, note.id, { body: 'Still here' })
      const live = liveEventsSettled(page, workspace.id)
      await page.goto(`/p/${note.id}`)
      await page.getByRole('button', { name: 'Comments', exact: true }).click()
      const thread = page
        .getByRole('complementary', { name: 'Comments' })
        .getByRole('article')
        .filter({ hasText: 'Still here' })
      await expect(thread).toBeVisible()
      await thread.hover()
      if (action === 'Delete comment') {
        await thread.getByRole('button', { name: 'Comment options' }).click()
        await expect(page.getByRole('menuitem', { name: 'Delete comment' })).toBeVisible()
      }

      // Signed out on another device: the server refuses the next write.
      await live
      await revokeSession(api, user)
      if (action === 'Delete comment') {
        await page.getByRole('menuitem', { name: 'Delete comment' }).click()
      } else {
        await thread.getByRole('button', { name: 'Resolve discussion' }).click()
      }

      const title =
        action === 'Delete comment'
          ? 'Could not delete the comment'
          : 'Could not update the discussion'
      await expect(errorToast(page)).toContainText(title)
      await expect(errorToast(page)).toContainText('Your session has expired')
      await expect(page).toHaveURL(/\/login\?redirect=/)
    })
  }
})
