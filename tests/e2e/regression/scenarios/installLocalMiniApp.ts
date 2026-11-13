import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'
import AdmZip from 'adm-zip'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { openLaunchpadApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function installLocalMiniApp(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const appId = `com.cherrystudio.qa.mp100-${Date.now()}`
  const name = app.resourceName('Local permission probe')
  const archives = join(app.paths.fixtures, 'archives')
  await mkdir(archives, { recursive: true })
  const packagePath = join(archives, 'miniapp-valid.miniapp')
  const invalidPath = join(archives, 'miniapp-invalid.zip')
  const archive = new AdmZip()
  archive.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({
        id: appId,
        name,
        description: 'Checks sandbox storage permissions using the real Cherry bridge.',
        version: '1.0.0',
        entry: 'index.html',
        permissions: ['storage.get'],
        optionalPermissions: ['storage.set', 'storage.delete']
      })
    )
  )
  archive.addFile(
    'index.html',
    Buffer.from(`<!doctype html><html><body>
    <h1>Local permission probe</h1><pre id="result">Running</pre>
    <script>
      (async () => {
        const results = {};
        try {
          await cherry.storage.set('mp100', 'retained-value');
          results.write = await cherry.storage.get('mp100');
          try { await cherry.storage.delete('mp100'); results.delete = 'unexpected success'; }
          catch (error) { results.delete = error.name; }
          results.afterDelete = await cherry.storage.get('mp100');
        } catch (error) { results.error = { name: error.name, message: error.message }; }
        document.getElementById('result').textContent = JSON.stringify(results);
      })();
    </script></body></html>`)
  )
  await writeFile(packagePath, archive.toBuffer())
  await writeFile(invalidPath, 'This is not a ZIP archive or a mini app package.')

  const screenshot = async (label: string) => {
    const path = testInfo.outputPath(`${label}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(label, { path, contentType: 'image/png' })
  }
  const readApps = async () => {
    const response = await page.evaluate(() =>
      window.api.dataApi.request({
        id: 'mp100-list',
        method: 'GET',
        path: '/mini-apps'
      })
    )
    expect(response.status).toBe(200)
    return response.data as { appId: string; kind: string; name: string }[]
  }
  const openPicker = async () => {
    await page.getByRole('button', { name: 'Add mini app', exact: true }).first().click()
    await page.getByRole('tab', { name: 'Local mini app', exact: true }).click()
  }

  try {
    await openLaunchpadApp(page, 'MiniApp')
    const before = await readApps()
    await openPicker()
    await page.locator('[data-ui~="mini-apps.install-dropzone"]').click()
    chooseNativeFile(app.record.platform, app.paths, packagePath)
    const consent = page.getByRole('dialog', { name: 'Install mini app', exact: true })
    await expect(consent).toBeVisible()
    await expect(consent).toContainText(name)
    await expect(consent).toContainText('Checks sandbox storage permissions using the real Cherry bridge.')
    await expect(consent).toContainText('Optional permissions can be turned off')
    const permissions = consent.getByTestId('permissions')
    await expect(permissions.getByRole('checkbox')).toHaveCount(3)
    const read = permissions.getByRole('checkbox', { name: 'Sandbox data · Read', exact: true })
    const write = permissions.getByRole('checkbox', { name: 'Sandbox data · Write', exact: true })
    const remove = permissions.getByRole('checkbox', { name: 'Sandbox data · Delete', exact: true })
    await expect(read).toBeChecked()
    await expect(read).toBeDisabled()
    await write.check()
    await remove.uncheck()
    await expect(write).toBeChecked()
    await expect(remove).not.toBeChecked()
    expect(await readApps()).toEqual(before)
    await screenshot('MP-100 permission review before installation')
    await consent.getByRole('button', { name: 'Install', exact: true }).click()
    await expect(consent).toBeHidden()
    const tile = page.getByRole('main').getByRole('button', { name, exact: true })
    await expect(tile).toBeVisible()
    await expect
      .poll(async () => (await readApps()).filter((item) => item.appId === appId))
      .toEqual([expect.objectContaining({ appId, name, kind: 'app' })])
    await screenshot('MP-100 installed app in list')
    await tile.click()
    const guest = page.locator(`webview[src^="cherry-miniapp://${appId}/"]`)
    await expect(guest).toBeVisible()
    await expect
      .poll(async () =>
        guest.evaluate(async (element) => {
          const view = element as HTMLElement & { executeJavaScript: (script: string) => Promise<string> }
          return view.executeJavaScript('document.getElementById("result")?.textContent')
        })
      )
      .toBe(
        JSON.stringify({
          write: { value: 'retained-value' },
          delete: 'PermissionDenied',
          afterDelete: { value: 'retained-value' }
        })
      )
    await screenshot('MP-100 granted write works and denied delete is blocked')

    await openLaunchpadApp(page, 'MiniApp')
    await openPicker()
    const installed = await readApps()
    const dropzone = page.locator('[data-ui~="mini-apps.install-dropzone"]')
    const bounds = await dropzone.boundingBox()
    expect(bounds).not.toBeNull()
    const session = await page.context().newCDPSession(page)
    try {
      const data = { items: [], files: [invalidPath], dragOperationsMask: 1 }
      const position = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }
      await session.send('Input.dispatchDragEvent', { type: 'dragEnter', ...position, data })
      await session.send('Input.dispatchDragEvent', { type: 'drop', ...position, data })
    } finally {
      await session.detach()
    }
    await expect(page.getByText('Drop one .miniapp package at a time.', { exact: true })).toBeVisible()
    await expect(page.getByTestId('install-preview')).toHaveCount(0)
    expect(await readApps()).toEqual(installed)
    await screenshot('MP-100 invalid ZIP rejected without partial installation')
  } finally {
    if ((await readApps()).some((item) => item.appId === appId)) {
      await page.evaluate((appId) => window.api.ipcApi.request('mini_app.uninstall', { appId }), appId)
    }
  }
}
