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
