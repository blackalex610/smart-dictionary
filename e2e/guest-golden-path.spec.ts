import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Guest mode needs no Supabase credentials, so this is the one path that can
// run unattended in CI. It's also the path every new visitor takes before
// ever signing in, which makes it the highest-value thing to keep working.
test.describe('guest golden path', () => {
  // The app defaults to Bulgarian (DEFAULT_LANG in src/i18n/index.ts); pin
  // English before any app script runs so selectors below are deterministic.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('appSettings', JSON.stringify({ language: 'en' }))
    })
  })

  test('add a word, see it in the dictionary, no console errors or CSP violations', async ({
    page,
  }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(err.message))

    await page.goto('/')
    await expect(page.getByText('Smart Dictionary')).toBeVisible()

    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await expect(page).toHaveURL(/\/app/)
    await expect(page.getByRole('heading', { name: 'Add New Word' })).toBeVisible()

    // id-based, not getByLabel: "Word" also substring-matches the submit
    // button's aria-label ("Add Word"), and the header search box.
    await page.locator('#field-word').fill('serendipity')
    await page.locator('#field-meaning').fill('a fortunate accident')
    await page.locator('#field-pos').selectOption({ label: 'Noun' })
    await page.getByRole('button', { name: 'Add Word', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'serendipity' })).toBeVisible()

    expect(consoleErrors, `Unexpected console/page errors:\n${consoleErrors.join('\n')}`).toEqual(
      [],
    )
  })

  test('dictionary page has no serious accessibility violations', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await expect(page.getByRole('heading', { name: 'Add New Word' })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .exclude('iframe')
      .analyze()

    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    )
    expect(
      serious,
      serious.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`).join('\n'),
    ).toEqual([])
  })

  test('flashcards and tests pages load without console errors', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.goto('/')
    await page.getByRole('button', { name: 'Continue as guest' }).click()
    await expect(page).toHaveURL(/\/app/)

    await page.getByRole('link', { name: 'Flashcards' }).click()
    await expect(page).toHaveURL(/\/app\/flashcards/)

    await page.getByRole('link', { name: 'Tests' }).click()
    await expect(page).toHaveURL(/\/app\/tests/)

    expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join('\n')}`).toEqual([])
  })
})
