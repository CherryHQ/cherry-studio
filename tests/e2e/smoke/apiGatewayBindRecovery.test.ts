import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'

import { expect, test } from './fixtures/electron.fixture'
import { openSettings } from './utils/navigation'

test('API Gateway recovers from an occupied port through Settings', async ({ mainWindow: page }, testInfo) => {
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

  const occupied = createServer().listen(0, '127.0.0.1')
  await once(occupied, 'listening')
  const occupiedPort = (occupied.address() as AddressInfo).port
  try {
    await port.fill(String(occupiedPort), { timeout: 60_000 })
    await port.blur({ timeout: 60_000 })
    await expect(page.getByLabel('URL', { exact: true })).toHaveValue(`http://127.0.0.1:${occupiedPort}`, {
      timeout: 60_000
    })
    await page.getByRole('button', { name: 'Start', exact: true }).click({ timeout: 60_000 })

    const refusal = notifications.getByText(/EADDRINUSE/)
    await expect(refusal).toBeVisible({ timeout: 60_000 })
    for (const text of ['127.0.0.1', String(occupiedPort)]) {
      await expect(refusal).toContainText(text)
    }
    await expect(stopped).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('occupied-port.png') })

    const available = createServer().listen(0, '127.0.0.1')
    await once(available, 'listening')
    const availablePort = (available.address() as AddressInfo).port
    await new Promise<void>((resolve, reject) => available.close((error) => (error ? reject(error) : resolve())))
    await port.fill(String(availablePort), { timeout: 60_000 })
    await port.blur({ timeout: 60_000 })
    await expect(page.getByLabel('URL', { exact: true })).toHaveValue(`http://127.0.0.1:${availablePort}`, {
      timeout: 60_000
    })
    await page.getByRole('button', { name: 'Start', exact: true }).click({ timeout: 60_000 })
    await expect(notifications).toContainText('API Gateway started successfully', { timeout: 60_000 })
    await expect(running).toBeVisible({ timeout: 60_000 })
    await page.screenshot({ path: testInfo.outputPath('recovered-port.png') })
  } finally {
    await new Promise<void>((resolve, reject) => occupied.close((error) => (error ? reject(error) : resolve())))
    if (await stop.isVisible()) {
      await stop.click({ timeout: 60_000 })
      await expect(stopped).toBeVisible({ timeout: 60_000 })
    }
  }
})
