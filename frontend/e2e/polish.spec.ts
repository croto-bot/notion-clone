import { test, expect, createPage, ensureWorkspace, updatePage } from './fixtures'
import type { DatabaseProperty } from '../src/types/database'

test.describe('brand, theme and database layout', () => {
  test('paints a saved dark theme from the head script', async ({ page }) => {
    const first = await page.goto('/')
    const html = await first?.text()
    expect(html).toBeTruthy()
    const head = html!.slice(0, html!.indexOf('</head>'))
    expect(head).toContain('nx-theme')
    expect(head).toContain('prefers-color-scheme')

    await page.evaluate(() => localStorage.setItem('nx-theme', 'dark'))
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(25, 25, 25)')
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#191919')

    await page.evaluate(() => localStorage.setItem('nx-theme', 'light'))
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#ffffff')
    await expect(page).toHaveTitle('Noted')
  })

  test('searches the workspace by name and collapses the sidebar', async ({
    authedPage: page,
    api,
    user,
  }) => {
    const workspace = await ensureWorkspace(api, user)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/home')
    await expect(page.getByTestId('workspace-name')).toHaveText(workspace.name)

    await page.keyboard.press('Control+p')
    await expect(page.getByPlaceholder(`Search ${workspace.name}…`)).toBeVisible()
    await page.keyboard.press('Escape')

    const sidebar = page.getByTestId('sidebar')
    await expect(sidebar).toHaveCSS('transition-duration', '0.2s')
    expect((await sidebar.boundingBox())!.width).toBeGreaterThan(200)
    await page.keyboard.press('Control+Backslash')
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 999).toBeLessThan(2)
  })

  test('lays a database out like a wide table', async ({ authedPage: page, api, user }) => {
    const workspace = await ensureWorkspace(api, user)
    const database = await createPage(api, user, {
      workspace_id: workspace.id,
      kind: 'database',
      title: 'Tasks',
    })
    await createPage(api, user, {
      workspace_id: workspace.id,
      parent_id: database.id,
      title: 'Ship it',
    })
    const schema = database.database_schema ?? []
    const extra: DatabaseProperty[] = Array.from({ length: 8 }, (_, index) => ({
      id: `extra-${index}`,
      name: `Column ${index}`,
      type: 'text',
    }))
    await updatePage(api, user, database.id, { database_schema: [...schema, ...extra] })

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`/p/${database.id}`)
    await expect(page).toHaveTitle('Tasks | Noted')

    const sidebar = page.getByTestId('sidebar')
    const tabs = page.getByRole('tablist', { name: 'Database views' })
    const table = page.getByRole('table', { name: 'Table' })
    await expect(table).toBeVisible()

    const sidebarBox = await sidebar.boundingBox()
    const tabsBox = await tabs.boundingBox()
    const tableBox = await table.boundingBox()
    expect(sidebarBox).toBeTruthy()
    expect(tabsBox).toBeTruthy()
    expect(tableBox).toBeTruthy()
    expect(Math.abs(tabsBox!.x - tableBox!.x)).toBeLessThan(1.5)
    expect(Math.abs(tabsBox!.x - (sidebarBox!.x + sidebarBox!.width + 96))).toBeLessThan(2)

    const header = page.getByRole('columnheader', { name: 'Name' })
    const headerBox = await header.boundingBox()
    expect(Math.round(headerBox!.height)).toBe(33)
    await expect(header).toHaveCSS('font-size', '14px')
    const border = await header.evaluate(element => getComputedStyle(element).borderRightColor)
    expect(border.replaceAll(' ', '')).toBe('rgba(55,53,47,0.09)')

    const row = page.getByRole('row', { name: 'Ship it' })
    expect(Math.round((await row.boundingBox())!.height)).toBe(33)

    const scroller = page.getByTestId('database-table')
    const overflow = await scroller.evaluate(element => ({
      overflowX: getComputedStyle(element).overflowX,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    expect(overflow.overflowX).toBe('auto')
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth)

    await page.getByRole('button', { name: 'Add a view' }).click()
    await page.getByRole('menuitem', { name: 'Board' }).click()
    const column = page.getByTestId('board-column').first()
    await expect(column).toBeVisible()
    await expect(column).toHaveCSS('width', '260px')
    const chip = column.locator('[data-color]').first()
    await expect(chip).toBeVisible()
    const chipColor = await chip.evaluate(element => getComputedStyle(element).backgroundColor)
    expect(chipColor).not.toBe('rgba(0, 0, 0, 0)')
  })
})

test.describe('sidebar resize handle (fix round 1)', () => {
  test('shows a visible outline when the resize handle takes keyboard focus', async ({
    authedPage: page,
  }) => {
    await page.goto('/home')
    const handle = page.getByRole('slider', { name: 'Resize sidebar' })
    await expect(handle).toBeVisible()

    // Real keyboard navigation: Tab until the focus lands on the handle.
    for (let i = 0; i < 30; i++) {
      if (await handle.evaluate(el => el === document.activeElement)) break
      await page.keyboard.press('Tab')
    }
    await expect(handle).toBeFocused()

    const outline = await handle.evaluate(el => {
      const style = getComputedStyle(el)
      return { width: style.outlineWidth, style: style.outlineStyle }
    })
    expect(outline.style).toBe('solid')
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2)
    // The ring's base color at full strength: 3.6:1 on the light sidebar,
    // 4.5:1 on the dark one (var(--ring) at 0.57 alpha is ~2:1). The handle
    // transitions colors, so the computed value settles after focus lands.
    await expect
      .poll(async () => handle.evaluate(el => getComputedStyle(el).outlineColor))
      .toBe('rgb(35, 131, 226)')
  })

  test('never lands on the resize handle while the sidebar is collapsed', async ({
    authedPage: page,
  }) => {
    await page.goto('/home')
    // The shortcut listener mounts with the shell: wait for it before pressing.
    await expect(page.getByTestId('workspace-name')).toBeVisible()
    await page.keyboard.press('Control+Backslash')
    const sidebar = page.getByTestId('sidebar')
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 999).toBeLessThan(2)

    const focusIsHandle = () =>
      page.evaluate(() => {
        const el = document.activeElement
        return (
          !!el &&
          el.getAttribute('role') === 'slider' &&
          el.getAttribute('aria-label') === 'Resize sidebar'
        )
      })
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      expect(await focusIsHandle(), `Tab ${i + 1} landed on the handle`).toBe(false)
    }
  })
})

test.describe('favicon (fix round 2)', () => {
  test('picks a light or dark SVG by the color scheme and keeps the ico', async ({ page }) => {
    const response = await page.goto('/')
    const html = await response?.text()
    expect(html).toBeTruthy()
    const head = html!.slice(0, html!.indexOf('</head>'))
    const icons = [...head.matchAll(/<link[^>]*rel="icon"[^>]*>/g)].map(match => match[0])

    const fills: Record<string, string> = {}
    for (const scheme of ['light', 'dark']) {
      const link = icons.find(tag => tag.includes(`media="(prefers-color-scheme: ${scheme})"`))
      expect(link, `an icon link for ${scheme} chrome`).toBeTruthy()
      expect(link).toContain('type="image/svg+xml"')
      const href = /href="([^"]+)"/.exec(link!)![1]
      const svg = await page.request.get(href)
      expect(svg.ok(), href).toBeTruthy()
      const body = await svg.text()
      // Hardcoded fills: browsers that ignore media queries inside a favicon still get the right ink.
      expect(body).not.toContain('@media')
      fills[scheme] = /fill="(#[0-9a-f]{6})"/i.exec(body)![1]
    }
    expect(fills.light).not.toBe(fills.dark)

    const ico = icons.find(tag => tag.includes('href="/favicon.ico"'))
    expect(ico).toContain('sizes="16x16 32x32 48x48"')
    expect((await page.request.get('/favicon.ico')).ok()).toBeTruthy()
  })
})
