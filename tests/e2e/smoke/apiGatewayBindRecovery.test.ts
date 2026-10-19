import { expect, test } from './fixtures/electron.fixture'

test('API Gateway recovers from a refused port through Settings', async ({ mainWindow: page }, testInfo) => {
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
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click({ timeout: 60_000 })
  await expect(page.locator('[data-ui="settings.view"]')).toBeVisible({ timeout: 60_000 })
  await page
    .locator('[data-ui="settings.navigation"] [data-slot="menu-item"]')
    .filter({ hasText: 'API Gateway' })
    .click({ timeout: 60_000 })

  const port = page.getByLabel('Port', { exact: true })
  const notifications = page.getByRole('region', { name: 'notifications' })
  const running = page.getByText('Running', { exact: true })
  const stopped = page.getByText('Stopped', { exact: true })
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  await expect(port).toBeVisible({ timeout: 60_000 })
  await expect(stopped).toBeVisible({ timeout: 60_000 })

  try {
    await port.fill('1001', { timeout: 60_000 })
    await port.blur({ timeout: 60_000 })
    await expect(page.getByLabel('URL', { exact: true })).toHaveValue('http://127.0.0.1:1001', { timeout: 60_000 })
    await page.getByRole('button', { name: 'Start', exact: true }).click({ timeout: 60_000 })

    const refusal = notifications.getByText(/EACCES/)
    await expect(refusal.or(running).first()).toBeVisible({ timeout: 60_000 })
    if (await running.isVisible()) {
      test.skip(true, 'This platform permits binding TCP port 1001; no EACCES fixture in the real app')
      return
    }
    for (const text of ['EACCES', 'refused permission', '127.0.0.1', '1001', 'Port']) {
      await expect(refusal).toContainText(text, { timeout: 60_000 })
    }
    await expect(notifications.getByText(/choose a different Port/)).toBeVisible({ timeout: 60_000 })
    await expect(notifications.getByText(/TCP port 1001/)).toBeVisible({ timeout: 60_000 })
    await expect(stopped).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: testInfo.outputPath('eacces-recovery.png') })

    await port.fill('23456', { timeout: 60_000 })
    await port.blur({ timeout: 60_000 })
    await expect(page.getByLabel('URL', { exact: true })).toHaveValue('http://127.0.0.1:23456', { timeout: 60_000 })
    await page.getByRole('button', { name: 'Start', exact: true }).click({ timeout: 60_000 })
    await expect(notifications).toContainText('API Gateway started successfully', { timeout: 60_000 })
    await expect(running).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: testInfo.outputPath('recovered-port.png') })
  } finally {
    if (await stop.isVisible()) {
      await stop.click({ timeout: 60_000 })
      await expect(stopped).toBeVisible({ timeout: 60_000 })
    }
  }
})
