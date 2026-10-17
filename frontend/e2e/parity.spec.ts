import {
  test,
  expect,
  createPage,
  ensureWorkspace,
  pageCollabPath,
  sidebarPage,
  trashPage,
  updatePage,
  type Locator,
  type Page,
} from './fixtures'

/**
 * Measured Notion parity (docs/notion-parity.md). Every value below comes
 * from that table; each surface is measured from computed styles and
 * bounding boxes in the light and the dark theme. Set PARITY_SHOTS_DIR to
 * also save one screenshot per surface and theme.
 */

type Theme = 'light' | 'dark'

const PALETTE = {
  light: {
    text: 'rgb(55, 53, 47)',
    page: 'rgb(255, 255, 255)',
    sidebar: 'rgb(247, 247, 245)',
    hover: 'rgba(55, 53, 47, 0.06)',
    border: 'rgba(55, 53, 47, 0.09)',
    popover: 'rgb(255, 255, 255)',
    codeBlock: 'rgb(247, 246, 243)',
    menuShadow:
      'rgba(15, 15, 15, 0.05) 0 0 0 1px, rgba(15, 15, 15, 0.1) 0 3px 6px, rgba(15, 15, 15, 0.2) 0 9px 24px',
  },
  dark: {
    text: 'rgba(255, 255, 255, 0.81)',
    page: 'rgb(25, 25, 25)',
    sidebar: 'rgb(32, 32, 32)',
    hover: 'rgba(255, 255, 255, 0.055)',
    border: 'rgba(255, 255, 255, 0.094)',
    popover: 'rgb(37, 37, 37)',
    codeBlock: 'rgba(255, 255, 255, 0.03)',
    menuShadow:
      'rgba(15, 15, 15, 0.2) 0 0 0 1px, rgba(15, 15, 15, 0.2) 0 3px 6px, rgba(15, 15, 15, 0.4) 0 9px 24px',
  },
} as const

const METRICS = {
  viewport: { width: 1440, height: 1000 },
  fontFamilyStart: 'ui-sans-serif, -apple-system, BlinkMacSystemFont',
  codeFontFamilyStart: 'SFMono-Regular, Menlo, Consolas',
  sidebarWidth: 240,
  sidebarRowHeight: { min: 27, max: 30 },
  uiFontSize: 14,
  topbarHeight: 45,
  contentWidth: 708,
  fullWidthPadding: 96,
  coverViewportShare: 0.3,
  iconSize: 78,
  title: { fontSize: 40, fontWeight: '700', lineHeight: 48 },
  body: { fontSize: 16, lineHeight: 24, blockPaddingY: 3 },
  headings: [
    { level: 1, fontSize: 30, marginTop: 32 },
    { level: 2, fontSize: 24, marginTop: 22.4 },
    { level: 3, fontSize: 20, marginTop: 16 },
  ],
  headingWeight: '600',
  todoBox: 16,
  listGutter: 24,
  quote: { fontSize: 19.2, borderWidth: 3, paddingLeft: 14 },
  codeFontSize: 13.6,
  menuItemHeight: 28,
  menuRadius: 6,
  slashMenu: { width: 324, itemHeight: 28, iconSize: 20 },
  toolbarButton: 28,
  quickFindWidth: 755,
  settings: { width: 1150, height: 715 },
  databaseRowHeight: 33,
  boardColumnWidth: 260,
  galleryCardMinWidth: 260,
  transitionMs: { min: 100, max: 200 },
  sidebarCollapseMs: 200,
  maxCls: 0.02,
} as const

/** Pixel tolerance for sizes; colors and font weights are exact. */
const TOLERANCE = 1

// ---------------------------------------------------------------------------
// Measuring helpers
// ---------------------------------------------------------------------------

async function css(locator: Locator, property: string, pseudo?: string): Promise<string> {
  return locator.evaluate(
    (element, [name, after]) => getComputedStyle(element, after).getPropertyValue(name),
    [property, pseudo ?? null] as const
  )
}

async function px(locator: Locator, property: string, pseudo?: string): Promise<number> {
  return parseFloat(await css(locator, property, pseudo))
}

async function box(locator: Locator) {
  const found = await locator.boundingBox()
  expect(found, 'element has a box').toBeTruthy()
  return found!
}

/**
 * A computed shadow as `color x y blur spread` layers, without units and
 * without the transparent layers Tailwind's ring utilities add, so equal
 * shadows compare equal.
 */
function normalizeShadow(value: string): string {
  return value
    .split(/,(?![^(]*\))/)
    .map(layer => layer.replaceAll('px', '').replace(/\s+/g, ' ').replaceAll(', ', ',').trim())
    .filter(layer => !layer.startsWith('rgba(0,0,0,0)'))
    .map(layer => (layer.split(' ').length === 4 ? `${layer} 0` : layer))
    .join(', ')
}

/** The longest duration of a computed `transition-duration` list, in ms. */
function longestMs(value: string): number {
  return Math.max(
    ...value.split(',').map(part => {
      const trimmed = part.trim()
      return trimmed.endsWith('ms') ? parseFloat(trimmed) : parseFloat(trimmed) * 1000
    })
  )
}

function near(actual: number, expected: number, label: string, tolerance = TOLERANCE) {
  expect
    .soft(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`)
    .toBeLessThanOrEqual(tolerance)
}

async function expectColor(locator: Locator, property: string, expected: string, label: string) {
  expect.soft(await css(locator, property), label).toBe(expected)
}

async function expectMenuChrome(locator: Locator, theme: Theme, label: string) {
  await expectColor(locator, 'background-color', PALETTE[theme].popover, `${label} background`)
  expect
    .soft(normalizeShadow(await css(locator, 'box-shadow')), `${label} shadow`)
    .toBe(normalizeShadow(PALETTE[theme].menuShadow))
  near(await px(locator, 'border-top-left-radius'), METRICS.menuRadius, `${label} radius`)
  near(await px(locator, 'font-size'), METRICS.uiFontSize, `${label} font size`)
}

async function expectTransition(locator: Locator, label: string) {
  const ms = longestMs(await css(locator, 'transition-duration'))
  expect.soft(ms, `${label} transition ${ms} ms`).toBeGreaterThanOrEqual(METRICS.transitionMs.min)
  expect.soft(ms, `${label} transition ${ms} ms`).toBeLessThanOrEqual(METRICS.transitionMs.max)
}

/** Sum of the layout-shift scores the page has buffered since it loaded. */
async function cumulativeLayoutShift(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>(resolve => {
        let total = 0
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries() as (PerformanceEntry & {
            value: number
            hadRecentInput: boolean
          })[]) {
            if (!entry.hadRecentInput) total += entry.value
          }
        })
        observer.observe({ type: 'layout-shift', buffered: true })
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            observer.disconnect()
            resolve(total)
          })
        )
      })
  )
}

/** Waits for the open animations of a menu or dialog, so sizes are final. */
async function settle(locator: Locator) {
  await expect(locator).toBeVisible()
  await locator.evaluate(element =>
    Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished))
  )
}

/** Asserts the load CLS and records it on the report. */
async function expectStableLoad(page: Page, surface: string) {
  const cls = await cumulativeLayoutShift(page)
  test.info().annotations.push({ type: 'CLS', description: `${surface}: ${cls.toFixed(4)}` })
  expect.soft(cls, `${surface} CLS`).toBeLessThanOrEqual(METRICS.maxCls)
}

/** The 78 px page icon that overlaps the bottom of the cover. */
async function expectPageIcon(page: Page, coverBox: { y: number; height: number }) {
  const icon = page.getByTestId('page-icon')
  const iconBox = await box(icon)
  near(iconBox.width, METRICS.iconSize, 'icon box')
  const emojiSize = await icon.evaluate(element =>
    parseFloat(getComputedStyle(element.querySelector('span') ?? element).fontSize)
  )
  near(emojiSize, METRICS.iconSize, 'icon size')
  expect.soft(iconBox.y, 'icon overlaps the cover').toBeLessThan(coverBox.y + coverBox.height)
}

/** Text of the editor block that holds the caret. */
async function activeBlockText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode
    const element = anchor instanceof Element ? anchor : anchor?.parentElement
    return element?.closest('.bn-block-content')?.textContent ?? null
  })
}

const shots = process.env.PARITY_SHOTS_DIR

async function shoot(page: Page, surface: string, theme: Theme) {
  if (!shots) return
  await page.screenshot({ path: `${shots}/${surface}-${theme}.png` })
}

async function openApp(page: Page, theme: Theme, path: string) {
  await page.setViewportSize(METRICS.viewport)
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' })
  await page.goto(path)
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
}

async function expectThemeBase(page: Page, theme: Theme, label: string) {
  const body = page.locator('body')
  await expectColor(body, 'color', PALETTE[theme].text, `${label} text`)
  await expectColor(page.locator('html'), 'background-color', PALETTE[theme].page, `${label} page`)
  expect.soft(await css(body, 'font-family'), `${label} font`).toContain(METRICS.fontFamilyStart)
}

const MARKDOWN = [
  'A paragraph with plain text.',
  '',
  '# Heading one',
  '',
  '## Heading two',
  '',
  '### Heading three',
  '',
  '- [ ] A to-do',
  '',
  '- A bullet',
  '',
  '> A quote',
  '',
  '```',
  'const code = true',
  '```',
  '',
  'The last paragraph.',
].join('\n')

// ---------------------------------------------------------------------------
// Surfaces, once per theme
// ---------------------------------------------------------------------------

for (const theme of ['light', 'dark'] as const) {
  test.describe(`Notion parity (${theme})`, () => {
    test('landing and login', async ({ page }) => {
      await openApp(page, theme, '/')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectThemeBase(page, theme, 'landing')
      await expectStableLoad(page, `landing (${theme})`)
      await shoot(page, 'landing', theme)

      await page.goto('/login')
      await expect(page).toHaveURL('/login')
      const email = page.getByLabel('Email')
      await expect(email).toBeVisible()
      await expectThemeBase(page, theme, 'login')
      near(await px(email, 'font-size'), METRICS.uiFontSize, 'login input font size')
      await expectStableLoad(page, `login (${theme})`)
      await shoot(page, 'login', theme)
    })

    test('home, sidebar, top bar and the shell menus', async ({ authedPage: page, api, user }) => {
      const workspace = await ensureWorkspace(api, user)
      await createPage(api, user, { workspace_id: workspace.id, title: 'Tree row' })
      const trashed = await createPage(api, user, { workspace_id: workspace.id, title: 'Gone' })
      await trashPage(api, user, trashed.id)

      await openApp(page, theme, '/home')
      await expect(page.getByTestId('workspace-name')).toHaveText(workspace.name)
      await expectThemeBase(page, theme, 'home')
      await shoot(page, 'home', theme)

      const bar = page.getByTestId('sidebar')
      await expectColor(bar, 'background-color', PALETTE[theme].sidebar, 'sidebar background')
      near((await box(bar)).width, METRICS.sidebarWidth, 'sidebar width')
      const home = page.getByRole('link', { name: 'Home' })
      const homeBox = await box(home)
      expect
        .soft(homeBox.height, 'sidebar row height')
        .toBeGreaterThanOrEqual(METRICS.sidebarRowHeight.min)
      expect
        .soft(homeBox.height, 'sidebar row height')
        .toBeLessThanOrEqual(METRICS.sidebarRowHeight.max)
      near(await px(home, 'font-size'), METRICS.uiFontSize, 'sidebar row font size')
      await expectTransition(home, 'sidebar row hover')
      const treeRow = sidebarPage(page, 'Tree row')
      await expect(treeRow).toBeVisible()
      const treeHeight = (await box(treeRow)).height
      expect
        .soft(treeHeight, 'page tree row height')
        .toBeGreaterThanOrEqual(METRICS.sidebarRowHeight.min)
      expect
        .soft(treeHeight, 'page tree row height')
        .toBeLessThanOrEqual(METRICS.sidebarRowHeight.max)

      // A long workspace name ends in an ellipsis before the header buttons.
      const switcherBox = await box(page.getByRole('button', { name: 'Switch workspace' }))
      const closeBox = await box(page.getByRole('button', { name: 'Close sidebar' }))
      expect
        .soft(switcherBox.x + switcherBox.width, 'workspace name stays left of the buttons')
        .toBeLessThanOrEqual(closeBox.x)

      const topbar = page.getByTestId('topbar')
      near((await box(topbar)).height, METRICS.topbarHeight, 'top bar height')
      await expectColor(topbar, 'background-color', PALETTE[theme].page, 'top bar background')
      await expectColor(
        page.locator('[data-testid="sidebar"] > div').first(),
        'border-right-color',
        PALETTE[theme].border,
        'sidebar border'
      )

      await page.getByRole('button', { name: 'Search' }).click()
      const quickFind = page.getByRole('dialog', { name: 'Quick find' })
      await settle(quickFind)
      near((await box(quickFind)).width, METRICS.quickFindWidth, 'quick find width')
      await expectColor(quickFind, 'background-color', PALETTE[theme].popover, 'quick find bg')
      await shoot(page, 'quick-find', theme)
      await page.keyboard.press('Escape')
      await expect(quickFind).toBeHidden()

      await page.getByRole('button', { name: 'Settings' }).click()
      const settings = page.getByRole('dialog', { name: 'Settings' })
      await settle(settings)
      const settingsBox = await box(settings)
      near(settingsBox.width, METRICS.settings.width, 'settings width')
      near(settingsBox.height, METRICS.settings.height, 'settings height')
      await expectColor(settings, 'background-color', PALETTE[theme].popover, 'settings bg')
      await shoot(page, 'settings', theme)
      await page.keyboard.press('Escape')
      await expect(settings).toBeHidden()

      await page.getByRole('button', { name: 'Trash' }).click()
      const trash = page.locator('[data-slot="popover-content"]')
      await expect(trash.getByText('Gone')).toBeVisible()
      await settle(trash)
      await expectMenuChrome(trash, theme, 'trash popover')
      await shoot(page, 'trash', theme)
      await page.keyboard.press('Escape')
      await expect(trash).toBeHidden()

      await page.getByTestId('workspace-name').click()
      const switcher = page.locator('[data-slot="popover-content"]')
      await expect(switcher.getByText('New workspace')).toBeVisible()
      await settle(switcher)
      await expectMenuChrome(switcher, theme, 'workspace menu')
      await shoot(page, 'workspace-menu', theme)
      await page.keyboard.press('Escape')
      await expect(switcher).toBeHidden()
    })

    test('page header, editor blocks and the page menus', async ({
      authedPage: page,
      api,
      user,
    }) => {
      test.setTimeout(90_000)
      const workspace = await ensureWorkspace(api, user)
      const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Parity' })
      await updatePage(api, user, note.id, { icon: '📘', cover: 'gradient-2' })

      const collab = page.waitForEvent('websocket', {
        predicate: socket => socket.url().includes(pageCollabPath(note.id)),
        timeout: 20_000,
      })
      await openApp(page, theme, `/p/${note.id}`)
      await collab
      const editor = page.getByTestId('editor')
      await expect(editor).toBeVisible({ timeout: 15_000 })
      await expectStableLoad(page, `page (${theme})`)
      await page.getByTestId('import-markdown-input').setInputFiles({
        name: 'parity.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(MARKDOWN),
      })
      await expect(editor).toContainText('The last paragraph.', { timeout: 10_000 })
      await expectThemeBase(page, theme, 'page')

      // Header: cover, icon, title.
      const cover = page.getByTestId('page-cover')
      const coverBox = await box(cover)
      near(coverBox.height, METRICS.viewport.height * METRICS.coverViewportShare, 'cover height')
      await expectPageIcon(page, coverBox)
      const title = page.getByTestId('page-title')
      near(await px(title, 'font-size'), METRICS.title.fontSize, 'title font size')
      expect.soft(await css(title, 'font-weight'), 'title weight').toBe(METRICS.title.fontWeight)
      near(await px(title, 'line-height'), METRICS.title.lineHeight, 'title line height')
      near((await box(editor)).width, METRICS.contentWidth, 'content width')
      await shoot(page, 'page', theme)

      // Blocks.
      const block = (type: string) =>
        editor.locator(`.bn-block-content[data-content-type="${type}"]`)
      const paragraph = block('paragraph').first()
      const paragraphText = paragraph.locator('.bn-inline-content')
      near(await px(paragraphText, 'font-size'), METRICS.body.fontSize, 'body font size')
      near(await px(paragraphText, 'line-height'), METRICS.body.lineHeight, 'body line height')
      near(await px(paragraph, 'padding-top'), METRICS.body.blockPaddingY, 'block padding')
      near(
        (await box(paragraph)).height,
        METRICS.body.lineHeight + 2 * METRICS.body.blockPaddingY,
        'paragraph height'
      )
      for (const heading of METRICS.headings) {
        // BlockNote leaves out attributes that hold the default value (level 1).
        const level = heading.level === 1 ? ':not([data-level])' : `[data-level="${heading.level}"]`
        const content = editor.locator(`.bn-block-content[data-content-type="heading"]${level}`)
        const text = content.locator('.bn-inline-content')
        near(await px(text, 'font-size'), heading.fontSize, `h${heading.level} font size`)
        expect
          .soft(await css(text, 'font-weight'), `h${heading.level} weight`)
          .toBe(METRICS.headingWeight)
        near(await px(content, 'padding-top'), heading.marginTop, `h${heading.level} space above`)
      }
      const checkbox = block('checkListItem').locator('input')
      const checkboxBox = await box(checkbox)
      near(checkboxBox.width, METRICS.todoBox, 'to-do box')
      near(
        await px(block('bulletListItem'), 'min-width', '::before'),
        METRICS.listGutter,
        'bullet gutter'
      )
      const quote = block('quote').locator('blockquote')
      near(await px(quote, 'font-size'), METRICS.quote.fontSize, 'quote font size')
      near(await px(quote, 'border-left-width'), METRICS.quote.borderWidth, 'quote bar')
      near(await px(quote, 'padding-left'), METRICS.quote.paddingLeft, 'quote padding')
      const code = block('codeBlock')
      await expectColor(code, 'background-color', PALETTE[theme].codeBlock, 'code background')
      const pre = code.locator('pre')
      near(await px(pre, 'font-size'), METRICS.codeFontSize, 'code font size')
      expect.soft(await css(pre, 'font-family'), 'code font').toContain(METRICS.codeFontFamilyStart)

      // Hovering a block shows its handle, with a short fade.
      await paragraph.hover()
      const handle = editor.locator('.bn-side-menu')
      await expect(handle).toBeVisible()
      const handleButton = handle.locator('.bn-button').first()
      await expectTransition(handleButton, 'block handle hover')

      // Slash menu.
      // The empty zone below the editor puts the caret at the end of the last block.
      await page.getByTestId('editor-end').click()
      await page.keyboard.press('Enter')
      await page.keyboard.type('/')
      const slash = page.locator('.bn-suggestion-menu')
      await settle(slash)
      expect(await activeBlockText(page), 'the slash opens on its own empty block').toBe('/')
      await expectMenuChrome(slash, theme, 'slash menu')
      near((await box(slash)).width, METRICS.slashMenu.width, 'slash menu width', 4)
      const slashItem = slash.locator('.bn-suggestion-menu-item').first()
      near((await box(slashItem)).height, METRICS.slashMenu.itemHeight, 'slash item height')
      near(
        (await box(slashItem.locator('[data-position="left"]'))).width,
        METRICS.slashMenu.iconSize,
        'slash icon'
      )
      await expectTransition(slashItem, 'slash item hover')
      await shoot(page, 'slash-menu', theme)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Backspace')

      // Formatting toolbar.
      await paragraphText.dblclick()
      const toolbar = page.locator('.bn-formatting-toolbar')
      await settle(toolbar)
      await expectMenuChrome(toolbar, theme, 'formatting toolbar')
      near(
        (await box(toolbar.locator('button').first())).height,
        METRICS.toolbarButton,
        'toolbar select height'
      )
      for (const name of ['Bold', 'Italic', 'Underline', 'Strike']) {
        const buttonBox = await box(toolbar.getByRole('button', { name, exact: true }))
        near(buttonBox.width, METRICS.toolbarButton, `${name} button width`)
        near(buttonBox.height, METRICS.toolbarButton, `${name} button height`)
      }
      await shoot(page, 'formatting-toolbar', theme)
      await page.keyboard.press('Escape')

      // Share popover.
      await page.getByRole('button', { name: 'Share' }).click()
      const share = page.locator('[data-slot="popover-content"]')
      await expect(share.getByRole('tablist', { name: 'Share options' })).toBeVisible()
      await settle(share)
      await expectMenuChrome(share, theme, 'share popover')
      await shoot(page, 'share', theme)
      await page.keyboard.press('Escape')
      await expect(share).toBeHidden()

      // Page menu.
      await page.getByRole('button', { name: 'Page options' }).click()
      const options = page.getByRole('menu')
      await settle(options)
      await expectMenuChrome(options, theme, 'page menu')
      const item = options.getByRole('menuitem').first()
      near((await box(item)).height, METRICS.menuItemHeight, 'menu item height')
      near(await px(item, 'font-size'), METRICS.uiFontSize, 'menu item font size')
      await expectTransition(item, 'menu item hover')
      await shoot(page, 'page-menu', theme)
      await page.keyboard.press('Escape')
      await expect(options).toBeHidden()

      // Comments panel.
      await page.getByRole('button', { name: 'Comments' }).click()
      const comments = page.getByTestId('comments-panel')
      await expect(comments).toBeVisible()
      await expectColor(comments, 'background-color', PALETTE[theme].page, 'comments background')
      await expectColor(comments, 'border-left-color', PALETTE[theme].border, 'comments border')
      await shoot(page, 'comments', theme)
    })

    test('database views', async ({ authedPage: page, api, user }) => {
      const workspace = await ensureWorkspace(api, user)
      const database = await createPage(api, user, {
        workspace_id: workspace.id,
        kind: 'database',
        title: 'Tasks',
      })
      for (const title of ['First task', 'Second task']) {
        await createPage(api, user, { workspace_id: workspace.id, parent_id: database.id, title })
      }

      await openApp(page, theme, `/p/${database.id}`)
      const table = page.getByRole('table', { name: 'Table' })
      await expect(table).toBeVisible()
      await expectThemeBase(page, theme, 'database')
      await expectStableLoad(page, `database (${theme})`)
      const sidebarBox = await box(page.getByTestId('sidebar'))
      const tabs = page.getByRole('tablist', { name: 'Database views' })
      near(
        (await box(tabs)).x,
        sidebarBox.x + sidebarBox.width + METRICS.fullWidthPadding,
        'full-width padding'
      )
      const header = page.getByRole('columnheader', { name: 'Name' })
      near((await box(header)).height, METRICS.databaseRowHeight, 'table header height')
      near(await px(header, 'font-size'), METRICS.uiFontSize, 'table header font size')
      await expectColor(header, 'border-right-color', PALETTE[theme].border, 'table grid line')
      near(
        (await box(page.getByRole('row', { name: 'First task' }))).height,
        METRICS.databaseRowHeight,
        'table row height'
      )
      await shoot(page, 'database-table', theme)

      for (const [name, testId] of [
        ['Board', 'database-board'],
        ['List', 'database-list'],
        ['Gallery', 'database-gallery'],
      ] as const) {
        await page.getByRole('button', { name: 'Add a view' }).click()
        await page.getByRole('menuitem', { name }).click()
        await expect(page.getByTestId(testId)).toBeVisible()
        await shoot(page, `database-${name.toLowerCase()}`, theme)
        if (name === 'Board') {
          const column = page.getByTestId('board-column').first()
          near((await box(column)).width, METRICS.boardColumnWidth, 'board column width')
        }
        if (name === 'List') {
          const row = page.getByTestId('database-list').locator('li').first()
          await expectColor(row, 'border-bottom-color', PALETTE[theme].border, 'list row line')
          near(await px(row.getByRole('button'), 'font-size'), METRICS.uiFontSize, 'list font')
        }
        if (name === 'Gallery') {
          const card = page.getByRole('button', { name: 'Open First task' })
          expect
            .soft((await box(card)).width, 'gallery card width')
            .toBeGreaterThanOrEqual(METRICS.galleryCardMinWidth - TOLERANCE)
        }
      }
    })

    test('public page', async ({ page, api, user }) => {
      const workspace = await ensureWorkspace(api, user)
      const note = await createPage(api, user, { workspace_id: workspace.id, title: 'Public' })
      const shared = await updatePage(api, user, note.id, {
        is_public: true,
        icon: '🌍',
        cover: 'gradient-1',
      })

      await openApp(page, theme, `/share/${shared.public_id}`)
      const title = page.getByRole('heading', { name: 'Public' })
      await expect(title).toBeVisible()
      await expectThemeBase(page, theme, 'public page')
      near(await px(title, 'font-size'), METRICS.title.fontSize, 'public title font size')
      expect
        .soft(await css(title, 'font-weight'), 'public title weight')
        .toBe(METRICS.title.fontWeight)
      near((await box(page.getByTestId('public-editor'))).width, METRICS.contentWidth, 'width')
      const coverBox = await box(page.getByTestId('page-cover'))
      near(coverBox.height, METRICS.viewport.height * METRICS.coverViewportShare, 'cover height')
      await expectPageIcon(page, coverBox)
      await expectStableLoad(page, `public (${theme})`)
      await shoot(page, 'public-page', theme)
    })

    test('hover, focus and the sidebar collapse', async ({ authedPage: page }) => {
      await openApp(page, theme, '/home')
      await expect(page.getByTestId('workspace-name')).toBeVisible()
      await expectStableLoad(page, `home (${theme})`)

      const home = page.getByRole('link', { name: 'Home' })
      const search = page.getByRole('button', { name: 'Search' })
      await search.hover()
      await expect
        .poll(() => css(search, 'background-color'), { message: 'sidebar row hover' })
        .toBe(PALETTE[theme].hover)

      await home.focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(home).toBeFocused()
      expect.soft(await css(home, 'box-shadow'), 'focus ring').toContain('rgba(35, 131, 226')

      const bar = page.getByTestId('sidebar')
      expect
        .soft(longestMs(await css(bar, 'transition-duration')), 'collapse duration')
        .toBe(METRICS.sidebarCollapseMs)
      // The width transition must run its full course, not jump to closed.
      const transition = bar.evaluate(
        (element: HTMLElement) =>
          new Promise<{ property: string; elapsedMs: number }>(resolve => {
            element.addEventListener('transitionend', event => {
              if (event.target !== element) return
              resolve({ property: event.propertyName, elapsedMs: event.elapsedTime * 1000 })
            })
          })
      )
      await page.keyboard.press('Control+Backslash')
      expect(await transition).toEqual({ property: 'width', elapsedMs: METRICS.sidebarCollapseMs })
      expect((await box(bar)).width).toBe(0)
      await shoot(page, 'sidebar-collapsed', theme)
    })
  })
}
