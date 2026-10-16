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
    expect((await listRows(api, user, database.id)).map(row => row.title)).toContain('Fresh')

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
    const shared = await updatePage(api, user, database.id, { is_public: true })
    await page.goto(`/share/${shared.public_id}`)
    await expect(page.getByTestId('database-view')).toBeVisible()
    await expect(page.getByRole('row', { name: 'Visible row' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New row' })).toBeHidden()
  })
})
