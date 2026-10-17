import {
  test,
  expect,
  createPage,
  ensureWorkspace,
  getMe,
  getPage,
  getPublicPage,
  listRows,
  mouseDrag,
  sidebar,
  updateMe,
  updatePage,
  type APIRequestContext,
  type Page,
  type TestUser,
} from './fixtures'
import type { DatabaseProperty } from '../src/types/database'
import type { PageResponse } from '../src/types/page'

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
    // The save is queued behind the view's earlier sort writes, so the server
    // commits it a moment after the column disappears: poll for it.
    await expect
      .poll(
        async () => (await getPage(api, user, database.id)).database_views?.[0]?.hidden_properties
      )
      .toContain(status.id)

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

test.describe('databases: table rows that grow (fix round 1)', () => {
  test('table rows grow around wrapped cells and cut nothing off', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Grown rows',
    })
    const tags: DatabaseProperty = {
      id: 'tags-col',
      name: 'Tags',
      type: 'multi_select',
      options: [
        { id: 'alpha', name: 'Alpha', color: 'blue' },
        { id: 'beta', name: 'Beta', color: 'green' },
        { id: 'gamma', name: 'Gamma', color: 'orange' },
        { id: 'delta', name: 'Delta', color: 'pink' },
      ],
    }
    const shipped: DatabaseProperty = { id: 'shipped-col', name: 'Shipped', type: 'checkbox' }
    await updatePage(api, user, database.id, {
      database_schema: [...(database.database_schema ?? []), tags, shipped],
    })
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Wrapped row',
      properties: {
        [tags.id]: ['alpha', 'beta', 'gamma', 'delta'],
        [shipped.id]: true,
      },
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/p/${database.id}`)
    const row = page.getByRole('row', { name: 'Wrapped row' })
    await expect(row).toBeVisible()

    const rowBox = await row.boundingBox()
    const headerBox = await page.getByRole('columnheader', { name: 'Name' }).boundingBox()
    expect(headerBox).toBeTruthy()
    expect(rowBox!.height).toBeGreaterThan(33)
    expect(rowBox!.height).toBeGreaterThan(headerBox!.height)
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
      const chip = row.getByText(name, { exact: true })
      await expect(chip).toBeVisible()
      const chipBox = await chip.boundingBox()
      expect(chipBox, name).toBeTruthy()
      // The row's bottom border sits below every chip: nothing is cut off.
      expect(chipBox!.y + chipBox!.height, `${name} must end inside the row`).toBeLessThanOrEqual(
        rowBox!.y + rowBox!.height + 0.5
      )
    }
  })

  test('centers the checkbox in the row-properties panel', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Panel db',
    })
    const shipped: DatabaseProperty = { id: 'shipped-col', name: 'Shipped', type: 'checkbox' }
    await updatePage(api, user, database.id, {
      database_schema: [...(database.database_schema ?? []), shipped],
    })
    const rowPage = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Checked row',
      properties: { [shipped.id]: true },
    })

    // Open the database first: the row page needs the tree and the database
    // row before it can render its property panel, and both are warm then.
    await page.goto(`/p/${database.id}`)
    await expect(page.getByRole('row', { name: 'Checked row' })).toBeVisible()
    await page.goto(`/p/${rowPage.id}`)
    const panel = page.getByTestId('row-properties')
    await expect(panel).toBeVisible()

    const checkbox = page.getByRole('checkbox', { name: 'Shipped' })
    await expect(checkbox).toBeVisible()
    const checkboxBox = await checkbox.boundingBox()
    const labelBox = await panel.getByText('Shipped', { exact: true }).boundingBox()
    expect(checkboxBox).toBeTruthy()
    expect(labelBox).toBeTruthy()
    const checkboxCenter = checkboxBox!.y + checkboxBox!.height / 2
    const labelCenter = labelBox!.y + labelBox!.height / 2
    expect(Math.abs(checkboxCenter - labelCenter)).toBeLessThanOrEqual(2)
  })
})

test.describe('databases: the table on small screens (fix round 1)', () => {
  test('the public table stays inside a phone viewport', async ({ page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Phone friendly',
    })
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Narrow row',
    })
    const shared = await updatePage(api, user, database.id, { is_public: true })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/share/${shared.public_id}`)
    const table = page.getByRole('table', { name: 'Table' })
    await expect(table).toBeVisible()

    // The gutter that pulls the table into the page padding must never pull it
    // past the viewport: the scroller starts on screen and the page does not scroll.
    const scrollerBox = await page.getByTestId('database-table').boundingBox()
    expect(scrollerBox).toBeTruthy()
    expect(scrollerBox!.x).toBeGreaterThanOrEqual(-0.5)
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  })
})

test.describe('databases: table cells (fix round 2)', () => {
  test('single-line values truncate inside their cell while chips wrap', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const me = await getMe(api, user)
    await updateMe(api, user, {
      display_name: 'Maximiliana Bartholomew Featherstonehaugh-Worthington',
    })
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Long values',
    })
    const when: DatabaseProperty = { id: 'when-col', name: 'When', type: 'date' }
    const owner: DatabaseProperty = { id: 'owner-col', name: 'Owner', type: 'person' }
    const created: DatabaseProperty = { id: 'created-col', name: 'Created', type: 'created_time' }
    const tags: DatabaseProperty = {
      id: 'tags-col',
      name: 'Tags',
      type: 'multi_select',
      options: [
        { id: 'alpha', name: 'Alpha', color: 'blue' },
        { id: 'beta', name: 'Beta', color: 'green' },
        { id: 'gamma', name: 'Gamma', color: 'orange' },
        { id: 'delta', name: 'Delta', color: 'pink' },
      ],
    }
    await updatePage(api, user, database.id, {
      database_schema: [...(database.database_schema ?? []), when, owner, created, tags],
    })
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Long row',
      properties: {
        [when.id]: { start: '2026-09-30', end: '2027-12-31' },
        [owner.id]: [me.id],
        [tags.id]: ['alpha', 'beta', 'gamma', 'delta'],
      },
    })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/p/${database.id}`)
    const row = page.getByRole('row', { name: 'Long row' })
    await expect(row.getByText('Sep 30, 2026', { exact: false })).toBeVisible()
    await expect(row.getByText('Featherstonehaugh', { exact: false })).toBeVisible()
    await expect(row.getByText('Delta', { exact: true })).toBeVisible()

    const overflows = await row.evaluate(element =>
      Array.from(element.querySelectorAll('[role="cell"]')).flatMap((cell, index) => {
        const edge = cell.getBoundingClientRect().right
        return Array.from(cell.querySelectorAll('*'))
          .filter(child => child.getBoundingClientRect().right > edge + 0.5)
          .map(child => `cell ${index}: ${child.tagName} "${child.textContent}"`)
      })
    )
    expect(overflows, 'nothing paints past its cell').toEqual([])
    // Dates and names stay on one 20 px line (cut with an ellipsis), they do not wrap.
    for (const text of ['Sep 30, 2026', 'Featherstonehaugh']) {
      const box = await row.getByText(text, { exact: false }).boundingBox()
      expect(box, text).toBeTruthy()
      expect(box!.height, `${text} stays on one line`).toBeLessThanOrEqual(21)
    }
    // The chips still wrap onto more lines and grow the row past 33 px.
    expect((await row.boundingBox())!.height).toBeGreaterThan(33)
  })
})

test.describe('databases: the table on small screens (fix round 2)', () => {
  test('the row options button fits the phone gutter', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Phone rows',
    })
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Thumb row',
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/p/${database.id}`)
    const button = page.getByRole('button', { name: 'Row options for Thumb row' })
    await expect(button).toBeAttached()

    const scrollerBox = await page.getByTestId('database-table').boundingBox()
    const buttonBox = await button.boundingBox()
    expect(scrollerBox).toBeTruthy()
    expect(buttonBox).toBeTruthy()
    expect(buttonBox!.x, 'the button starts inside the scroller').toBeGreaterThanOrEqual(
      scrollerBox!.x - 0.5
    )
    expect(buttonBox!.x).toBeGreaterThanOrEqual(-0.5)
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(
      scrollerBox!.x + scrollerBox!.width + 0.5
    )
  })
})

test.describe('databases: filter and sort rules keep the open view (coverage)', () => {
  test('a filter added on a second view goes to that view and keeps its sort', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Two views',
    })
    await page.goto(`/p/${database.id}`)
    await expect(page.getByTestId('database-view')).toBeVisible()

    // A sort on the first view, then a filter on the same view.
    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await page.getByRole('button', { name: 'Add a sort' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('button', { name: 'Add a filter' }).click()
    await page.keyboard.press('Escape')
    await expect
      .poll(async () => {
        const [view] = (await getPage(api, user, database.id)).database_views ?? []
        return [view?.sorts.length, view?.filters.length]
      })
      .toEqual([1, 1])

    // A second view: its own filter must not land on the first view.
    await page.getByRole('button', { name: 'Add a view' }).click()
    await page.getByRole('menuitem', { name: 'List' }).click()
    await expect(page.getByTestId('database-list')).toBeVisible()
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('button', { name: 'Add a filter' }).click()
    await page.keyboard.press('Escape')
    await expect
      .poll(async () =>
        ((await getPage(api, user, database.id)).database_views ?? []).map(view => [
          view.type,
          view.sorts.length,
          view.filters.length,
        ])
      )
      .toEqual([
        ['table', 1, 1],
        ['list', 0, 1],
      ])
  })
})

/** The database used by the filter, sort and cell tests: one column of every kind. */
async function seedTracker(api: APIRequestContext, user: TestUser) {
  const me = await getMe(api, user)
  const workspace = await ensureWorkspace(api, user)
  const database = await createPage(api, user, {
    workspace_id: workspace.id,
    kind: 'database',
    title: 'Tracker',
  })
  const status = property(database.database_schema, 'Status')
  const optionId = (name: string) => status.options!.find(option => option.name === name)!.id
  const tags: DatabaseProperty = {
    id: 'tags-col',
    name: 'Labels',
    type: 'multi_select',
    options: [
      { id: 'alpha', name: 'Alpha', color: 'blue' },
      { id: 'beta', name: 'Beta', color: 'green' },
    ],
  }
  const extra: DatabaseProperty[] = [
    tags,
    { id: 'points-col', name: 'Points', type: 'number' },
    { id: 'due-col', name: 'Due', type: 'date' },
    { id: 'shipped-col', name: 'Shipped', type: 'checkbox' },
    { id: 'notes-col', name: 'Notes', type: 'text' },
    { id: 'link-col', name: 'Link', type: 'url' },
    { id: 'owner-col', name: 'Owner', type: 'person' },
    { id: 'created-col', name: 'Created', type: 'created_time' },
    { id: 'edited-col', name: 'Edited', type: 'last_edited_time' },
  ]
  // Drop the default Tags column: one multi-select is enough here.
  const schema = [
    ...(database.database_schema ?? []).filter(item => item.name !== 'Tags'),
    ...extra,
  ]
  await updatePage(api, user, database.id, { database_schema: schema })
  const row = (title: string, properties: Record<string, unknown>) =>
    createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title,
      properties: properties as PageResponse['properties'],
    })
  // Created one after the other, so Created/Edited sort A, B, C.
  const a = await row('Apple', {
    [status.id]: optionId('Done'),
    'tags-col': ['beta'],
    'points-col': 1,
    'due-col': { start: '2026-01-10' },
    'shipped-col': true,
    'notes-col': 'alpha one',
    'link-col': 'https://a.example.com',
  })
  const b = await row('Banana', {
    [status.id]: optionId('Not started'),
    'tags-col': ['alpha'],
    'points-col': 5,
    'due-col': { start: '2026-02-20' },
    'shipped-col': false,
    'notes-col': 'beta two',
    'owner-col': [me.id],
  })
  const c = await row('Cherry', {})
  return { database, status, optionId, a, b, c }
}

/** The titles of the table rows, top to bottom. */
function rowTitles(page: Page) {
  return page
    .locator('[data-row-id]')
    .evaluateAll(rows => rows.map(row => row.getAttribute('aria-label')))
}

async function expectRows(page: Page, titles: string[], timeout?: number) {
  await expect.poll(() => rowTitles(page), { timeout }).toEqual(titles)
}

/** Opens the database and waits for its rows: the first load compiles the views (slow under coverage). */
async function openTracker(page: Page, databaseId: string) {
  await page.goto(`/p/${databaseId}`)
  await expectRows(page, ['Apple', 'Banana', 'Cherry'], 20_000)
}

async function rowValue(api: APIRequestContext, user: TestUser, rowId: string, key: string) {
  return (await getPage(api, user, rowId)).properties?.[key] ?? null
}

test.describe('databases: filters, sorts and cells (coverage)', () => {
  test('filters numbers, dates, times and checkboxes with every operator', async ({
    authedPage: page,
    api,
    user,
  }) => {
    test.setTimeout(90_000)
    const { database } = await seedTracker(api, user)
    await openTracker(page, database.id)

    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('button', { name: 'Add a filter' }).click()
    const property = page.getByLabel('Filter property')
    const operator = page.getByLabel('Filter operator')
    const value = page.getByLabel('Filter value')

    // Number. A rule without a value hides nothing.
    await property.selectOption({ label: 'Points' })
    await expectRows(page, ['Apple', 'Banana', 'Cherry'])
    await value.fill('5') // sent after a pause in typing
    await expectRows(page, ['Banana'])
    await operator.selectOption({ label: '≠' })
    await expectRows(page, ['Apple', 'Cherry'])
    await value.fill('1')
    await value.press('Enter') // sent at once
    await operator.selectOption({ label: '>' })
    await expectRows(page, ['Banana'])
    await operator.selectOption({ label: '≥' })
    await expectRows(page, ['Apple', 'Banana'])
    await operator.selectOption({ label: '<' })
    await expect(page.getByText('No rows match the filter.')).toBeVisible()
    await value.fill('5')
    await value.blur() // sent when the field loses focus
    await expectRows(page, ['Apple'])
    await operator.selectOption({ label: '≤' })
    await expectRows(page, ['Apple', 'Banana'])
    await operator.selectOption({ label: 'Is empty' })
    await expect(value).toBeHidden()
    await expectRows(page, ['Cherry'])
    await operator.selectOption({ label: 'Is not empty' })
    await expectRows(page, ['Apple', 'Banana'])
    await expect
      .poll(async () => (await getPage(api, user, database.id)).database_views?.[0]?.filters)
      .toEqual([{ property_id: 'points-col', op: 'is_not_empty', value: null }])

    // Date.
    await property.selectOption({ label: 'Due' })
    await expectRows(page, ['Apple', 'Banana', 'Cherry'])
    await value.fill('2026-01-10')
    await expectRows(page, ['Apple'])
    await operator.selectOption({ label: 'Is before' })
    await value.fill('2026-02-20')
    await expectRows(page, ['Apple'])
    await operator.selectOption({ label: 'Is after' })
    await value.fill('2026-01-10')
    await expectRows(page, ['Banana'])
    await operator.selectOption({ label: 'Is on or before' })
    await expectRows(page, ['Apple'])
    await operator.selectOption({ label: 'Is on or after' })
    await expectRows(page, ['Apple', 'Banana'])
    await operator.selectOption({ label: 'Is empty' })
    await expectRows(page, ['Cherry'])

    // Created time: every row was made after 2000 and none before.
    await property.selectOption({ label: 'Created' })
    await operator.selectOption({ label: 'Is on or after' })
    await value.fill('2000-01-01')
    await expectRows(page, ['Apple', 'Banana', 'Cherry'])
    await operator.selectOption({ label: 'Is before' })
    await expect(page.getByText('No rows match the filter.')).toBeVisible()

    // Checkbox.
    await property.selectOption({ label: 'Shipped' })
    await expect(operator).toHaveValue('checked')
    await expectRows(page, ['Apple'])
    await operator.selectOption({ label: 'Is not checked' })
    await expectRows(page, ['Banana', 'Cherry'])
    await expect
      .poll(async () => (await getPage(api, user, database.id)).database_views?.[0]?.filters)
      .toEqual([{ property_id: 'shipped-col', op: 'unchecked', value: null }])
  })

  test('filters text, URLs, selects, multi-selects and people', async ({
    authedPage: page,
    api,
    user,
  }) => {
    test.setTimeout(90_000)
    const { database, optionId } = await seedTracker(api, user)
    await openTracker(page, database.id)

    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('button', { name: 'Add a filter' }).click()
    const property = page.getByLabel('Filter property')
    const operator = page.getByLabel('Filter operator')
    const value = page.getByLabel('Filter value')

    await property.selectOption({ label: 'Notes' })
    await value.fill('ONE')
    await expectRows(page, ['Apple'])
    await operator.selectOption({ label: 'Does not contain' })
    await expectRows(page, ['Banana', 'Cherry'])
    await operator.selectOption({ label: 'Is' })
    await value.fill('beta two')
    await expectRows(page, ['Banana'])
    await operator.selectOption({ label: 'Is not' })
    await expectRows(page, ['Apple', 'Cherry'])
    await operator.selectOption({ label: 'Starts with' })
    await value.fill('alpha')
    await expectRows(page, ['Apple'])
    await operator.selectOption({ label: 'Ends with' })
    await value.fill('two')
    await expectRows(page, ['Banana'])
    await operator.selectOption({ label: 'Is empty' })
    await expectRows(page, ['Cherry'])
    await operator.selectOption({ label: 'Is not empty' })
    await expectRows(page, ['Apple', 'Banana'])

    await property.selectOption({ label: 'Link' })
    await value.fill('a.example')
    await expectRows(page, ['Apple'])

    await property.selectOption({ label: 'Status' })
    await value.selectOption({ label: 'Done' })
    await expectRows(page, ['Apple'])
    await operator.selectOption({ label: 'Is not' })
    await expectRows(page, ['Banana', 'Cherry'])

    await property.selectOption({ label: 'Labels' })
    await expect(operator).toHaveValue('contains')
    await value.selectOption({ label: 'Alpha' })
    await expectRows(page, ['Banana'])
    await operator.selectOption({ label: 'Does not contain' })
    await expectRows(page, ['Apple', 'Cherry'])

    await property.selectOption({ label: 'Owner' })
    await value.selectOption({ index: 1 })
    await expectRows(page, ['Banana'])
    await operator.selectOption({ label: 'Is empty' })
    await expectRows(page, ['Apple', 'Cherry'])

    // A second rule narrows the rows further: both must pass.
    await page.getByRole('button', { name: 'Add a filter' }).click()
    const second = page.getByTestId('filter-rule').nth(1)
    await second.getByLabel('Filter property').selectOption({ label: 'Status' })
    await second.getByLabel('Filter value').selectOption({ label: 'Done' })
    await expectRows(page, ['Apple'])
    await second.getByRole('button', { name: 'Remove filter' }).click()
    await expectRows(page, ['Apple', 'Cherry'])
    await expect
      .poll(async () => (await getPage(api, user, database.id)).database_views?.[0]?.filters)
      .toEqual([{ property_id: 'owner-col', op: 'is_empty', value: null }])
    expect(optionId('Done')).toBeTruthy()
  })

  test('sorts by every kind of property', async ({ authedPage: page, api, user }) => {
    test.setTimeout(90_000)
    const { database, a } = await seedTracker(api, user)
    await openTracker(page, database.id)

    await page.getByRole('button', { name: 'Sort', exact: true }).click()
    await page.getByRole('button', { name: 'Add a sort' }).click()
    const property = page.getByLabel('Sort property')
    const direction = page.getByLabel('Sort direction')

    // Empty values go last in both directions.
    const cases: [string, string[], string[]][] = [
      ['Points', ['Apple', 'Banana', 'Cherry'], ['Banana', 'Apple', 'Cherry']],
      ['Shipped', ['Apple', 'Banana', 'Cherry'], ['Apple', 'Banana', 'Cherry']],
      ['Status', ['Banana', 'Apple', 'Cherry'], ['Apple', 'Banana', 'Cherry']],
      ['Labels', ['Banana', 'Apple', 'Cherry'], ['Apple', 'Banana', 'Cherry']],
      ['Due', ['Apple', 'Banana', 'Cherry'], ['Banana', 'Apple', 'Cherry']],
      ['Notes', ['Apple', 'Banana', 'Cherry'], ['Banana', 'Apple', 'Cherry']],
      ['Owner', ['Banana', 'Apple', 'Cherry'], ['Banana', 'Apple', 'Cherry']],
      ['Created', ['Apple', 'Banana', 'Cherry'], ['Cherry', 'Banana', 'Apple']],
      ['Edited', ['Apple', 'Banana', 'Cherry'], ['Cherry', 'Banana', 'Apple']],
    ]
    for (const [name, ascending, descending] of cases) {
      await property.selectOption({ label: name })
      await direction.selectOption('asc')
      await expectRows(page, ascending)
      await direction.selectOption('desc')
      await expectRows(page, descending)
    }
    await expect
      .poll(async () => (await getPage(api, user, database.id)).database_views?.[0]?.sorts)
      .toEqual([{ property_id: 'edited-col', direction: 'desc' }])

    // A tie on the first rule falls to the second one.
    await property.selectOption({ label: 'Shipped' })
    await page.getByRole('button', { name: 'Add a sort' }).click()
    await page.getByTestId('sort-rule').nth(1).getByLabel('Sort property').selectOption({
      label: 'Points',
    })
    await expectRows(page, ['Apple', 'Banana', 'Cherry'])
    await page.getByTestId('sort-rule').nth(1).getByLabel('Sort direction').selectOption('desc')
    await expectRows(page, ['Apple', 'Banana', 'Cherry'])
    await page.getByTestId('sort-rule').first().getByRole('button', { name: 'Remove sort' }).click()
    await expectRows(page, ['Banana', 'Apple', 'Cherry'])
    await page.getByRole('button', { name: 'Delete sort' }).click()
    await expectRows(page, ['Apple', 'Banana', 'Cherry'])
    await page.keyboard.press('Escape')

    // The column menu sorts too, and hides the column in this view.
    await page.getByRole('columnheader').filter({ hasText: 'Points' }).locator('button').click()
    await page.getByRole('button', { name: 'Sort descending' }).click()
    await expectRows(page, ['Banana', 'Apple', 'Cherry'])
    await page.getByRole('columnheader').filter({ hasText: 'Points' }).locator('button').click()
    await page.getByRole('button', { name: 'Sort ascending' }).click()
    await expectRows(page, ['Apple', 'Banana', 'Cherry'])
    await page.getByRole('columnheader').filter({ hasText: 'Points' }).locator('button').click()
    await page.getByRole('button', { name: 'Hide in view' }).click()
    await expect(page.getByRole('columnheader').filter({ hasText: 'Points' })).toHaveCount(0)
    await expect
      .poll(async () => (await getPage(api, user, database.id)).database_views?.[0])
      .toMatchObject({
        sorts: [{ property_id: 'points-col', direction: 'asc' }],
        hidden_properties: ['points-col'],
      })
    expect(a.id).toBeTruthy()
  })

  test('edits number, text, date and title cells', async ({ authedPage: page, api, user }) => {
    test.setTimeout(90_000)
    const { database, a, c } = await seedTracker(api, user)
    await page.goto(`/p/${database.id}`)
    const apple = page.getByRole('row', { name: 'Apple' })
    const cherry = page.getByRole('row', { name: 'Cherry' })
    await expect(apple).toBeVisible({ timeout: 20_000 })

    // Number: Enter saves, an empty field clears, text and Escape keep the value.
    await apple.getByRole('button', { name: 'Points: 1' }).click()
    await apple.getByLabel('Points', { exact: true }).fill('7')
    await apple.getByLabel('Points', { exact: true }).press('Enter')
    await expect.poll(() => rowValue(api, user, a.id, 'points-col')).toBe(7)
    await apple.getByRole('button', { name: 'Points: 7' }).click()
    await apple.getByLabel('Points', { exact: true }).fill('  ')
    await apple.getByLabel('Points', { exact: true }).press('Enter')
    await expect.poll(() => rowValue(api, user, a.id, 'points-col')).toBeNull()
    await apple.getByRole('button', { name: 'Points: empty' }).click()
    await apple.getByLabel('Points', { exact: true }).fill('lots')
    await apple.getByLabel('Points', { exact: true }).press('Enter')
    await expect(apple.getByRole('button', { name: 'Points: empty' })).toBeVisible()
    await apple.getByRole('button', { name: 'Points: empty' }).click()
    await apple.getByLabel('Points', { exact: true }).fill('9')
    await apple.getByLabel('Points', { exact: true }).press('Escape')
    await expect(apple.getByRole('button', { name: 'Points: empty' })).toBeVisible()
    await apple.getByRole('button', { name: 'Points: empty' }).click()
    await apple.getByLabel('Points', { exact: true }).fill('3.5')
    await apple.getByLabel('Points', { exact: true }).blur()
    await expect(apple.getByRole('button', { name: 'Points: 3.5' })).toBeVisible()
    await expect.poll(() => rowValue(api, user, a.id, 'points-col')).toBe(3.5)
    expect(await rowValue(api, user, a.id, 'points-col')).toBe(3.5)

    // Text.
    await cherry.getByRole('button', { name: 'Notes: empty' }).click()
    await cherry.getByLabel('Notes', { exact: true }).fill('gamma three')
    await cherry.getByLabel('Notes', { exact: true }).press('Enter')
    await expect(cherry.getByRole('button', { name: 'Notes: gamma three' })).toBeVisible()
    await expect.poll(() => rowValue(api, user, c.id, 'notes-col')).toBe('gamma three')

    // Date: set a day, add an end date, move it, drop it, then clear the value.
    await cherry.getByRole('button', { name: 'Due of Cherry' }).click()
    const end = page.getByRole('checkbox', { name: 'End date' })
    await expect(end).toBeDisabled()
    await page.getByLabel('Date', { exact: true }).fill('2026-03-01')
    await expect.poll(() => rowValue(api, user, c.id, 'due-col')).toEqual({ start: '2026-03-01' })
    // A controlled box: it shows the saved value, so click and wait for it.
    await end.click()
    await expect(end).toBeChecked()
    await expect
      .poll(() => rowValue(api, user, c.id, 'due-col'))
      .toEqual({ start: '2026-03-01', end: '2026-03-01' })
    await page.getByRole('textbox', { name: 'End date' }).fill('2026-03-05')
    await expect
      .poll(() => rowValue(api, user, c.id, 'due-col'))
      .toEqual({ start: '2026-03-01', end: '2026-03-05' })
    await page.getByLabel('Date', { exact: true }).fill('2026-03-02')
    await expect
      .poll(() => rowValue(api, user, c.id, 'due-col'))
      .toEqual({ start: '2026-03-02', end: '2026-03-05' })
    await end.click()
    await expect(end).not.toBeChecked()
    await expect.poll(() => rowValue(api, user, c.id, 'due-col')).toEqual({ start: '2026-03-02' })
    await page.getByLabel('Date', { exact: true }).fill('')
    await expect.poll(() => rowValue(api, user, c.id, 'due-col')).toBeNull()
    await page.getByLabel('Date', { exact: true }).fill('2026-04-01')
    await expect(cherry.getByText('Apr 1, 2026')).toBeVisible()
    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByLabel('Date', { exact: true })).toBeHidden()
    await expect.poll(() => rowValue(api, user, c.id, 'due-col')).toBeNull()

    // A new type for a column clears the values the old type stored.
    await page.getByRole('columnheader').filter({ hasText: 'Labels' }).locator('button').click()
    await page
      .getByRole('list', { name: 'Property type' })
      .getByRole('button', { name: 'Text', exact: true })
      .click()
    await expect.poll(() => rowValue(api, user, a.id, 'tags-col')).toBeNull()
    await expect(apple.getByRole('button', { name: 'Labels: empty' })).toBeVisible()

    // Title: Escape drops the draft.
    await cherry.getByRole('button', { name: 'Title: Cherry' }).click()
    await page.getByLabel('Row title').fill('Not kept')
    await page.getByLabel('Row title').press('Escape')
    await expect(cherry.getByRole('button', { name: 'Title: Cherry' })).toBeVisible()
    expect((await getPage(api, user, c.id)).title).toBe('Cherry')
  })

  test('renames an option and picks the first one with Enter', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const { database, status, optionId, c } = await seedTracker(api, user)
    await page.goto(`/p/${database.id}`)
    const cherry = page.getByRole('row', { name: 'Cherry' })
    await expect(cherry).toBeVisible({ timeout: 20_000 })

    // Enter on an empty search picks the first option.
    await cherry.getByRole('button', { name: 'Status of Cherry' }).click()
    await page.getByLabel('Search or create an option').press('Enter')
    await expect.poll(() => rowValue(api, user, c.id, status.id)).toBe(optionId('Not started'))

    await cherry.getByRole('button', { name: 'Status of Cherry' }).click()
    await page.getByRole('button', { name: 'Edit option Done' }).click()
    const name = page.getByLabel('Option name')
    await name.fill('Finished')
    await name.press('Enter')
    await expect
      .poll(async () =>
        (await getPage(api, user, database.id)).database_schema
          ?.find(item => item.id === status.id)
          ?.options?.map(option => option.name)
      )
      .toEqual(['Not started', 'In progress', 'Finished'])
    await expect(page.getByRole('row', { name: 'Apple' }).getByText('Finished')).toBeVisible()
  })

  test('switches a view to a board grouped by the first select', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const { database, status } = await seedTracker(api, user)
    await page.goto(`/p/${database.id}`)
    await expect(page.getByTestId('database-table')).toBeVisible()

    await page.getByRole('button', { name: 'View options for Table' }).click()
    await page.getByRole('button', { name: 'Board', exact: true }).click()
    await expect(page.getByTestId('database-board')).toBeVisible()
    await expect(page.getByTestId('board-column').filter({ hasText: 'Done' })).toContainText(
      'Apple'
    )
    await expect(page.getByLabel('Group by')).toHaveValue(status.id)
    await expect
      .poll(async () => (await getPage(api, user, database.id)).database_views?.[0])
      .toMatchObject({ type: 'board', group_by: status.id })

    await page.getByRole('button', { name: 'List', exact: true }).click()
    await expect(page.getByTestId('database-list')).toBeVisible()
  })

  test('shows untitled rows and covers in the gallery and the list', async ({
    authedPage: page,
    page: anonymous,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Cards',
    })
    const status = property(database.database_schema, 'Status')
    const done = status.options!.find(option => option.name === 'Done')!
    const tags = property(database.database_schema, 'Tags')
    const site: DatabaseProperty = { id: 'site-col', name: 'Site', type: 'url' }
    const points: DatabaseProperty = { id: 'points-col', name: 'Points', type: 'number' }
    // Cards show their first three visible properties: Status, Site and Points.
    const hidden = [tags.id]
    await updatePage(api, user, database.id, {
      database_schema: [...(database.database_schema ?? []), site, points],
      database_views: [
        {
          id: 'g',
          name: 'Cards',
          type: 'gallery',
          sorts: [],
          filters: [],
          hidden_properties: hidden,
        },
        { id: 'l', name: 'Lines', type: 'list', sorts: [], filters: [], hidden_properties: hidden },
      ],
    })
    const covered = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'With cover',
      icon: '🌊',
      properties: { [status.id]: done.id, [site.id]: 'https://wave.example.com', [points.id]: 8 },
    })
    await updatePage(api, user, covered.id, { cover: 'gradient-2' })
    const untitled = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: '',
    })

    await page.goto(`/p/${database.id}`)
    const gallery = page.getByTestId('database-gallery')
    await expect(gallery.getByRole('button', { name: 'Open With cover' })).toContainText('Done')
    await expect(gallery.getByRole('button', { name: 'Open With cover' })).toContainText('8')
    await expect(gallery.getByRole('button', { name: 'Open With cover' })).toContainText(
      'https://wave.example.com'
    )
    await gallery.getByRole('button', { name: 'Open Untitled' }).click()
    await expect(page).toHaveURL(`/p/${untitled.id}`)
    await page.goBack()

    await page.getByRole('tab', { name: 'Lines' }).click()
    const list = page.getByTestId('database-list')
    await expect(list.getByRole('button', { name: 'With cover' })).toBeVisible()
    await list.getByRole('button', { name: 'Untitled' }).click()
    await expect(page).toHaveURL(`/p/${untitled.id}`)

    // The public page shows the same cards, without links into the app.
    const shared = await updatePage(api, user, database.id, { is_public: true })
    await anonymous.goto(`/share/${shared.public_id}`)
    const publicGallery = anonymous.getByTestId('database-gallery')
    await expect(publicGallery.getByText('With cover')).toBeVisible()
    await expect(publicGallery.getByText('Untitled')).toBeVisible()
    await expect(publicGallery.getByRole('button')).toHaveCount(0)
    await anonymous.getByRole('tab', { name: 'Lines' }).click()
    await expect(anonymous.getByTestId('database-list').getByText('Untitled')).toBeVisible()
    await expect(anonymous.getByTestId('database-list').getByRole('button')).toHaveCount(0)
    expect((await getPublicPage(api, shared.public_id!)).rows).toHaveLength(2)
  })
})

test.describe('databases: board columns (coverage)', () => {
  test('moves cards to "No Status" and back, shows the board read-only on the web', async ({
    authedPage: page,
    page: anonymous,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Kanban',
    })
    const status = property(database.database_schema, 'Status')
    const done = status.options!.find(option => option.name === 'Done')!
    await updatePage(api, user, database.id, {
      database_views: [
        { id: 'b', name: 'Board', type: 'board', sorts: [], filters: [], hidden_properties: [] },
      ],
    })
    const card = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Card',
      properties: { [status.id]: done.id },
    })
    const untitled = await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: '',
    })
    const statusOf = async (id: string) =>
      (await listRows(api, user, database.id)).find(row => row.id === id)?.properties[status.id] ??
      null

    // Wide enough for all four columns, so every drop target is on screen.
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto(`/p/${database.id}`)
    const column = (name: string) => page.getByTestId('board-column').filter({ hasText: name })
    await expect(column('No Status')).toContainText('Untitled')

    await mouseDrag(page, page.getByRole('button', { name: 'Drag Card' }), column('No Status'))
    await expect.poll(() => statusOf(card.id)).toBeNull()
    await mouseDrag(
      page,
      page.getByRole('button', { name: 'Drag Untitled' }).first(),
      column('Done')
    )
    await expect.poll(() => statusOf(untitled.id)).toBe(done.id)
    // A drop on its own column changes nothing.
    await mouseDrag(page, page.getByRole('button', { name: 'Drag Card' }), column('No Status'))
    await expect(column('No Status')).toContainText('Card')
    expect(await statusOf(card.id)).toBeNull()

    // On the web the board is read-only: no drag handles, no "+ New".
    const shared = await updatePage(api, user, database.id, { is_public: true })
    await anonymous.goto(`/share/${shared.public_id}`)
    const publicBoard = anonymous.getByTestId('database-board')
    await expect(publicBoard.getByTestId('board-card')).toHaveCount(2)
    await expect(publicBoard.getByRole('button')).toHaveCount(0)

    // Without a select property every card sits in one "No Status" column.
    await updatePage(api, user, database.id, {
      database_schema: (database.database_schema ?? []).filter(item => item.type !== 'select'),
    })
    await page.reload()
    await expect(page.getByTestId('board-column')).toHaveCount(1)
    await expect(column('No Status')).toContainText('Card')
    await expect(column('No Status')).toContainText('Untitled')
    await page.getByRole('button', { name: 'View options for Board' }).click()
    await expect(page.getByLabel('Group by')).toBeDisabled()
    await expect(page.getByLabel('Group by')).toContainText('No select property')
  })
})
