import type { Locator } from '@playwright/test'

import { openLaunchpadApp } from '../regression/helpers/navigation'
import { expect, test } from './fixtures/electron.fixture'

// Opacity on any ancestor can hide a button that Playwright still considers visible.
async function effectiveOpacity(control: Locator) {
  return control.evaluate((element) => {
    let opacity = 1
    for (let current: Element | null = element; current; current = current.parentElement) {
      opacity *= Number(getComputedStyle(current).opacity)
    }
    return opacity
  })
}

async function expectPaintedTarget(control: Locator) {
  await control.scrollIntoViewIfNeeded()
  await expect(control).toBeVisible()
  await expect.poll(() => effectiveOpacity(control)).toBe(1)
  await expect(control).toHaveCSS('pointer-events', 'auto')
  const bounds = await control.boundingBox()
  if (!bounds) throw new Error('Provider action has no bounds')
  expect(bounds.width).toBeGreaterThan(0)
  expect(bounds.height).toBeGreaterThan(0)
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  expect(
    await control.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y)
      return hit === element || (hit !== null && element.contains(hit))
    }, center)
  ).toBe(true)
  return center
}

test('Code Mate provider actions support touch, hover and keyboard input', async ({ mainWindow: page }, testInfo) => {
  test.setTimeout(300_000)
  await page.waitForFunction(() => Boolean(window.api?.preference))
  const preferences = await page.evaluate(async () => ({
    'app.language': await window.api.preference.get('app.language'),
    'app.onboarding.provider_setup.status': await window.api.preference.get('app.onboarding.provider_setup.status'),
    'app.privacy.data_collection.enabled': await window.api.preference.get('app.privacy.data_collection.enabled'),
    'app.privacy.policy_version': await window.api.preference.get('app.privacy.policy_version')
  }))
  const cdp = await page.context().newCDPSession(page)
  const clearFocus = () =>
    page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
  const setTouch = async (enabled: boolean) => {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled, maxTouchPoints: 1 })
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(enabled)
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(!enabled)
    await page.mouse.move(1, 1)
    await clearFocus()
  }
  const screenshot = async (name: string) => {
    const screenshotPath = testInfo.outputPath(`${name}.png`)
    await page.bringToFront()
    await page.waitForTimeout(250)
    await page.screenshot({ path: screenshotPath })
    await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
  }
  const view = page.locator('[data-ui~="code.view"]:visible')
  const tabToAction = async (action: Locator) => {
    // Start outside the row; reach the action through the browser's real sequential focus order.
    await view.getByRole('searchbox').focus()
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.keyboard.press('Tab')
      if (await action.evaluate((element) => document.activeElement === element)) break
    }
    await expect(action).toBeFocused()
    expect(await action.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
    await expectPaintedTarget(action)
  }

  try {
    await page.evaluate(() => window.api.preference.set('app.language', 'en-US'))
    await page.reload()
    const shell = page.locator('[data-ui~="app.content"]').first()
    const setUpLater = page.getByRole('button', { name: 'Set up later', exact: true })
    await expect(shell.or(setUpLater).first()).toBeVisible({ timeout: 120_000 })
    if (await setUpLater.isVisible()) await setUpLater.click()
    await expect(shell).toBeVisible({ timeout: 60_000 })
    const decline = page.getByRole('button', { name: 'Decline', exact: true })
    if (await decline.isVisible().catch(() => false)) await decline.click()
    await page.waitForTimeout(250)
    await openLaunchpadApp(page, 'Code Mate')
    await expect(view).toBeVisible()
    const navigation = view.locator('[data-ui~="code.navigation"]')
    await navigation.getByRole('button', { name: /^DeepSeek Harness\b/ }).click()
    const row = view
      .locator('[data-ui~="code.provider-card"]')
      .filter({ has: page.getByText('Unified Gateway', { exact: true }) })
    await expect(row).toHaveCount(1)
    const configure = row.getByRole('button', { name: 'Configure', exact: true })
    const enable = row.getByRole('button', { name: 'Enable', exact: true })
    const actions = enable.locator('..')
    await expect(configure).toBeEnabled()
    await expect(enable).toBeEnabled()

    await setTouch(true)
    await expectPaintedTarget(configure)
    await expectPaintedTarget(enable)
    await screenshot('provider-actions-no-hover')
    const center = await expectPaintedTarget(configure)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const dialog = page.getByRole('dialog', { name: /Unified Gateway/ })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('heading', { name: /Unified Gateway/ }).getByText('Unified Gateway', { exact: true })
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await clearFocus()

    await setTouch(false)
    await expect.poll(() => effectiveOpacity(configure)).toBe(0)
    await expect.poll(() => effectiveOpacity(enable)).toBe(0)
    await expect(actions).toHaveCSS('pointer-events', 'none')
    await expect(configure).toHaveCSS('pointer-events', 'none')
    expect(
      await configure.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        return hit === element || (hit !== null && element.contains(hit))
      })
    ).toBe(false)
    await screenshot('provider-actions-idle')

    const bounds = await row.boundingBox()
    if (!bounds) throw new Error('Gateway row has no bounds')
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await expect(actions).toHaveCSS('pointer-events', 'auto')
    const configureCenter = await expectPaintedTarget(configure)
    await expectPaintedTarget(enable)
    await page.mouse.move(configureCenter.x, configureCenter.y)
    await expectPaintedTarget(configure)
    await screenshot('provider-actions-hover')

    await page.mouse.move(1, 1)
    await clearFocus()
    await expect.poll(() => effectiveOpacity(configure)).toBe(0)
    await expect(actions).toHaveCSS('pointer-events', 'none')
    await tabToAction(configure)
    await expect(actions).toHaveCSS('pointer-events', 'auto')

    await navigation.getByRole('button', { name: /^Claude Code\b/ }).click()
    // OwnLoginCard has no code.provider-card token; scope to the group containing its localized title.
    const ownLogin = view
      .getByText('Claude Code Official', { exact: true })
      .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " group ")][1]')
    await expect(ownLogin).toHaveCount(1)
    const ownEnable = ownLogin.getByRole('button', { name: 'Enable', exact: true })
    await setTouch(true)
    await expectPaintedTarget(ownEnable)
    await expectPaintedTarget(ownLogin.getByRole('button', { name: 'Configure', exact: true }))
    await tabToAction(ownEnable)
  } finally {
    try {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    } finally {
      try {
        await cdp.detach()
      } finally {
        await page.evaluate((previous) => window.api.preference.setMultiple(previous), preferences)
      }
    }
  }
})
