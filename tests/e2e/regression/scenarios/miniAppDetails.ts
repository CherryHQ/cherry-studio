import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'
import JSZip from 'jszip'

import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { openLaunchpadApp } from '../helpers/navigation'

function unwrap<T>(result: unknown): T {
  const envelope = result as IpcResult<T>
  expect(envelope.ok, JSON.stringify(result)).toBe(true)
  if (!envelope.ok) throw new Error(envelope.error.message)
  return envelope.data
}

export async function miniAppDetails(page: Page, testInfo: TestInfo): Promise<void> {
  const appId = `qa.mp101.${Date.now()}`
  const name = `MP-101 ${Date.now()}`
  const providerId = `mp101-${Date.now()}`
  const modelId = 'mp101-model'
  const uniqueModelId = createUniqueModelId(providerId, modelId)
  const menuMode = await page.evaluate(() => window.api.preference.get('menu.presentation_mode'))
  const screenshot = async (label: string) => {
    const path = testInfo.outputPath(`${label}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(label, { path, contentType: 'image/png' })
  }
  const detail = () =>
    page
      .evaluate((appId) => window.api.ipcApi.request('mini_app.detail', { appId }), appId)
      .then(unwrap<OutputFor<'mini_app.detail'>>)
  const packages: string[] = []
  for (const version of ['1.0.0', '2.0.0']) {
    const zip = new JSZip()
    zip.file(
      'manifest.json',
      JSON.stringify({
        id: appId,
        name,
        description: 'MP-101 sandbox lifecycle fixture',
        version,
        entry: 'index.html',
        permissions: ['storage.*', 'file.*']
      })
    )
    zip.file('index.html', `<html><body><h1>MP-101 ${version}</h1></body></html>`)
    const path = testInfo.outputPath(`${version}.miniapp`)
    await writeFile(path, await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }))
    packages.push(path)
  }
  const previewPackage = (filePath: string) =>
    page
      .evaluate((filePath) => window.api.ipcApi.request('mini_app.install.preview_file', { filePath }), filePath)
      .then(unwrap<OutputFor<'mini_app.install.preview_file'>>)
  const install = async () => {
    const preview = await previewPackage(packages[0])
    expect(preview.kind).toBe('install')
    if (preview.kind !== 'install') throw new Error('Expected a fresh package install')
    unwrap(
      await page.evaluate(
        (installToken) => window.api.ipcApi.request('mini_app.install.confirm', { installToken }),
        preview.installToken
      )
    )
  }
  const openDetails = async () => {
    await openLaunchpadApp(page, 'MiniApp')
    await page.getByRole('main').getByRole('button', { name, exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'View details', exact: true }).click()
    await expect(page.getByRole('dialog', { name, exact: true })).toBeVisible()
  }
  const panel = page.getByRole('dialog', { name, exact: true })
  const openGuest = async () => {
    await openLaunchpadApp(page, 'MiniApp')
    await page.getByRole('main').getByRole('button', { name, exact: true }).click()
    await expect(page.locator(`webview[src^="cherry-miniapp://${appId}/"]`)).toBeAttached()
    await expect.poll(() => guest('typeof window.cherry').catch(() => 'not-ready')).toBe('object')
  }
  const guest = (script: string) =>
    page.evaluate(
      async ({ appId, script }) => {
        const view = document.querySelector(`webview[src^="cherry-miniapp://${appId}/"]`) as unknown as {
          executeJavaScript: (code: string) => Promise<unknown>
        }
        return view.executeJavaScript(script)
      },
      { appId, script }
    )
  const writeSandbox = async () => {
    expect(
      await guest(`(async () => {
      await cherry.storage.set('mp101', 'sandbox-marker');
      await cherry.file.save('mp101.txt', btoa('sandbox-file'));
      return (await cherry.storage.get('mp101')).value;
    })()`)
    ).toBe('sandbox-marker')
  }
  let installed = false
  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    const provider = await page.evaluate(
      ({ providerId }) =>
        window.api.dataApi.request({
          id: 'mp101-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-101 model settings fixture',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: 'http://127.0.0.1:1/v1' } },
            apiKeys: [{ id: 'mock', key: 'mock-key', isEnabled: true }]
          }
        }),
      { providerId }
    )
    expect(provider.status).toBe(201)
    expect(
      (
        await page.evaluate(
          (providerId) =>
            window.api.dataApi.request({
              id: 'mp101-enable',
              method: 'PATCH',
              path: `/providers/${providerId}`,
              body: { isEnabled: true }
            }),
          providerId
        )
      ).status
    ).toBe(200)
    expect(
      (
        await page.evaluate(
          ({ providerId, modelId }) =>
            window.api.dataApi.request({
              id: 'mp101-model',
              method: 'POST',
              path: '/models',
              body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
            }),
          { providerId, modelId }
        )
      ).status
    ).toBe(201)
    await install()
    installed = true
    await openDetails()
    await panel.getByRole('tab', { name: 'Settings', exact: true }).click()
    expect((await detail()).canRollback).toBe(false)
    await screenshot('MP-101 fresh installation has no rollback snapshot')
    await expect
      .soft(
        panel.getByRole('button', { name: 'Roll back to the previous version', exact: true }),
        'Without a snapshot the rollback button must remain visible and disabled'
      )
      .toBeDisabled({ timeout: 1000 })
    await panel.getByRole('button', { name: 'Close', exact: true }).first().click()
    const upgrade = await previewPackage(packages[1])
    expect(upgrade.kind).toBe('upgrade')
    if (upgrade.kind !== 'upgrade') throw new Error('Expected a package upgrade with rollback snapshot')
    unwrap(
      await page.evaluate(
        ({ appId, updateToken }) => window.api.ipcApi.request('mini_app.update.apply', { appId, updateToken }),
        { appId, updateToken: upgrade.update.updateToken }
      )
    )
    await openDetails()
    await expect(panel).toContainText('Version 2.0.0')
    await expect(panel).toContainText('Installed from a local package')
    await panel.getByRole('tab', { name: 'Space', exact: true }).click()
    await expect(panel.getByTestId('package-size')).toBeVisible()
    await expect(panel.getByTestId('snapshot-size')).toBeVisible()
    const before = await detail()
    expect(before.packageBytes).toBeGreaterThan(0)
    expect(before.snapshotBytes).toBeGreaterThan(0)
    await screenshot('MP-101 installed app source version and sandbox space')

    await panel.getByRole('tab', { name: 'Settings', exact: true }).click()
    const slot = panel.getByTestId('model-slot-default')
    const selectModel = async () => {
      await slot.getByRole('button').first().click()
      await page.getByTestId(`model-selector-item-${uniqueModelId}`).click()
      await expect(slot).toContainText(modelId)
      await expect.poll(async () => (await detail()).aiModelId).toBe(uniqueModelId)
    }
    await selectModel()
    await slot.getByRole('button', { name: 'Use default', exact: true }).click()
    await expect(slot).toContainText('Follow the global default model')
    await expect.poll(async () => (await detail()).aiModelId).toBeNull()
    await page.reload()
    await openDetails()
    await panel.getByRole('tab', { name: 'Settings', exact: true }).click()
    await expect(slot).toContainText('Follow the global default model')
    await selectModel()
    await page.reload()
    await openDetails()
    await panel.getByRole('tab', { name: 'Settings', exact: true }).click()
    await expect(slot).toContainText(modelId)
    expect((await detail()).aiModelId).toBe(uniqueModelId)

    await screenshot('MP-101 specified model persisted after reload')
    await panel.getByRole('button', { name: 'Close', exact: true }).first().click()
    await openGuest()
    await writeSandbox()
    await openDetails()
    await panel.getByRole('tab', { name: 'Space', exact: true }).click()
    await expect(panel.getByTestId('storage-usage')).toContainText('1 /')
    await expect(panel.getByTestId('file-usage')).toContainText('1 /')
    await panel.getByRole('button', { name: 'Clear data', exact: true }).click()
    const clearDialog = page.getByRole('dialog', { name: 'Clear data', exact: true })
    await expect(clearDialog).toContainText('The app stays installed.')
    expect((await detail()).storage.count).toBe(1)
    await clearDialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(clearDialog).toBeHidden()
    await expect.poll(async () => (await detail()).storage.count).toBe(0)
    const cleared = await detail()
    expect(cleared.file.count).toBe(0)
    expect(cleared.packageBytes).toBe(before.packageBytes)
    expect(cleared.snapshotBytes).toBe(before.snapshotBytes)
    expect(cleared.version).toBe('2.0.0')
    expect(cleared.aiModelId).toBe(uniqueModelId)
    await screenshot('MP-101 sandbox cleared app remains installed')
    await panel.getByRole('button', { name: 'Close', exact: true }).first().click()
    await openGuest()
    expect(await guest(`cherry.storage.get('mp101')`)).toEqual({ value: null })
    await writeSandbox()
    await openDetails()
    await panel.getByRole('tab', { name: 'Settings', exact: true }).click()
    const rollback = panel.getByRole('button', { name: 'Roll back to the previous version', exact: true })
    await expect(rollback).toBeEnabled()
    await rollback.click()
    await expect(panel).toContainText('Version 1.0.0')
    await expect.poll(async () => (await detail()).version).toBe('1.0.0')
    const rolledBack = await detail()
    expect(rolledBack.canRollback).toBe(false)
    expect(rolledBack.storage.count).toBe(1)
    await screenshot('MP-101 rollback completed without snapshot')
    await expect
      .soft(rollback, 'Without a snapshot the rollback button must remain visible and disabled')
      .toBeDisabled({ timeout: 1000 })

    await panel.getByRole('button', { name: 'Uninstall', exact: true }).click()
    const uninstallDialog = page.getByRole('dialog', { name: 'Uninstall', exact: true })
    await expect(uninstallDialog).toContainText('Its data will be deleted.')
    expect((await detail()).storage.count).toBe(1)
    await uninstallDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(uninstallDialog).toBeHidden()
    expect((await detail()).version).toBe('1.0.0')
    await panel.getByRole('button', { name: 'Uninstall', exact: true }).click()
    await uninstallDialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(panel).toBeHidden()
    installed = false
    await openLaunchpadApp(page, 'MiniApp')
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    const removed = await page.evaluate(
      (appId) =>
        window.api.dataApi.request({
          id: 'mp101-removed',
          method: 'GET',
          path: `/mini-apps/${appId}`
        }),
      appId
    )
    expect(removed.status).toBe(404)
    await screenshot('MP-101 uninstalled app absent from launchpad')
    await install()
    installed = true
    expect((await detail()).storage.count).toBe(0)
    expect((await detail()).file.count).toBe(0)
    await openGuest()
    expect(await guest(`cherry.storage.get('mp101')`)).toEqual({ value: null })
  } finally {
    if (installed) await page.evaluate((appId) => window.api.ipcApi.request('mini_app.uninstall', { appId }), appId)
    await page.evaluate(
      async ({ providerId, menuMode }) => {
        await window.api.preference.set('menu.presentation_mode', menuMode)
        await window.api.dataApi.request({ id: 'mp101-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { providerId, menuMode }
    )
  }
}
