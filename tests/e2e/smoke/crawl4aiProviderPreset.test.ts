import { expect, test } from './fixtures/electron.fixture'
import { openSettings } from './utils/navigation'

test('Crawl4AI defaults to Cloud and exposes setup help', async ({ mainWindow: page }, testInfo) => {
  test.setTimeout(300_000)
  const languageSelect = page.locator('[data-onboarding-language-select]')
  await expect(page.locator('[data-ui="app.content"]').first().or(languageSelect).first()).toBeVisible({
    timeout: 120_000
  })
  if (await languageSelect.isVisible()) {
    await languageSelect.getByRole('combobox').click({ timeout: 60_000 })
    await page.getByRole('option', { name: 'English', exact: false }).click({ timeout: 60_000 })
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await page.locator('[data-ui="app.content"]').first().isVisible()) break
    const setUpLater = page.getByRole('button', { name: 'Set up later', exact: true })
    await setUpLater.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
    if (await setUpLater.isVisible()) {
      await setUpLater.click({ timeout: 60_000 })
      await page.waitForTimeout(1_000)
    }
  }
  await expect(
    page.locator('[data-ui="app.content"]').first(),
    'App shell should appear after onboarding dismissal'
  ).toBeVisible({
    timeout: 60_000
  })
  await openSettings(page)
  await expect(page.locator('[data-ui="settings.view"]')).toBeVisible({ timeout: 60_000 })
  await page
    .locator('[data-ui="settings.navigation"]')
    .getByRole('button', { name: 'Built-in Tools', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: 'Built-in Tools', exact: true })
    .getByRole('button', { name: 'Web Search', exact: true })
    .click()
  const section = page.locator('section[aria-labelledby="web-search-fetchUrls-title"]')
  await expect(section).toBeVisible({ timeout: 60_000 })
  await section.getByRole('combobox').click()
  await page.getByRole('option', { name: /Crawl4AI/ }).click()

  const apiHost = section.getByPlaceholder('API Host')
  const help = section.getByRole('img', { name: /Crawl4AI Cloud with an API key/i })
  const description = page.getByRole('tooltip')
  await expect(apiHost).toHaveValue('https://api.crawl4ai.com')
  await help.hover()
  await expect(description).toContainText(/Crawl4AI Cloud with an API key.*self-hosted/i)
  await expect(section.locator('a[href="https://crawl4ai.com"]')).toBeVisible()

  await page.setViewportSize({ width: 960, height: 600 })
  await section.getByPlaceholder('API Key').fill('dummy-key-for-layout')
  await help.focus()
  await expect(description).toContainText(/self-hosted/i)
  const screenshotPath = testInfo.outputPath('crawl4ai-preset.png')
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach('Crawl4AI preset', { path: screenshotPath, contentType: 'image/png' })
  expect(await apiHost.inputValue()).toBe('https://api.crawl4ai.com')
})
