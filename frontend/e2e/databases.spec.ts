import {
  test,
  expect,
  createPage,
  ensureWorkspace,
  getPage,
  getPublicPage,
  listRows,
  mouseDrag,
  sidebar,
  updatePage,
} from './fixtures'
import type { DatabaseProperty } from '../src/types/database'

function property(schema: DatabaseProperty[] | null, name: string): DatabaseProperty {
  const found = schema?.find(item => item.name === name)
  if (!found) throw new Error(`Missing property ${name}`)
  return found
}

test.describe('databases and publish (F13, F15)', () => {
  test('adds a row, filters it and opens it as a page', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Tasks',
    })
    const status = property(database.database_schema, 'Status')
    const done = status.options?.find(option => option.name === 'Done')
    expect(done).toBeTruthy()
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Ship it',
      properties: { [status.id]: done!.id },
    })
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Later',
    })

    await page.goto(`/p/${database.id}`)
    await expect(page.getByTestId('database-view')).toBeVisible()
    await expect(page.getByRole('row', { name: 'Ship it' })).toBeVisible()
    await expect(page.getByRole('row', { name: 'Later' })).toBeVisible()

    await page.getByRole('button', { name: 'New row' }).click()
    const title = page.getByLabel('Row title')
    await expect(title).toBeVisible()
    await title.fill('Fresh')
    await title.press('Enter')
    await expect(page.getByRole('row', { name: 'Fresh' })).toBeVisible()
    // The row is created empty and renamed by the Enter above; the visible
    // name is the input's own value, so poll for the stored title.
    await expect
      .poll(async () => (await listRows(api, user, database.id)).map(row => row.title))
      .toContain('Fresh')

    await page.getByRole('button', { name: 'Filter' }).click()
    await page.getByRole('button', { name: 'Add a filter' }).click()
    await page.getByLabel('Filter property').selectOption({ label: 'Status' })
    await page.getByLabel('Filter operator').selectOption({ label: 'Is' })
    await page.getByLabel('Filter value').selectOption({ label: 'Done' })
    await expect(page.getByRole('row', { name: 'Ship it' })).toBeVisible()
    await expect(page.getByRole('row', { name: 'Later' })).toBeHidden()
    await expect(page.getByText('No rows match the filter.')).toBeHidden()

    await page.getByRole('button', { name: 'Delete filter' }).click()
    await page.keyboard.press('Escape')
    const row = page.getByRole('row', { name: 'Ship it' })
    await row.getByRole('button', { name: 'Title: Ship it' }).hover()
    await row.getByRole('button', { name: 'Open Ship it' }).click()
    await expect(page).toHaveURL(/\/p\//)
    await expect(page.getByTestId('row-properties')).toBeVisible()
    await expect(page.getByTestId('row-properties')).toContainText('Status')
  })

  test('sends only the changed property key when a cell is edited', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Merged',
    })
    const status = property(database.database_schema, 'Status')
    const tags = property(database.database_schema, 'Tags')
    const started = status.options?.find(option => option.name === 'Not started')
    const done = status.options?.find(option => option.name === 'Done')
    const row = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'One key',
      // The row already owns a value of another key (set by "another editor").
      properties: { [status.id]: started!.id, [tags.id]: ['urgent'] },
    })
    await page.goto(`/p/${database.id}`)
    await expect(page.getByRole('row', { name: 'One key' })).toBeVisible()

    const rowPatches: Record<string, unknown>[] = []
    page.on('request', request => {
      if (request.method() === 'PATCH' && request.url().endsWith(`/pages/${row.id}`)) {
        rowPatches.push(request.postDataJSON() as Record<string, unknown>)
      }
    })
    await page.getByRole('button', { name: `Status of One key` }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()

    await expect
      .poll(async () => (await listRows(api, user, database.id))[0].properties)
      .toEqual({ [status.id]: done!.id, [tags.id]: ['urgent'] })
    const propertyPatches = rowPatches.filter(patch => patch.properties !== undefined)
    expect(propertyPatches.length).toBeGreaterThan(0)
    // Only the changed key crosses the wire: the server merges per key, so a
    // stale copy of the row's other keys can never overwrite another editor.
    for (const patch of propertyPatches) {
      expect(Object.keys(patch.properties as Record<string, unknown>)).toEqual([status.id])
    }
  })

  test('stores a created select option only after its schema change is saved', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Atomic',
    })
    const status = property(database.database_schema, 'Status')
    const row = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Atomic row',
    })
    await page.goto(`/p/${database.id}`)
    await expect(page.getByRole('row', { name: 'Atomic row' })).toBeVisible()

    // Watch the real request order: the row's value may only be sent once the
    // schema that defines the new option has been confirmed, so no reader can
    // ever see a row referencing an option missing from the schema.
    const order: string[] = []
    page.on('request', request => {
      if (request.method() !== 'PATCH') return
      if (request.url().endsWith(`/pages/${database.id}`)) order.push('schema:sent')
      if (request.url().endsWith(`/pages/${row.id}`)) order.push('row:sent')
    })
    page.on('response', response => {
      if (response.request().method() !== 'PATCH') return
      if (response.url().endsWith(`/pages/${database.id}`)) order.push('schema:saved')
    })

    await page.getByRole('button', { name: 'Status of Atomic row' }).click()
    const box = page.getByLabel('Search or create an option')
    await box.fill('Urgent')
    await box.press('Enter')

    await expect
      .poll(async () => {
        const saved = await getPage(api, user, database.id)
        const options = saved.database_schema?.find(item => item.id === status.id)?.options ?? []
        return options.some(option => option.name === 'Urgent')
      })
      .toBe(true)
    const savedSchema = await getPage(api, user, database.id)
    const urgent = savedSchema.database_schema
      ?.find(item => item.id === status.id)
      ?.options?.find(option => option.name === 'Urgent')
    expect(urgent).toBeTruthy()
    await expect
      .poll(async () => (await listRows(api, user, database.id))[0].properties?.[status.id])
      .toBe(urgent!.id)

    const rowSentAt = order.indexOf('row:sent')
    const schemaSavedAt = order.indexOf('schema:saved')
    expect(rowSentAt).toBeGreaterThan(-1)
    expect(schemaSavedAt).toBeGreaterThan(-1)
    expect(rowSentAt).toBeGreaterThan(schemaSavedAt)
  })

  test('drags a card between board columns', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Board',
    })
    const status = property(database.database_schema, 'Status')
    const started = status.options?.find(option => option.name === 'Not started')
    expect(started).toBeTruthy()
    const card = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Alpha',
      properties: { [status.id]: started!.id },
    })

    await page.goto(`/p/${database.id}`)
    await page.getByRole('button', { name: 'Add a view' }).click()
    await page.getByRole('menuitem', { name: 'Board' }).click()
    await expect(page.getByTestId('database-board')).toBeVisible()
    const doneColumn = page.getByTestId('board-column').filter({ hasText: 'Done' })
    await mouseDrag(page, page.getByRole('button', { name: 'Drag Alpha' }), doneColumn)
    await expect
      .poll(async () => {
        const rows = await listRows(api, user, database.id)
        return rows.find(row => row.id === card.id)?.properties[status.id]
      })
      .toBe(status.options?.find(option => option.name === 'Done')?.id)

    // The "+ New" of a column creates a row with that status already set. The
    // board has no inline title input: open the new card and name it on its page.
    await page.getByRole('button', { name: 'New row in Done' }).click()
    await page.getByRole('button', { name: 'Untitled', exact: true }).click()
    await page.getByLabel('Page title').fill('Fresh in column')
    await page.getByLabel('Page title').press('Enter')
    await expect
      .poll(async () => (await listRows(api, user, database.id)).map(row => row.title))
      .toContain('Fresh in column')
    const fresh = (await listRows(api, user, database.id)).find(
      row => row.title === 'Fresh in column'
    )
    expect(fresh?.properties[status.id]).toBe(status.options?.find(o => o.name === 'Done')?.id)
  })

  test('adds a property and switches to gallery', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Gallery',
    })
    await page.goto(`/p/${database.id}`)
    await page.getByRole('button', { name: 'Add a property' }).click()
    await page
      .getByRole('list', { name: 'New property type' })
      .getByRole('button', { name: 'Number' })
      .click()
    await expect
      .poll(async () =>
        (await getPage(api, user, database.id)).database_schema?.some(
          item => item.name === 'Number'
        )
      )
      .toBe(true)

    await page.getByRole('button', { name: 'Add a view' }).click()
    await page.getByRole('menuitem', { name: 'Gallery' }).click()
    await expect(page.getByTestId('database-gallery')).toBeVisible()
    await page.getByRole('button', { name: 'Add a view' }).click()
    await page.getByRole('menuitem', { name: 'List' }).click()
    await expect(page.getByTestId('database-list')).toBeVisible()
  })

  test('renames, retypes and deletes a property', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Schema edits',
    })
    await page.goto(`/p/${database.id}`)
    await expect(page.getByTestId('database-view')).toBeVisible()

    // Rename Status -> State from its column header.
    const statusHeader = page.getByRole('columnheader').filter({ hasText: 'Status' })
    await statusHeader.locator('button').click()
    await page.getByLabel('Property name').fill('State')
    await page.getByLabel('Property name').press('Enter')
    await expect(page.getByRole('columnheader').filter({ hasText: 'State' })).toBeVisible()
    await expect
      .poll(async () =>
        (await getPage(api, user, database.id)).database_schema?.some(item => item.name === 'State')
      )
      .toBe(true)

    // Retype Tags (multi select) into a number property.
    const tagsHeader = page.getByRole('columnheader').filter({ hasText: 'Tags' })
    await tagsHeader.locator('button').click()
    await page
      .getByRole('list', { name: 'Property type' })
      .getByRole('button', {
        name: 'Number',
      })
      .click()
    await expect
      .poll(
        async () =>
          (await getPage(api, user, database.id)).database_schema?.find(
            item => item.name === 'Tags'
          )?.type
      )
      .toBe('number')

    // Delete it: the column disappears.
    await tagsHeader.locator('button').click()
    await page.getByRole('button', { name: 'Delete property' }).click()
    await expect(tagsHeader).toBeHidden()
    await expect
      .poll(async () =>
        (await getPage(api, user, database.id)).database_schema?.some(item => item.name === 'Tags')
      )
      .toBe(false)
  })

  test('sorts, hides properties and edits views', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Sorted',
    })
    const status = property(database.database_schema, 'Status')
    const done = status.options?.find(option => option.name === 'Done')
    const started = status.options?.find(option => option.name === 'Not started')
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Bravo',
      properties: { [status.id]: done!.id },
    })
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Alpha',
      properties: { [status.id]: started!.id },
    })
    await page.goto(`/p/${database.id}`)
    await expect(page.getByTestId('database-view')).toBeVisible()

    // Sort by Name, ascending, then flip to descending.
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await page.getByRole('button', { name: 'Add a sort' }).click()
    await page.getByLabel('Sort property').selectOption({ label: 'Name' })
    await expect(page.locator('[data-row-id]').first()).toHaveAttribute('aria-label', 'Alpha')
    await page.getByLabel('Sort direction').selectOption('desc')
    await expect(page.locator('[data-row-id]').first()).toHaveAttribute('aria-label', 'Bravo')

    // Hide the Status column in this view.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Properties' }).click()
    await page.getByRole('switch', { name: 'Show Status' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('columnheader').filter({ hasText: 'Status' })).toHaveCount(0)
    const saved = await getPage(api, user, database.id)
    expect(saved.database_views?.[0]?.hidden_properties).toContain(status.id)

    // Rename the view, add a second one, then delete it again.
    await page.getByRole('button', { name: 'View options for Table' }).click()
    await page.getByLabel('View name').fill('Planning')
    await page.getByLabel('View name').press('Enter')
    await expect(page.getByRole('tab', { name: 'Planning' })).toBeVisible()

    await page.getByRole('button', { name: 'Add a view' }).click()
    await page.getByRole('menuitem', { name: 'Board' }).click()
    await expect(page.getByTestId('database-board')).toBeVisible()
    await page.getByRole('button', { name: 'View options for Board' }).click()
    await page.getByRole('button', { name: 'Delete view' }).click()
    await expect(page.getByRole('tab', { name: 'Planning' })).toBeVisible()
    await expect(page.getByTestId('database-board')).toBeHidden()
  })

  test('creates a database from the sidebar', async ({ authedPage: page, api, user }) => {
    await ensureWorkspace(api, user)
    await page.goto('/home')
    await sidebar(page).getByText('Pages', { exact: true }).hover()
    await sidebar(page).getByRole('button', { name: 'Pages options' }).click()
    await page.getByRole('menuitem', { name: 'New database' }).click()
    await expect(page).toHaveURL(/\/p\//)
    await expect(page.getByTestId('database-view')).toBeVisible()
    await page.getByLabel('Page title').fill('From sidebar')
    await page.getByLabel('Page title').blur()
    await expect(page.getByTestId('workspace-name')).toBeVisible()
  })

  test('publishes a page and a database to the web', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const note = await createPage(api, user, {
      workspace_id: workspace.id,
      title: 'Public note',
      icon: '✨',
    })
    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Share' }).click()
    await page.getByRole('tab', { name: 'Publish' }).click()
    await page.getByRole('switch', { name: 'Publish to web' }).click()
    await expect(page.getByLabel('Public link')).toHaveValue(/\/share\//)
    const published = await getPage(api, user, note.id)
    expect(published.public_id).toBeTruthy()
    await page.goto(`/share/${published.public_id}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Public note')
    const publicPage = await getPublicPage(api, published.public_id!)
    expect(publicPage.title).toBe('Public note')

    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Public tasks',
    })
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Visible row',
    })
    // A computed column: on the public page it can only render from the row's
    // own timestamps, so the public rows contract has to carry them.
    await updatePage(api, user, database.id, {
      database_schema: [
        ...(database.database_schema ?? []),
        { id: 'created-col', name: 'Created', type: 'created_time' },
      ],
    })
    const shared = await updatePage(api, user, database.id, { is_public: true })
    await page.goto(`/share/${shared.public_id}`)
    await expect(page.getByTestId('database-view')).toBeVisible()
    const publicRow = page.getByRole('row', { name: 'Visible row' })
    await expect(publicRow).toBeVisible()
    await expect(publicRow.getByText(/20\d\d/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'New row' })).toBeHidden()
    const publicDatabase = await getPublicPage(api, shared.public_id!)
    expect(publicDatabase.rows[0].created_at).toBeTruthy()
    expect(publicDatabase.rows[0].last_edited_at).toBeTruthy()
  })
})

test.describe('databases: page options and table layout (fix round 1)', () => {
  test('hides the full-width switch for databases', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Wide board',
    })
    const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Plain doc' })

    await page.goto(`/p/${database.id}`)
    await page.getByRole('button', { name: 'Page options' }).click()
    // Databases always use the wide column, so the switch would do nothing.
    await expect(page.getByRole('menuitemcheckbox', { name: 'Full width' })).toBeHidden()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Lock page' })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.goto(`/p/${note.id}`)
    await page.getByRole('button', { name: 'Page options' }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: 'Full width' })).toBeVisible()
  })
})
