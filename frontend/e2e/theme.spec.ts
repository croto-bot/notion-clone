import { test, expect, type Page } from './fixtures'

/**
 * The pre-paint theme contract. The head script and the ThemeProvider record
 * every theme they apply into window.__nxThemeHistory (oldest first). If the
 * document ever showed a theme the user did not choose, that theme is in the
 * history.
 */

type ThemeAppliesWindow = Window & { __nxThemeHistory?: string[] }

async function themeHistory(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as ThemeAppliesWindow).__nxThemeHistory ?? [])
}

test.describe('theme application', () => {
  test('never shows the light theme when the OS prefers dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })

    await page.goto('/')

    await expect(page.locator('html')).toHaveClass(/dark/)
    const history = await themeHistory(page)
    expect(history.length).toBeGreaterThan(0)
    expect(history[0]).toBe('dark')
    expect(history).not.toContain('light')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#191919')
  })

  test('a saved dark theme survives hydration with a light OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })

    await page.goto('/')
    await page.evaluate(() => localStorage.setItem('nx-theme', 'dark'))
    await page.reload()

    await expect(page.locator('html')).toHaveClass(/dark/)
    const history = await themeHistory(page)
    expect(history.length).toBeGreaterThan(0)
    expect(history[0]).toBe('dark')
    expect(history).not.toContain('light')
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(25, 25, 25)')
  })
})

/** The pre-paint theme script exactly as the server sent it in `<head>`. */
async function servedThemeScript(page: Page): Promise<{ head: string; script: string }> {
  const response = await page.goto('/')
  const html = (await response?.text()) ?? ''
  const head = html.slice(0, html.indexOf('</head>'))
  const script = /<script[^>]*>([^<]*nx-theme[^<]*)<\/script>/.exec(head)?.[1]
  expect(script, 'the head carries the theme script').toBeTruthy()
  return { head, script: script! }
}

/** Runs code the server sent, the way the browser runs the head script: a new script element. */
async function runAsScript(page: Page, source: string): Promise<void> {
  await page.evaluate(code => {
    const element = document.createElement('script')
    element.textContent = code
    document.head.append(element)
    element.remove()
  }, source)
}

test.describe('theme application (fix round 2)', () => {
  test('the head script sets the browser-chrome color before React runs', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    const { head, script } = await servedThemeScript(page)
    // The script can only set a meta tag the parser has already created.
    expect(head.indexOf('name="theme-color"')).toBeGreaterThan(-1)
    expect(head.indexOf('name="theme-color"')).toBeLessThan(head.indexOf(script))
    const meta = page.locator('meta[name="theme-color"]')
    await expect(meta).toHaveAttribute('content', '#191919')

    // Reset the color, then run only the served head script: it alone must
    // paint the dark chrome color, with no React effect involved.
    await meta.evaluate(element => element.setAttribute('content', '#ffffff'))
    await runAsScript(page, script)
    await expect(meta).toHaveAttribute('content', '#191919')
  })

  test('the theme history is recorded only when asked (dev), never in production', async ({
    page,
  }) => {
    const { script } = await servedThemeScript(page)
    const resolver = /\((function applyStoredTheme[\s\S]*?)\)\("nx-theme"/.exec(script)?.[1]
    expect(resolver, 'the head script embeds the shared resolver').toBeTruthy()
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
    const before = (await themeHistory(page)).length

    // What production runs: the same resolver with recording off.
    await runAsScript(page, `(${resolver})("nx-theme", localStorage, false, false)`)
    expect((await themeHistory(page)).length).toBe(before)

    // The dev server's own call records, which the specs above rely on.
    await runAsScript(page, `(${resolver})("nx-theme", localStorage, false, true)`)
    expect(await themeHistory(page)).toHaveLength(before + 1)
  })
})
