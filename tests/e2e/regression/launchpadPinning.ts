import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { MiniAppSchema, type MiniAppStatus } from '@shared/data/types/miniApp'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { openLaunchpad } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function launchpadPinning(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const readApps = async () => {
    const response = await page.evaluate(() =>
      window.api.dataApi.request({ id: 'mp130-list', method: 'GET', path: '/mini-apps' })
    )
    expect(response.status).toBe(200)
    return MiniAppSchema.array().parse(response.data)
  }
  const setStatus = async (appId: string, status: MiniAppStatus) => {
    const response = await page.evaluate(
      ({ appId, status }) =>
        window.api.dataApi.request({
          id: 'mp130-status',
          method: 'PATCH',
          path: `/mini-apps/${encodeURIComponent(appId)}`,
          body: { status }
        }),
      { appId, status }
    )
    expect(response.status).toBe(200)
  }
  const previous = await page.evaluate(async () => ({
    shortcuts: await window.api.preference.get('ui.sidebar_shortcut'),
    menu: await window.api.preference.get('menu.presentation_mode')
  }))
  const originalApps = await readApps()
  const builtin = originalApps.find(({ appId }) => appId === 'deepseek')
  expect(builtin, 'The built-in DeepSeek mini app must exist').toBeDefined()
  if (!builtin) throw new Error('Built-in DeepSeek mini app is missing')
  expect(builtin.presetMiniAppId).toBe('deepseek')
  const sidebarButton = () =>
    page.locator('[data-ui~="app.sidebar"]').getByRole('button', { name: 'DeepSeek', exact: true }).last()
  const miniAppsSection = () =>
    page.locator('section').filter({ has: page.getByRole('heading', { name: 'MiniApps', exact: true }) })
  const tile = () => miniAppsSection().getByRole('button', { name: 'DeepSeek', exact: true }).last()
  const isPinned = () =>
    page.evaluate(async () =>
      (await window.api.preference.get('ui.sidebar_shortcut')).some(
        ({ target }) => target.locator.providerId === 'core.mini-app' && target.locator.resourceId === 'deepseek'
      )
    )
  const toggleSidebar = async (pin: boolean) => {
    await tile().click({ button: 'right' })
    await page.getByRole('menuitem', { name: pin ? 'Add to Sidebar' : 'Remove from Sidebar', exact: true }).click()
    await expect.poll(isPinned).toBe(pin)
    if (pin) await expect(sidebarButton()).toBeVisible()
    else await expect(sidebarButton()).toHaveCount(0)
    await expect(tile()).toBeVisible()
  }

  try {
    await page.evaluate(async (shortcuts) => {
      await window.api.preference.setMultiple({
        'menu.presentation_mode': 'cherry',
        'ui.sidebar_shortcut': shortcuts.filter(
          ({ target }) => !(target.locator.providerId === 'core.mini-app' && target.locator.resourceId === 'deepseek')
        )
      })
    }, previous.shortcuts)
    await setStatus(builtin.appId, 'pinned')
    await page.reload()
    await openLaunchpad(page)
    const appsSection = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Apps', exact: true }) })
    await expect(appsSection.getByRole('button', { name: 'MiniApp', exact: true }).last()).toBeVisible()
    await expect(appsSection.getByRole('button', { name: 'Notes', exact: true }).last()).toBeVisible()
    await expect(tile()).toBeVisible()
    await expect(appsSection.getByRole('button', { name: 'DeepSeek', exact: true })).toHaveCount(0)
    await expect(sidebarButton()).toHaveCount(0)

    await toggleSidebar(true)
    await screenshot('MP-130 launchpad sections and immediate sidebar pin')
    await toggleSidebar(false)
    await screenshot('MP-130 sidebar unpinned with launchpad tile retained')
    await toggleSidebar(true)

    await tile().click()
    const guest = page.locator('webview[src^="https://chat.deepseek.com"]:visible')
    await expect(guest).toBeVisible({ timeout: 60_000 })
    await expect
      .poll(
        () =>
          guest.evaluate(async (element) => {
            const webview = element as HTMLElement & { executeJavaScript: (script: string) => Promise<string> }
            return webview.executeJavaScript('document.title')
          }),
        { timeout: 60_000 }
      )
      .toMatch(/DeepSeek/i)
    await screenshot('MP-130 built-in DeepSeek opened from launchpad')

    page = await app.restart()
    await openLaunchpad(page)
    await expect(sidebarButton()).toBeVisible()
    expect(await isPinned()).toBe(true)
    await expect(tile()).toBeVisible()
    await tile().click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Remove from Sidebar', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await screenshot('MP-130 pinned state survives application restart')

    await toggleSidebar(false)
    page = await app.restart()
    await openLaunchpad(page)
    await expect(tile()).toBeVisible()
    await expect(sidebarButton()).toHaveCount(0)
    expect(await isPinned()).toBe(false)
    await screenshot('MP-130 unpinned state survives application restart')

    // Unpinning every tile hides the whole mini-app section: LaunchpadPage renders it only while the
    // pinned list is nonempty.
    for (const item of await readApps()) {
      if (item.status === 'pinned') await setStatus(item.appId, 'enabled')
    }
    await page.reload()
    await openLaunchpad(page)
    expect((await readApps()).filter(({ status }) => status === 'pinned')).toEqual([])
    await screenshot('MP-130 launchpad with no pinned mini apps')
    await expect(miniAppsSection(), 'The mini-app section must disappear while no mini app is pinned').toHaveCount(0)
  } finally {
    for (const item of originalApps) {
      if (item.status === 'pinned' || item.appId === builtin.appId) await setStatus(item.appId, item.status)
    }
    await page.evaluate(async (previous) => {
      await window.api.preference.setMultiple({
        'menu.presentation_mode': previous.menu,
        'ui.sidebar_shortcut': previous.shortcuts
      })
    }, previous)
  }
}
