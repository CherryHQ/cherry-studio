import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, type Page, type TestInfo } from '@playwright/test'
import type { WebviewTag } from 'electron'

import { MiniAppSchema } from '@shared/data/types/miniApp'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { openLaunchpad, openLaunchpadApp, selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function miniAppPinning(app: RegressionApp, initialPage: Page, testInfo: TestInfo): Promise<void> {
  let page = initialPage
  const appId = `mp103-${Date.now()}`
  const name = app.resourceName('Pinning')
  const marker = `MP-103 opened ${appId}`
  // Only the website content is a fixture; pinning, navigation and persistence use the real application.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(`<html><body><h1>${marker}</h1></body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mini app fixture server has no port')
  const url = `http://127.0.0.1:${address.port}/`
  const original = await page.evaluate(async () => ({
    menu: await window.api.preference.get('menu.presentation_mode'),
    shortcuts: await window.api.preference.get('ui.sidebar_shortcut')
  }))

  const screenshot = async (label: string) => {
    const path = testInfo.outputPath(`${label}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(label, { path, contentType: 'image/png' })
  }
  const sidebarEntry = () =>
    page.locator('[data-ui~="app.sidebar"]').getByRole('button', { name, exact: true }).and(page.locator('button'))
  const gridEntry = () =>
    page
      .getByRole('main')
      .getByRole('button', { name, exact: true })
      .and(page.locator('[data-ui~="part:context-menu-trigger"]'))
  const menuItem = (label: string) => page.getByRole('menuitem', { name: label, exact: true })
  const readApp = async () => {
    const result = await page.evaluate(
      (appId) => window.api.dataApi.request({ id: 'mp103-read', method: 'GET', path: `/mini-apps/${appId}` }),
      appId
    )
    expect(result.status).toBe(200)
    return MiniAppSchema.parse(result.data)
  }
  const assertOpened = async () => {
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible()
    const webview = page.locator(`webview[data-mini-app-id="${appId}"]`)
    await expect(webview).toBeVisible()
    await expect
      .poll(() => webview.evaluate((element) => (element as WebviewTag).executeJavaScript('document.body.innerText')))
      .toContain(marker)
  }
  const assertPinnedMenu = async () => {
    await gridEntry().click({ button: 'right' })
    await expect(menuItem('Remove from Sidebar')).toBeVisible()
    await expect(menuItem('Remove from Launchpad')).toBeVisible()
    await expect(menuItem('Add to Sidebar')).toHaveCount(0)
    await expect(menuItem('Add to Launchpad')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(sidebarEntry()).toHaveCount(1)
    await expect(gridEntry()).toHaveCount(1)
  }

  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    const created = await page.evaluate(
      (body) => window.api.dataApi.request({ id: 'mp103-create', method: 'POST', path: '/mini-apps', body }),
      { appId, name, url }
    )
    expect(created.status).toBe(201)
    expect(MiniAppSchema.parse(created.data).status).toBe('enabled')
    await page.reload()
    await openLaunchpad(page)
    await expect(gridEntry()).toHaveCount(0)
    await expect(sidebarEntry()).toHaveCount(0)
    await openLaunchpadApp(page, 'MiniApp')
    await expect(gridEntry()).toBeVisible()

    await gridEntry().click({ button: 'right' })
    await menuItem('Add to Sidebar').click()
    await expect(sidebarEntry()).toHaveCount(1)
    await expect(sidebarEntry()).toBeVisible()
    await sidebarEntry().click()
    await assertOpened()
    await screenshot('MP-103 sidebar entry opens mini app')

    await openLaunchpadApp(page, 'MiniApp')
    await gridEntry().click({ button: 'right' })
    await menuItem('Add to Launchpad').click()
    await openLaunchpad(page)
    await expect(gridEntry()).toBeVisible()
    // Reopening the menu must offer removal instead of allowing duplicate additions.
    await assertPinnedMenu()
    await assertPinnedMenu()
    await screenshot('MP-103 unique entries pinned in both locations')
    await gridEntry().click()
    await assertOpened()
    expect((await readApp()).status).toBe('pinned')

    page = await app.restart()
    await openLaunchpad(page)
    await expect(sidebarEntry()).toBeVisible()
    await expect(gridEntry()).toBeVisible()
    await assertPinnedMenu()
    await sidebarEntry().click()
    await assertOpened()
    await openLaunchpad(page)
    await gridEntry().click()
    await assertOpened()
    await screenshot('MP-103 both pins survive application restart')

    await sidebarEntry().click({ button: 'right' })
    await menuItem('Remove from Sidebar').click()
    await expect(sidebarEntry()).toHaveCount(0)
    await openLaunchpad(page)
    await expect(gridEntry()).toHaveCount(1)
    await gridEntry().click({ button: 'right' })
    await menuItem('Remove from Launchpad').click()
    await expect(gridEntry()).toHaveCount(0)
    expect((await readApp()).status).toBe('enabled')
    await screenshot('MP-103 removed from sidebar and launchpad')

    page = await app.restart()
    await openLaunchpad(page)
    await expect(sidebarEntry()).toHaveCount(0)
    await expect(gridEntry()).toHaveCount(0)
    expect(await readApp()).toMatchObject({ appId, name, url, status: 'enabled' })
    await openLaunchpadApp(page, 'MiniApp')
    await expect(gridEntry()).toHaveCount(1)
    await gridEntry().click()
    await assertOpened()
    await screenshot('MP-103 unpinned app remains available after restart')
  } finally {
    await page.evaluate(
      async ({ appId, original }) => {
        await window.api.preference.setMultiple({
          'menu.presentation_mode': original.menu,
          'ui.sidebar_shortcut': original.shortcuts
        })
        await window.api.dataApi.request({ id: 'mp103-delete', method: 'DELETE', path: `/mini-apps/${appId}` })
      },
      { appId, original }
    )
    await selectSidebarApp(page, 'Chat')
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}
