import { readFile } from 'node:fs/promises'
import type { Request } from '@playwright/test'
import {
  test,
  expect,
  addMember,
  authHeaders,
  createPage,
  ensureWorkspace,
  errorToast,
  favoritePage,
  FRONTEND_URL,
  getPage,
  getDocument,
  listComments,
  listFavorites,
  listMembers,
  listTrash,
  mouseDrag,
  movePage,
  pageCollabPath,
  pageTree,
  PASSWORD,
  purgePage,
  registerUser,
  searchPages,
  sidebar,
  sidebarPage,
  trashPage,
  uniqueEmail,
  updatePage,
} from './fixtures'

// The cover rule's case list, shared verbatim with the backend test
// (backend/tests/e2e/test_databases.py, COVER_CASES): the picker's gate
// (isRenderableCover) and the server's validator are one predicate and must
// agree on every row. [value, accepted].
const COVER_CASES: [value: string, accepted: boolean][] = [
  ['gradient-1', true], // a picker preset key
  ['https://cdn.example.com/bg.png', true],
  ['HTTPS://cdn.example.com/bg.png', true], // both sides lowercase the scheme
  ['https://cdn.example.com:8443/bg.png', true], // a port in range
  ['https://cdn.example.com/bg image.png', true], // only the netloc must be whitespace-free
  ['http://cdn.example.com/bg.png', false], // wrong scheme
  ['javascript:alert(1)', false],
  ['gradient-7', false], // not a preset key
  ['https://', false], // no host
  ['https:///x', false], // empty netloc
  ['https:example.com', false], // no "//" after the scheme
  ['https://not a url', false], // whitespace in the netloc
  ['https://cdn.example.com:0/bg.png', false], // port 0 is not a port
  ['https://cdn.example.com:99999/bg.png', false], // port out of range
  ['https://cdn.example.com:abc/bg.png', false], // port not a number
]

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

    // The sidebar shows the rename optimistically; wait for it to persist.
    await expect
      .poll(async () =>
        (await pageTree(api, user, workspace.id)).find(item => item.title === 'Parent')
      )
      .toBeTruthy()
    const parentId = (await pageTree(api, user, workspace.id)).find(
      item => item.title === 'Parent'
    )!.id
    const child = await createPage(api, user, {
      workspace_id: workspace.id,
      title: 'Child',
    })
    await expect(sidebarPage(page, 'Child')).toBeVisible()
    await mouseDrag(page, sidebarPage(page, 'Child'), sidebarPage(page, 'Parent'))
    await expect.poll(async () => (await getPage(api, user, child.id)).parent_id).toBe(parentId)

    await page.goto(`/p/${child.id}`)
    await page.getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect
      .poll(
        async () =>
          (await pageTree(api, user, workspace.id)).filter(item => item.title === 'Child').length
      )
      .toBeGreaterThan(1)
    // The duplicate the menu created, verified by reading it back.
    const copy = (await pageTree(api, user, workspace.id)).find(
      item => item.title === 'Child' && item.id !== child.id
    )
    expect(copy).toBeTruthy()
    expect((await getPage(api, user, copy!.id)).title).toBe('Child')
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
    // The sidebar list is optimistic; the PUT may still be in flight.
    await expect
      .poll(async () => (await listFavorites(api, user, workspace.id)).map(item => item.id))
      .toContain(note.id)
    await page.getByRole('button', { name: 'Remove from Favorites' }).click()
    await expect(sidebar(page).getByRole('region', { name: 'Favorites' })).toBeHidden()
    // The unstar's DELETE may still be in flight (the hidden region is the
    // optimistic removal): wait for it to land before re-favoriting from the
    // spec, or the DELETE can commit after the PUT and undo it.
    await expect
      .poll(async () => (await listFavorites(api, user, workspace.id)).map(item => item.id))
      .toEqual([])
    await favoritePage(api, user, note.id)
    expect((await listFavorites(api, user, workspace.id)).map(item => item.id)).toContain(note.id)
  })

  test('a refused favorite toggle rolls the star back', async ({ loginAs, api, user }) => {
    // A viewer may read and comment but not favorite: the server refuses the
    // PUT with 403. The optimistic star must come back off (and stay off):
    // writing the refused value into the cache, or cancelling the repair
    // refetch, would leave it stuck on.
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'View only' })
    const viewer = await registerUser(api, uniqueEmail('viewer'), PASSWORD, 'Vic Viewer')
    await addMember(api, user, workspace.id, viewer, 'viewer')
    const other = await loginAs(viewer)
    await other.goto(`/p/${note.id}`)

    const star = other.getByRole('button', { name: /^(Add to|Remove from) Favorites$/ })
    await expect(star).toBeVisible({ timeout: 15_000 })
    await star.click()
    await expect(errorToast(other)).toHaveCount(1)

    // The refused toggle ends where it started: star off, nothing favorited.
    await expect(star).toHaveAttribute('aria-pressed', 'false')
    await expect(star).toHaveAccessibleName('Add to Favorites')
    expect((await listFavorites(api, viewer, workspace.id)).map(item => item.id)).toEqual([])
  })

  test('a failed rename does not roll back the fix typed right after it', async ({
    authedPage: page,
    api,
    user,
  }) => {
    // A title over the server's 4096-char limit fails with a real 422 while
    // the correction typed right behind it is still in flight. The failed
    // update's rollback (an invalidation and refetch of pre-commit state)
    // must never land over the newer edit: the title ends at what the user
    // last typed, in the UI and on the server.
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Rename me' })
    await page.goto(`/p/${note.id}`)
    const title = page.getByLabel('Page title')
    await expect(title).toBeVisible({ timeout: 15_000 })

    await title.fill('X'.repeat(5000))
    await title.press('Enter')
    await title.fill('Fixed name')
    await title.press('Enter')
    await expect(errorToast(page)).toHaveCount(1)

    await expect(title).toHaveValue('Fixed name')
    await expect(sidebarPage(page, 'Fixed name')).toBeVisible()
    await expect.poll(async () => (await getPage(api, user, note.id)).title).toBe('Fixed name')
  })

  test('a refused first edit never replays an older title after the newer one', async ({
    authedPage: page,
    api,
    user,
  }) => {
    // The same back-to-back pair, watched frame by frame: the sidebar row
    // records every title it ever shows, so even a one-frame revert (which
    // polling would miss) is on the tape. Once both edits have settled, the
    // recorded titles must never fall back to an older value again, and the
    // server keeps what the user last typed. Same-page updates run one at a
    // time, so the refused edit's repair refetch cannot land over the newer
    // title once the newer edit has settled.
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Race me' })
    await page.goto(`/p/${note.id}`)
    const title = page.getByLabel('Page title')
    await expect(title).toBeVisible({ timeout: 15_000 })
    await expect(sidebar(page).locator(`[data-page-id="${note.id}"]`)).toBeVisible()

    await page.evaluate(id => {
      const row = document.querySelector(`[data-page-id="${id}"]`)
      if (!row) throw new Error('sidebar row not found')
      const label = () => row.querySelector('span.truncate')?.textContent ?? ''
      const seen: string[] = [label()]
      ;(window as typeof window & { __sidebarTitles: string[] }).__sidebarTitles = seen
      new MutationObserver(() => {
        const value = label()
        if (value !== seen[seen.length - 1]) seen.push(value)
      }).observe(row, { childList: true, characterData: true, subtree: true })
    }, note.id)

    // Both edits go through the real title input inside one page turn (native
    // input + Enter events): the second mutation is called before the first
    // PATCH can possibly answer, so the pair genuinely overlaps and the
    // one-at-a-time order is what keeps every later write newer than the last.
    await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Page title"]'
      )
      if (!textarea) throw new Error('title input not found')
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      const type = (value: string) => {
        setValue.call(textarea, value)
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const enter = () =>
        textarea.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        )
      type('X'.repeat(5000))
      enter()
      type('Fixed name')
      enter()
    })

    await expect(errorToast(page)).toHaveCount(1)
    await expect(title).toHaveValue('Fixed name')
    await expect(sidebarPage(page, 'Fixed name')).toBeVisible()
    await expect.poll(async () => (await getPage(api, user, note.id)).title).toBe('Fixed name')

    // Both edits have settled here: mark the tape, keep watching the sidebar
    // for another second (the observer records every title it shows in that
    // window, even a one-frame flash), then read the tape from the mark on.
    const settledAt = await page.evaluate(
      () => (window as typeof window & { __sidebarTitles?: string[] }).__sidebarTitles?.length ?? 0
    )
    await page.evaluate(
      id =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            const row = document.querySelector(`[data-page-id="${id}"]`)
            const state = window as typeof window & { __sidebarTitles?: string[] }
            // Sample the label too: an observer-only window could miss a
            // change that reverted and restored between mutations.
            const value = row?.querySelector('span.truncate')?.textContent ?? ''
            const seen = state.__sidebarTitles ?? []
            if (value !== seen[seen.length - 1]) seen.push(value)
            resolve()
          }, 1000)
        }),
      note.id
    )
    expect((await getPage(api, user, note.id)).title).toBe('Fixed name')
    await expect(sidebarPage(page, 'Fixed name')).toBeVisible()

    const seen = await page.evaluate(
      () => (window as typeof window & { __sidebarTitles?: string[] }).__sidebarTitles ?? []
    )
    const firstNewer = seen.indexOf('Fixed name')
    expect(firstNewer, `sidebar showed ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(0)
    expect(firstNewer, `sidebar showed ${JSON.stringify(seen)}`).toBeLessThan(settledAt)
    // The whole tape, not only the post-settle window: once the newer title
    // has appeared, an older one must not come back, including during the overlap.
    for (let i = firstNewer; i < seen.length; i++) {
      expect(seen[i], `sidebar showed ${JSON.stringify(seen)}`).toBe('Fixed name')
    }
  })

  test('a refused title followed by a star returns to the server title with the star on', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Kept title' })
    await page.goto(`/p/${note.id}`)
    const title = page.getByLabel('Page title')
    await expect(title).toHaveValue('Kept title', { timeout: 15_000 })
    await expect(sidebarPage(page, 'Kept title')).toBeVisible()

    // One turn: the 422 is still in flight when the star is clicked, so a
    // favorite must not swallow the refused edit's repair.
    await page.evaluate(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Page title"]'
      )
      const star = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Add to Favorites"]'
      )
      if (!textarea || !star) throw new Error('title or star not found')
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setValue.call(textarea, 'X'.repeat(5000))
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
      star.click()
    })

    await expect(errorToast(page)).toHaveCount(1)
    await expect(title).toHaveValue('Kept title')
    await expect(page.getByTestId('breadcrumb-current')).toHaveText('Kept title')
    await expect(sidebarPage(page, 'Kept title')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove from Favorites' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect((await getPage(api, user, note.id)).title).toBe('Kept title')
    expect(await listFavorites(api, user, workspace.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: note.id })])
    )
  })

  test('a font change stays visible when a star click overlaps the save', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, {
      workspace_id: workspace.id,
      title: 'Font then star',
    })
    await page.goto(`/p/${note.id}`)
    await expect(page.getByTestId('page-scroll')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Page options' }).click()

    await page.evaluate(() => {
      const serif = document.querySelector<HTMLElement>('[aria-label="Serif"]')
      const star = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Add to Favorites"]'
      )
      if (!serif || !star) throw new Error('font or star not found')
      serif.click()
      star.click()
    })

    await expect(page.getByTestId('page-scroll')).toHaveAttribute('data-font', 'serif')
    // The options menu stays open (the font item keeps it open) and hides the
    // topbar star from the accessibility tree. Close it, then read the star.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Remove from Favorites' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect.poll(async () => (await getPage(api, user, note.id)).font).toBe('serif')
  })

  test('a publish overlapped by a star still shows the public link', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, {
      workspace_id: workspace.id,
      title: 'Publish then star',
    })
    await page.goto(`/p/${note.id}`)
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Share' }).click()
    await page.getByRole('tab', { name: 'Publish' }).click()

    await page.evaluate(() => {
      const publish = document.querySelector<HTMLButtonElement>('[aria-label="Publish to web"]')
      const star = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Add to Favorites"]'
      )
      if (!publish || !star) throw new Error('publish or star not found')
      publish.click()
      star.click()
    })

    const link = page.getByLabel('Public link')
    await expect(link).toBeVisible()
    await expect(link).toHaveValue(/\/share\//)
    await expect(page.getByRole('button', { name: 'Remove from Favorites' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const saved = await getPage(api, user, note.id)
    expect(saved.is_public).toBe(true)
    expect(saved.public_id).toBeTruthy()
    await expect(link).toHaveValue(new RegExp(`/share/${saved.public_id}$`))
  })

  test('moving a parent updates the open child breadcrumbs', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    await createPage(api, user, { workspace_id: workspace.id, title: 'Folder' })
    const parent = await createPage(api, user, { workspace_id: workspace.id, title: 'Parent' })
    const child = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: parent.id,
      title: 'Child',
    })
    await page.goto(`/p/${child.id}`)
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumbs' })
    await expect(crumbs.getByRole('link', { name: 'Parent' })).toBeVisible({ timeout: 15_000 })
    await expect(crumbs.getByRole('link', { name: 'Folder' })).toHaveCount(0)

    await sidebarPage(page, 'Parent').hover()
    await page.getByRole('button', { name: 'Options for Parent' }).click()
    await page.getByRole('menuitem', { name: 'Move to' }).click()
    await page.getByRole('option', { name: 'Folder' }).click()

    await expect(crumbs.getByRole('link', { name: 'Folder' })).toBeVisible()
    await expect(crumbs.getByRole('link', { name: 'Parent' })).toBeVisible()
    expect((await getPage(api, user, parent.id)).parent_id).not.toBeNull()
  })

  test('renaming a parent from the sidebar updates the open child breadcrumbs', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const parent = await createPage(api, user, { workspace_id: workspace.id, title: 'Old parent' })
    const child = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: parent.id,
      title: 'Open child',
    })
    await page.goto(`/p/${child.id}`)
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumbs' })
    await expect(crumbs.getByRole('link', { name: 'Old parent' })).toBeVisible({ timeout: 15_000 })

    await sidebarPage(page, 'Old parent').hover()
    await page.getByRole('button', { name: 'Options for Old parent' }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const input = sidebar(page).getByLabel('Page title')
    await input.fill('New parent')
    await input.press('Enter')

    await expect(crumbs.getByRole('link', { name: 'New parent' })).toBeVisible()
    await expect(crumbs.getByRole('link', { name: 'Old parent' })).toHaveCount(0)
    expect((await getPage(api, user, parent.id)).title).toBe('New parent')
  })

  test('typing in the document does not refetch the open page', async ({
    authedPage: page,
    api,
    user,
  }) => {
    // Every collab save publishes page.updated with this tab's id. Without
    // the typing counted as this tab's activity, each save (about once a
    // second) refetched the page, recorded a visit and reloaded every list.
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Steady typing' })
    await page.goto(`/p/${note.id}`)
    const editor = page.getByTestId('editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await expect(sidebar(page).locator(`[data-page-id="${note.id}"]`)).toBeVisible()
    await editor.click()
    // Let the first load and the socket-open reload finish before counting.
    await page.waitForTimeout(1500)

    const reads: string[] = []
    const onRequest = (request: Request) => {
      if (request.method() !== 'GET') return
      const path = new URL(request.url()).pathname
      if (path === `/pages/${note.id}` || path.endsWith('/page-tree')) reads.push(path)
    }
    page.on('request', onRequest)
    await page.keyboard.type('Steady words typed for a while. '.repeat(3), { delay: 50 })
    // The last save lands about a second after the last keystroke.
    await page.waitForTimeout(1500)
    page.off('request', onRequest)

    expect(reads, `reads while typing: ${JSON.stringify(reads)}`).toEqual([])
    await expect
      .poll(async () =>
        (await searchPages(api, user, workspace.id, 'Steady words')).map(item => item.id)
      )
      .toContain(note.id)
  })

  test('typing then renaming within a second does not revert the title', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Quiet title' })
    await page.goto(`/p/${note.id}`)
    const editor = page.getByTestId('editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await expect(sidebar(page).locator(`[data-page-id="${note.id}"]`)).toBeVisible()

    await page.evaluate(id => {
      const row = document.querySelector(`[data-page-id="${id}"]`)
      if (!row) throw new Error('sidebar row not found')
      const label = () => row.querySelector('span.truncate')?.textContent ?? ''
      const seen: string[] = [label()]
      ;(window as typeof window & { __sidebarTitles: string[] }).__sidebarTitles = seen
      new MutationObserver(() => {
        const value = label()
        if (value !== seen[seen.length - 1]) seen.push(value)
      }).observe(row, { childList: true, characterData: true, subtree: true })
    }, note.id)

    await editor.click()
    await page.keyboard.type('Hello document')
    // Rename starts in the same second as the typing. The titles keep coming
    // for longer than the collab flush (about 1s) plus the events coalesce, so
    // the save's page.updated refetches while a newer title is on screen.
    const titles = Array.from({ length: 50 }, (_, i) => `Renamed ${String(i + 1).padStart(2, '0')}`)
    const finalTitle = titles[titles.length - 1]! as string
    await page.evaluate(
      ({ titles, gap }) => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Page title"]'
        )
        if (!textarea) throw new Error('title input not found')
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        )!.set!
        const type = (value: string) => {
          setValue.call(textarea, value)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const enter = () =>
          textarea.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
          )
        return new Promise<void>(resolve => {
          let index = 0
          const step = () => {
            if (index >= titles.length) {
              resolve()
              return
            }
            type(titles[index]!)
            enter()
            index += 1
            setTimeout(step, gap)
          }
          step()
        })
      },
      { titles, gap: 30 }
    )

    await expect(page.getByLabel('Page title')).toHaveValue(finalTitle)
    await expect(sidebarPage(page, finalTitle)).toBeVisible()
    await expect.poll(async () => (await getPage(api, user, note.id)).title).toBe(finalTitle)
    await page.evaluate(
      id =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            const row = document.querySelector(`[data-page-id="${id}"]`)
            const state = window as typeof window & { __sidebarTitles?: string[] }
            const value = row?.querySelector('span.truncate')?.textContent ?? ''
            const seen = state.__sidebarTitles ?? []
            if (value !== seen[seen.length - 1]) seen.push(value)
            resolve()
          }, 1500)
        }),
      note.id
    )

    const seen = await page.evaluate(
      () => (window as typeof window & { __sidebarTitles?: string[] }).__sidebarTitles ?? []
    )
    const firstRename = seen.findIndex(title => title.startsWith('Renamed '))
    expect(firstRename, `sidebar showed ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(0)
    const rank = (title: string) => {
      const match = /^Renamed (\d+)$/.exec(title)
      return match ? Number(match[1]) : 0
    }
    for (let i = firstRename + 1; i < seen.length; i++) {
      expect(rank(seen[i]!), `sidebar showed ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(
        rank(seen[i - 1]!)
      )
    }
    expect(seen[seen.length - 1], `sidebar showed ${JSON.stringify(seen)}`).toBe(finalTitle)
  })

  test('an edit burst never reverts the editing tab, and still reaches the other tab and another member', async ({
    authedPage: page,
    api,
    user,
    loginAs,
  }) => {
    // The events socket skips a `page.updated` only while this tab has a
    // pending or just-settled mutation of that page. A refetch of an earlier
    // commit would otherwise land over the newer optimistic paint. The same
    // user's other tab has its own id and still refreshes, and so does every
    // other member.
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Multiplayer' })
    const otherUser = await registerUser(api)
    await addMember(api, user, workspace.id, otherUser)
    const other = await loginAs(otherUser)

    await page.goto(`/p/${note.id}`)
    const title = page.getByLabel('Page title')
    await expect(title).toBeVisible({ timeout: 15_000 })
    await expect(sidebar(page).locator(`[data-page-id="${note.id}"]`)).toBeVisible()

    // Tab B of the SAME user: a second page of the same browser context, so
    // the same session, but its own module state (its own client id) and its
    // own events socket.
    const tabB = await page.context().newPage()
    await tabB.goto(`/p/${note.id}`)
    await expect(sidebar(tabB).locator(`[data-page-id="${note.id}"]`)).toBeVisible()
    // The other member reads the same workspace from their own session.
    await other.goto('/home')
    await expect(sidebar(other).locator(`[data-page-id="${note.id}"]`)).toBeVisible()

    await page.evaluate(id => {
      const row = document.querySelector(`[data-page-id="${id}"]`)
      if (!row) throw new Error('sidebar row not found')
      const label = () => row.querySelector('span.truncate')?.textContent ?? ''
      const seen: string[] = [label()]
      ;(window as typeof window & { __sidebarTitles: string[] }).__sidebarTitles = seen
      new MutationObserver(() => {
        const value = label()
        if (value !== seen[seen.length - 1]) seen.push(value)
      }).observe(row, { childList: true, characterData: true, subtree: true })
    }, note.id)

    // One committed PATCH per title, faster than the events socket's 250 ms
    // coalescing window, so the socket's invalidation refetches overlap the
    // burst's in-flight mutations: exactly when a pre-commit read could land
    // over the paint of a newer edit.
    const titles = Array.from({ length: 60 }, (_, i) => `Burst ${String(i + 1).padStart(2, '0')}`)
    const finalTitle = titles[titles.length - 1]
    await page.evaluate(
      ({ titles, gap }) => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="Page title"]'
        )
        if (!textarea) throw new Error('title input not found')
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        )!.set!
        const type = (value: string) => {
          setValue.call(textarea, value)
          textarea.dispatchEvent(new Event('input', { bubbles: true }))
        }
        const enter = () =>
          textarea.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
          )
        return new Promise<void>(resolve => {
          let index = 0
          const step = () => {
            if (index >= titles.length) {
              resolve()
              return
            }
            type(titles[index])
            enter()
            index += 1
            setTimeout(step, gap)
          }
          step()
        })
      },
      { titles, gap: 20 }
    )

    await expect(title).toHaveValue(finalTitle)
    await expect(sidebarPage(page, finalTitle)).toBeVisible()
    await expect.poll(async () => (await getPage(api, user, note.id)).title).toBe(finalTitle)

    // Everything has settled: keep watching the sidebar row for another
    // second (a late events flush lands within 250 ms; the observer records
    // even a one-frame flash), then read the tape.
    await page.evaluate(
      id =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            const row = document.querySelector(`[data-page-id="${id}"]`)
            const state = window as typeof window & { __sidebarTitles?: string[] }
            // Sample the label too: an observer-only window could miss a
            // change that reverted and restored between flushes.
            const value = row?.querySelector('span.truncate')?.textContent ?? ''
            const seen = state.__sidebarTitles ?? []
            if (value !== seen[seen.length - 1]) seen.push(value)
            resolve()
          }, 1000)
        }),
      note.id
    )

    const seen = await page.evaluate(
      () => (window as typeof window & { __sidebarTitles?: string[] }).__sidebarTitles ?? []
    )
    // The tape must be a subsequence of the edit order: every title the row
    // ever showed is the initial one or a later edit, and it never stepped
    // back to an older one. Own-tab events used to break this.
    const order = ['Multiplayer', ...titles]
    const ranks = seen.map(value => order.indexOf(value))
    expect(
      ranks.every(rank => rank >= 0),
      `sidebar showed an unknown title: ${JSON.stringify(seen)}`
    ).toBe(true)
    for (let i = 1; i < ranks.length; i++) {
      expect(
        ranks[i] >= ranks[i - 1],
        `sidebar replayed an older title: ${JSON.stringify(seen)}`
      ).toBe(true)
    }
    expect(seen[seen.length - 1], `sidebar showed ${JSON.stringify(seen)}`).toBe(finalTitle)
    await expect(errorToast(page)).toHaveCount(0)

    // The same edits reach the user's other tab and the other member through
    // their own events sockets.
    await expect(sidebarPage(tabB, finalTitle)).toBeVisible({ timeout: 15_000 })
    await expect(sidebarPage(other, finalTitle)).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => (await getPage(api, otherUser, note.id)).title).toBe(finalTitle)
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

  test('changes font, width, small text and lock from the page menu', async ({
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
    await page.getByRole('menuitemcheckbox', { name: 'Small text' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Lock page' }).click()
    // Four PATCHes fire back to back and the menu state is optimistic: poll
    // until all of them have landed.
    await expect
      .poll(async () => {
        const saved = await getPage(api, user, note.id)
        return [saved.font, saved.full_width, saved.small_text, saved.locked]
      })
      .toEqual(['serif', true, true, true])
    await expect(page.getByTestId('page-scroll')).toHaveAttribute('data-font', 'serif')
    await expect(page.getByTestId('editor')).toHaveClass(/nx-small-text/)
    await updatePage(api, user, note.id, {
      font: 'default',
      full_width: false,
      small_text: false,
      locked: false,
    })
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
    // Opening the page records the visit (GET /pages/{id}); wait for it or the
    // reload below cancels the request and the visit never lands.
    const opened = page.waitForResponse(
      response =>
        response.url().endsWith(`/pages/${note.id}`) && response.request().method() === 'GET'
    )
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(`/p/${note.id}`)
    await opened
    expect((await searchPages(api, user, workspace.id, 'Needle')).map(item => item.id)).toContain(
      note.id
    )

    // An empty query lists the recently visited pages (F10).
    await page.goto('/home')
    await expect(page.getByTestId('workspace-name')).toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(quickFind).toBeVisible()
    await expect(quickFind.getByRole('option', { name: /Needle/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(quickFind).toBeHidden()
  })

  test('reorders pages in the sidebar with drag and drop', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      await createPage(api, user, { workspace_id: workspace.id, title })
    }
    await page.goto('/home')

    // Drop Gamma on Alpha's top edge: before it, so Gamma becomes the first page.
    await mouseDrag(page, sidebarPage(page, 'Gamma'), sidebarPage(page, 'Alpha'), {
      x: 100,
      y: 6,
    })
    await expect
      .poll(async () => (await pageTree(api, user, workspace.id)).map(item => item.title))
      .toEqual(['Gamma', 'Alpha', 'Beta'])
  })

  test('picks an icon and a cover from their pickers', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Decorated' })
    await page.goto(`/p/${note.id}`)

    await page.getByRole('button', { name: 'Add icon' }).click()
    const iconPicker = page.getByRole('dialog')
    await iconPicker.getByLabel('Filter emoji').fill('grinning')
    const emojiButton = iconPicker.locator('button[frimousse-emoji]:visible').first()
    const emoji = (await emojiButton.textContent()) ?? ''
    await emojiButton.click()
    await expect(page.getByTestId('page-icon')).toHaveText(emoji)
    await expect.poll(async () => (await getPage(api, user, note.id)).icon).toBe(emoji)

    await page.getByRole('button', { name: 'Add cover' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cover Sunrise' }).click()
    await expect(page.getByTestId('page-cover')).toBeVisible()
    await expect.poll(async () => (await getPage(api, user, note.id)).cover).toBe('gradient-1')

    await page.getByTestId('page-cover').hover()
    await page.getByRole('button', { name: 'Change cover' }).click()
    await page.getByRole('dialog').getByRole('tab', { name: 'Link' }).click()
    const link = page.getByRole('dialog').getByLabel('Image link')
    const submit = page.getByRole('dialog').getByRole('button', { name: 'Submit' })
    // Both parsers lowercase the scheme: an uppercase https URL is a valid
    // cover end to end, and the band renders it. (The full accept/refuse
    // table lives in the cover-rule test below.)
    await link.fill('HTTPS://cdn.example.com/bg.png')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(page.getByTestId('page-cover')).toBeVisible()
    // The band really carries the image URL as its background (the browser
    // may normalize the case when reporting the computed style).
    await expect
      .poll(async () =>
        page.getByTestId('page-cover').evaluate(el => getComputedStyle(el).backgroundImage)
      )
      .toMatch(/cdn\.example\.com\/bg\.png/i)
    await expect
      .poll(async () => (await getPage(api, user, note.id)).cover)
      .toBe('HTTPS://cdn.example.com/bg.png')

    await page.getByTestId('page-cover').hover()
    await page.getByRole('button', { name: 'Change cover' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByTestId('page-cover')).toBeHidden()
    await expect.poll(async () => (await getPage(api, user, note.id)).cover).toBeNull()
  })

  test('applies one cover rule on both sides of the wire', async ({
    authedPage: page,
    api,
    user,
  }) => {
    // Every row of COVER_CASES must get the same verdict from the picker's
    // gate (isRenderableCover) and from the server's validator: the picker
    // never offers a submit the server would 422.
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Cover rule' })
    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Add cover' }).click()
    await page.getByRole('dialog').getByRole('tab', { name: 'Link' }).click()
    const link = page.getByRole('dialog').getByLabel('Image link')
    const submit = page.getByRole('dialog').getByRole('button', { name: 'Submit' })
    for (const [value, accepted] of COVER_CASES) {
      await link.fill(value)
      if (accepted) await expect(submit, value).toBeEnabled()
      else await expect(submit, value).toBeDisabled()
    }

    // A row with a port goes end to end: stored unchanged by the server and
    // rendered as the band, including on the public page (whose band follows
    // the same renderable predicate).
    const withPort = 'https://cdn.example.com:8443/bg.png'
    await link.fill(withPort)
    await submit.click()
    await expect(page.getByTestId('page-cover')).toBeVisible()
    await expect.poll(async () => (await getPage(api, user, note.id)).cover).toBe(withPort)
    const published = await updatePage(api, user, note.id, { is_public: true })
    await page.goto(`/share/${published.public_id}`)
    await expect(page.getByTestId('page-cover')).toBeVisible()
  })

  test('undoes a delete from the toast', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Saved by undo' })
    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(sidebarPage(page, 'Saved by undo')).toBeVisible()
    await expect.poll(async () => (await getPage(api, user, note.id)).deleted_at).toBeNull()
  })

  test('searches the trash and deletes forever from the popover', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const keep = await createPage(api, user, { workspace_id: workspace.id, title: 'Keep me' })
    const gone = await createPage(api, user, { workspace_id: workspace.id, title: 'Purge me' })
    await trashPage(api, user, keep.id)
    await trashPage(api, user, gone.id)

    await page.goto('/home')
    await sidebar(page).getByRole('button', { name: 'Trash' }).click()
    const trash = page.getByRole('dialog')
    await trash.getByLabel('Search pages in Trash').fill('Purge')
    await expect(trash.getByText('Keep me')).toBeHidden()

    await trash.getByRole('button', { name: 'Delete Purge me permanently' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click()
    await expect
      .poll(async () => (await listTrash(api, user, workspace.id)).map(item => item.id))
      .not.toContain(gone.id)
    expect((await listTrash(api, user, workspace.id)).map(item => item.id)).toContain(keep.id)
  })

  test('exports the page as Markdown', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Exported' })
    const collab = page.waitForEvent('websocket', {
      predicate: socket => socket.url().includes(pageCollabPath(note.id)),
      timeout: 20_000,
    })
    await page.goto(`/p/${note.id}`)
    await collab
    const editor = page.getByTestId('editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await editor.click()
    await page.keyboard.type('Content to export')
    await expect(editor).toContainText('Content to export')

    await page.getByRole('button', { name: 'Page options' }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: 'Export Markdown' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('Exported.md')
    expect(await readFile((await download.path())!, 'utf8')).toContain('Content to export')
  })

  test('invites a member from the Share popover', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Shared' })
    const guest = await registerUser(api, uniqueEmail('guest'))
    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Share', exact: true }).click()
    const share = page.getByRole('dialog')
    await share.getByLabel('Invite by email').fill(guest.email)
    await share.getByRole('button', { name: 'Invite' }).click()
    await expect(share.getByText(guest.email)).toBeVisible()
    expect((await listMembers(api, user, workspace.id)).map(m => m.email)).toContain(guest.email)
  })

  test('a viewer reads the page but cannot write', async ({ loginAs, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Read only' })
    const board = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Read only board',
    })
    const viewer = await registerUser(api, uniqueEmail('reader'), PASSWORD)
    await addMember(api, user, workspace.id, viewer, 'viewer')

    const viewerPage = await loginAs(viewer)
    await viewerPage.goto(`/p/${note.id}`)
    const editor = viewerPage.getByTestId('editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await expect(editor).toHaveAttribute('data-editable', 'false')
    expect(await viewerPage.getByLabel('Page title').getAttribute('readonly')).not.toBeNull()
    await expect(viewerPage.getByRole('button', { name: 'Add icon' })).toHaveCount(0)
    await viewerPage.getByRole('button', { name: 'Page options' }).click()
    await expect(viewerPage.getByRole('menuitem', { name: 'Duplicate' })).toHaveCount(0)
    await expect(viewerPage.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0)
    await viewerPage.keyboard.press('Escape')

    // A database is read-only too: no way to add rows or properties.
    await viewerPage.goto(`/p/${board.id}`)
    await expect(viewerPage.getByTestId('database-view')).toBeVisible()
    await expect(viewerPage.getByRole('button', { name: 'New row' })).toHaveCount(0)
    await expect(viewerPage.getByRole('button', { name: 'Add a property' })).toHaveCount(0)

    // Viewers may still comment (SPEC §3).
    await viewerPage.getByRole('button', { name: 'Comments' }).click()
    const panel = viewerPage.getByRole('complementary', { name: 'Comments' })
    await panel.getByLabel('Add a page comment').fill('Viewer note')
    await panel.getByRole('button', { name: 'Send comment' }).click()
    await expect(panel.getByText('Viewer note')).toBeVisible()
    // The Comments button was last clicked on the database page. getByText
    // matches the composer's own value too, so poll the server for the comment.
    await expect
      .poll(async () => (await listComments(api, user, board.id)).map(item => item.body))
      .toContain('Viewer note')

    // The backend refuses the viewer's writes (the page owner checks).
    const blocked = await api.patch(`/pages/${note.id}`, {
      data: { title: 'Nope' },
      headers: authHeaders(viewer),
    })
    expect(blocked.status()).toBe(403)
  })

  test('duplicates a page with its children and content', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const parent = await createPage(api, user, { workspace_id: workspace.id, title: 'Original' })
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: parent.id,
      title: 'Offspring',
    })
    const collab = page.waitForEvent('websocket', {
      predicate: socket => socket.url().includes(pageCollabPath(parent.id)),
      timeout: 20_000,
    })
    await page.goto(`/p/${parent.id}`)
    await collab
    const editor = page.getByTestId('editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })
    await editor.click()
    // insertText = one editor transaction, so the whole phrase lands in the Yjs
    // update as one contiguous string and survives the base64 decode below.
    await page.keyboard.insertText('Body worth copying')
    await expect(editor).toContainText('Body worth copying')
    // Duplicate immediately, while the collab room is still dirty: its flush
    // debounces ~1 s, so the stored row does not have this text yet. The copy
    // must still carry it (the duplicate reads the live room state).
    await page.getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect
      .poll(
        async () =>
          (await pageTree(api, user, workspace.id)).filter(item => item.title === 'Original').length
      )
      .toBe(2)

    // The copy keeps the child and the content under a new id (F4).
    const copy = (await pageTree(api, user, workspace.id)).find(
      item => item.title === 'Original' && item.id !== parent.id
    )
    expect(copy).toBeTruthy()
    const children = (await pageTree(api, user, workspace.id)).filter(
      item => item.parent_id === copy!.id
    )
    expect(children.map(child => child.title)).toEqual(['Offspring'])
    await expect
      .poll(async () => {
        const doc = await getDocument(api, user, copy!.id)
        return doc.state ? Buffer.from(doc.state, 'base64').toString('utf8') : ''
      })
      .toContain('Body worth copying')
    await page.goto(`/p/${copy!.id}`)
    await expect(page.getByTestId('editor')).toContainText('Body worth copying', {
      timeout: 15_000,
    })
  })

  test('copies the page link from the page menu', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Linked' })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto(`/p/${note.id}`)

    await page.getByRole('button', { name: 'Page options' }).click()
    await page.getByRole('menuitem', { name: 'Copy link' }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(`${FRONTEND_URL}/p/${note.id}`)
  })
})
