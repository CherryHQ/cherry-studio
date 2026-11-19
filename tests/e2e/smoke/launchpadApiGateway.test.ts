import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'

import type { Page } from '@playwright/test'

import uiLocale from '../../../src/renderer/i18n/locales/en-us.json'
import esLocale from '../../../src/renderer/i18n/locales/es-es.json'
import { ThemeMode } from '../../../src/shared/data/preference/preferenceTypes'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test } from './fixtures/electron.fixture'
import { openSettings } from './utils/navigation'
import { uiLocator } from './utils/uiLocator'

// Scope to main content because sidebar entries in the full layout use the same
// row-control attribute and label as the launchpad tile.
const gatewayTile = (page: Page) =>
  uiLocator(page, 'app.content')
    .locator('button[data-dnd-row-control]')
    .filter({ hasText: uiLocale['code.api_gateway.title'] })

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
  const sidebarIcon = sidebarEntry.locator('svg')
  const sidebarIconSize = () =>
    sidebarIcon.evaluate((icon) => {
      const { width, height } = icon.getBoundingClientRect()
      return [width, height]
    })
  // SidebarList: ICON_ICON_PRESENTATION.glyphSize = 18; FULL_ICON_PRESENTATION.glyphSize = 16.
  await expect.poll(sidebarIconSize).toEqual([18, 18])
  const resizeHandle = uiLocator(page, 'app.sidebar').locator('.cursor-col-resize')
  await resizeHandle.hover()
  const grip = (await resizeHandle.boundingBox())!
  const gripX = grip.x + grip.width / 2
  const gripY = grip.y + grip.height / 2
  await page.mouse.move(gripX, gripY)
  await page.mouse.down()
  // Clear SIDEBAR_FULL_THRESHOLD (120px) from the default 50px rail.
  await page.mouse.move(gripX + 150, gripY, { steps: 10 })
  await page.mouse.up()
  await expect.poll(sidebarIconSize).toEqual([16, 16])
  await sidebarEntry.click()
  await expect(uiLocator(page, 'api-gateway.view').filter({ visible: true })).toBeVisible()
  await openLaunchpad(page)
  await tile.click({ button: 'right' })
  await page.getByRole('menuitem', { name: uiLocale['launchpad.unpin_from_sidebar'], exact: true }).click()
  await expect(tile).toBeVisible()
  await expect(sidebarEntry).toHaveCount(0)

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
  // The gateway action only exists on the connect step.
  await uiLocator(page, 'settings.content')
    .getByRole('button', { name: uiLocale['deviceConnections.guide.continue'] })
    .click()
  await uiLocator(page, 'settings.content')
    .getByRole('button', { name: uiLocale['deviceConnections.gateway.openSettings'] })
    .click()
  await expect(settingsPanel).toBeVisible()
  await expect(settingsPanel.getByText(uiLocale['apiGateway.status.stopped'], { exact: true })).toBeVisible()
  await expect(
    uiLocator(page, 'settings.navigation').getByRole('button', { name: uiLocale['apiGateway.title'], exact: true })
  ).toHaveAttribute('data-active', 'true')
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
  const available = createServer().listen(0, '127.0.0.1')
  await once(available, 'listening')
  const port = (available.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => available.close((error) => (error ? reject(error) : resolve())))
  const portField = panel.getByRole('spinbutton', { name: uiLocale['apiGateway.fields.port.label'], exact: true })
  await portField.fill(String(port))
  await portField.blur()
  const url = `http://127.0.0.1:${port}`
  await expect(panel.getByRole('textbox', { name: uiLocale['apiGateway.fields.url.label'], exact: true })).toHaveValue(
    url
  )
  await panel.getByRole('button', { name: uiLocale['apiGateway.actions.start'], exact: true }).click()
  await expect(panel.getByText(uiLocale['apiGateway.status.running'], { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 460, height: 500 })
  await expect(panel.getByRole('textbox', { name: uiLocale['apiGateway.fields.url.label'], exact: true })).toHaveValue(
    url
  )
  await expect(
    panel.getByRole('button', { name: uiLocale['apiGateway.fields.url.copyTooltip'], exact: true })
  ).toBeVisible()
  const runningUrl = panel.getByRole('textbox', { name: uiLocale['apiGateway.fields.url.label'], exact: true })
  await expect
    .poll(() =>
      runningUrl.evaluate((input: HTMLInputElement) => {
        const style = getComputedStyle(input)
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')!
        context.font = style.font
        return (
          context.measureText(input.value).width <=
          input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        )
      })
    )
    .toBe(true)
  await panel.getByRole('button', { name: uiLocale['apiGateway.actions.stop'], exact: true }).click()
  await expect(panel.getByText(uiLocale['apiGateway.status.stopped'], { exact: true })).toBeVisible()
  await page.evaluate((theme) => window.api.preference.set('ui.theme_mode', theme), ThemeMode.dark)
  await page.setViewportSize({ width: 460, height: 500 })
  await page.reload()
  await waitForShell(page)
  await openLaunchpad(page)
  await gatewayTile(page).click()
  await expect(uiLocator(page, 'api-gateway.panel').filter({ visible: true })).toBeVisible()
  await expect(page.locator('body')).toHaveClass(/dark/)
  const darkPort = uiLocator(page, 'api-gateway.panel')
    .filter({ visible: true })
    .getByRole('spinbutton', { name: uiLocale['apiGateway.fields.port.label'], exact: true })
  await darkPort.scrollIntoViewIfNeeded()
  await expect(darkPort).toHaveValue(String(port))
  const screenshot = testInfo.outputPath('dark.png')
  await page.screenshot({ path: screenshot })
  await testInfo.attach('dark', { path: screenshot, contentType: 'image/png' })
})

test('Spanish gateway tile shows its full label', async ({ mainWindow: page }) => {
  await prepare(page)
  await page.evaluate(() => window.api.preference.set('app.language', 'es-ES'))
  await page.reload()
  await waitForShell(page)
  await page.evaluate(() => window.api.ipcApi.request('navigation.open_route_in_main', { path: '/app/launchpad' }))
  const tile = page.locator('button[data-dnd-row-control]').filter({ hasText: esLocale['code.api_gateway.title'] })
  await expect(tile).toBeVisible()
  const label = tile.getByText(esLocale['code.api_gateway.title'], { exact: true })
  await expect
    .poll(() =>
      label.evaluate(
        (element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight
      )
    )
    .toBe(true)
})
