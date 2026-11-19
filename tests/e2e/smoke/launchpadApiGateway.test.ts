import type { Page } from '@playwright/test'

import uiLocale from '../../../src/renderer/i18n/locales/en-us.json'
import { ThemeMode } from '../../../src/shared/data/preference/preferenceTypes'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test } from './fixtures/electron.fixture'
import { openSettings } from './utils/navigation'
import { uiLocator } from './utils/uiLocator'

// dnd-kit gives each launchpad tile a role="button" draggable wrapper, so the
// role+name query is ambiguous; the tile itself is the inner row-control button.
const gatewayTile = (page: Page) =>
  page.locator('button[data-dnd-row-control]').filter({ hasText: uiLocale['code.api_gateway.title'] })

const sidebarGatewayEntry = (page: Page) =>
  uiLocator(page, 'app.sidebar').getByLabel(uiLocale['code.api_gateway.title'], { exact: true })

async function waitForShell(page: Page) {
  await expect(uiLocator(page, 'app.content').first()).toBeVisible({ timeout: 60000 })
}

async function prepare(page: Page) {
  await page.waitForFunction(() => Boolean(window.api?.preference))
  await page.evaluate(async (version) => {
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'app.onboarding.provider_setup.status': 'skipped',
      'app.privacy.policy_version': version
    })
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  await waitForShell(page)
}

async function openLaunchpad(page: Page) {
  await page.evaluate(() => window.api.ipcApi.request('navigation.open_route_in_main', { path: '/app/launchpad' }))
  await expect(page.getByRole('heading', { name: uiLocale['launchpad.apps'], exact: true })).toBeVisible()
}

test('launchpad, sidebar and device connections reach the gateway', async ({ mainWindow: page }) => {
  await prepare(page)
  await openLaunchpad(page)
  const tile = gatewayTile(page)
  await expect(tile).toBeVisible()
  await tile.click()
  const view = uiLocator(page, 'api-gateway.view').filter({ visible: true })
  const panel = uiLocator(view, 'api-gateway.panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByText(uiLocale['apiGateway.status.stopped'], { exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: uiLocale['apiGateway.actions.start'], exact: true })).toBeVisible()
  await expect(panel.getByRole('textbox', { name: uiLocale['apiGateway.fields.url.label'], exact: true })).toBeVisible()
  await expect(
    panel.getByRole('spinbutton', { name: uiLocale['apiGateway.fields.port.label'], exact: true })
  ).toBeVisible()
  await expect(
    panel.getByRole('textbox', { name: uiLocale['apiGateway.fields.apiKey.label'], exact: true })
  ).toBeVisible()

  await openLaunchpad(page)
  await tile.click({ button: 'right' })
  await page.getByRole('menuitem', { name: uiLocale['launchpad.pin_to_sidebar'], exact: true }).click()
  const sidebarEntry = sidebarGatewayEntry(page)
  await expect(sidebarEntry).toBeVisible()
  await sidebarEntry.click()
  await expect(uiLocator(page, 'api-gateway.view').filter({ visible: true })).toBeVisible()
  await openLaunchpad(page)
  await tile.click({ button: 'right' })
  await page.getByRole('menuitem', { name: uiLocale['launchpad.unpin_from_sidebar'], exact: true }).click()
  await expect(tile).toBeVisible()

  await openSettings(page)
  await uiLocator(page, 'settings.navigation')
    .getByRole('button', { name: uiLocale['apiGateway.title'], exact: true })
    .click()
  const settingsPanel = uiLocator(uiLocator(page, 'settings.content'), 'api-gateway.panel')
  await expect(settingsPanel).toBeVisible()
  await expect(settingsPanel.getByText(uiLocale['apiGateway.status.stopped'], { exact: true })).toBeVisible()
  await expect(
    settingsPanel.getByRole('button', { name: uiLocale['apiGateway.actions.start'], exact: true })
  ).toBeVisible()

  await uiLocator(page, 'settings.navigation')
    .getByRole('button', { name: uiLocale['deviceConnections.title'], exact: true })
    .click()
  await expect(
    uiLocator(page, 'settings.content').getByRole('heading', { name: uiLocale['deviceConnections.title'], exact: true })
  ).toBeVisible()
})

test('gateway starts and stops and stays usable in a narrow dark window', async ({ mainWindow: page }, testInfo) => {
  await prepare(page)
  await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), ThemeMode.light)
  await page.setViewportSize({ width: 800, height: 500 })
  await openLaunchpad(page)
  await gatewayTile(page).click()
  const panel = uiLocator(page, 'api-gateway.panel').filter({ visible: true })
  await expect(panel).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/light/)
  await panel
    .getByRole('textbox', { name: uiLocale['apiGateway.fields.apiKey.label'], exact: true })
    .scrollIntoViewIfNeeded()
  await expect(
    panel.getByRole('textbox', { name: uiLocale['apiGateway.fields.apiKey.label'], exact: true })
  ).toBeVisible()
  const port = await panel
    .getByRole('spinbutton', { name: uiLocale['apiGateway.fields.port.label'], exact: true })
    .inputValue()
  const url = await panel
    .getByRole('textbox', { name: uiLocale['apiGateway.fields.url.label'], exact: true })
    .inputValue()
  expect(new URL(url).port).toBe(port)
  await panel.getByRole('button', { name: uiLocale['apiGateway.actions.start'], exact: true }).click()
  await expect(panel.getByText(uiLocale['apiGateway.status.running'], { exact: true })).toBeVisible()
  await expect(panel.getByText(url, { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: uiLocale['apiGateway.actions.stop'], exact: true }).click()
  await expect(panel.getByText(uiLocale['apiGateway.status.stopped'], { exact: true })).toBeVisible()
  await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), ThemeMode.dark)
  await page.setViewportSize({ width: 800, height: 500 })
  await page.reload()
  await waitForShell(page)
  await openLaunchpad(page)
  await gatewayTile(page).click()
  await expect(uiLocator(page, 'api-gateway.panel').filter({ visible: true })).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/dark/)
  const screenshot = testInfo.outputPath('dark.png')
  await page.screenshot({ path: screenshot })
  await testInfo.attach('dark', { path: screenshot, contentType: 'image/png' })
})
