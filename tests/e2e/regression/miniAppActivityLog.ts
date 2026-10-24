import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'
import AdmZip from 'adm-zip'

import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { MiniAppActivityListing } from '@shared/types/miniAppActivity'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { openLaunchpadApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function miniAppActivityLog(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const appId = `com.example.qa.mp102-${Date.now()}`
  const name = app.resourceName('Activity log probe')
  const archives = join(app.paths.fixtures, 'archives')
  await mkdir(archives, { recursive: true })
  const packagePath = join(archives, `${appId}.miniapp`)
  const archive = new AdmZip()
  archive.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({
        id: appId,
        name,
        description: 'Real sandbox calls for activity log regression.',
        version: '1.0.0',
        entry: 'index.html',
        permissions: ['storage.get', 'network.fetch'],
        optionalPermissions: ['storage.set'],
        network: ['example.com']
      })
    )
  )
  archive.addFile('index.html', Buffer.from('<!doctype html><html><body><h1>Activity log probe</h1></body></html>'))
  await writeFile(packagePath, archive.toBuffer())
  const screenshot = async (label: string) => {
    const path = testInfo.outputPath(`${label}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(label, { path, contentType: 'image/png' })
  }
  const readLog = async (deniedOnly = false) => {
    const result = (await page.evaluate(
      ({ appId, deniedOnly }) => window.api.ipcApi.request('mini_app.activity.list', { appId, limit: 100, deniedOnly }),
      { appId, deniedOnly }
    )) as IpcResult<MiniAppActivityListing>
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }
  const tile = page.getByRole('main').getByRole('button', { name, exact: true })
  const detail = page.getByRole('dialog', { name, exact: true })
  const openDetail = async () => {
    await openLaunchpadApp(page, 'MiniApp')
    await tile.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'View details', exact: true }).click()
    await expect(detail).toBeVisible()
  }
  const guest = page.locator(`webview[src^="cherry-miniapp://${appId}/"]`)
  const execute = (script: string) =>
    guest.evaluate(async (element, script) => {
      const view = element as HTMLElement & { executeJavaScript: (script: string) => Promise<unknown> }
      return view.executeJavaScript(script)
    }, script)
  let installed = false
  const previousMenu = await page.evaluate(() => window.api.preference.get('menu.presentation_mode'))
  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    await page.evaluate(async (filePath) => {
      const preview = (await window.api.ipcApi.request('mini_app.install.preview_file', { filePath })) as IpcResult<{
        installToken: string
      }>
      if (!preview.ok) throw new Error(preview.error.message)
      const confirmed = (await window.api.ipcApi.request('mini_app.install.confirm', {
        installToken: preview.data.installToken,
        grantedOptional: ['storage.set']
      })) as IpcResult<unknown>
      if (!confirmed.ok) throw new Error(confirmed.error.message)
    }, packagePath)
    installed = true
    await page.reload()
    await openDetail()
    await detail.getByRole('tab', { name: 'Activity log', exact: true }).click()
    const activity = detail.getByRole('tabpanel', { name: 'Activity log', exact: true })
    await expect(activity.getByTestId('activity-list')).toContainText('Installed 1.0.0')
    await expect(activity.getByLabel(/newest 7 activity days/)).toHaveCount(1)
    await screenshot('MP-102 activity log and retention explanation')
    await detail.getByRole('tab', { name: 'Permissions', exact: true }).click()
    const writePermission = detail.getByRole('checkbox', { name: 'Sandbox data · Write', exact: true })
    await expect(writePermission).toBeChecked()
    await writePermission.click()
    await expect(writePermission).not.toBeChecked()
    await detail.locator('[data-slot="dialog-footer"]').getByRole('button', { name: 'Close', exact: true }).click()
    await tile.click()
    await expect(guest).toBeVisible()
    await expect.poll(() => execute('typeof cherry')).toBe('object')
    // These calls use the installed guest's real preload and main-process permission gate.
    expect(
      await execute(`(async () => {
      const results = {};
      for (const [name, call] of [
        ['revoked', () => cherry.storage.set('MP102-private-key', 'MP102-private-value')],
        ['undeclared', () => cherry.storage.delete('MP102-private-key')],
        ['host', () => cherry.network.fetch({url: 'https://example.org/MP102-private-path'})]
      ]) {
        try { await call(); results[name] = 'unexpected success'; }
        catch (error) { results[name] = error.name; }
      }
      for (let i = 0; i < 3; i++) await cherry.storage.get('MP102-private-key');
      return results;
    })()`)
    ).toEqual({ revoked: 'PermissionDenied', undeclared: 'PermissionDenied', host: 'PermissionDenied' })
    await openDetail()
    await detail.getByRole('tab', { name: 'Activity log', exact: true }).click()
    await expect
      .poll(async () => (await readLog()).entries, { timeout: 75_000 })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'grant', name: 'revoke', permissions: ['storage.set'] }),
          expect.objectContaining({ kind: 'call', name: 'storage.set', outcome: 'PermissionDenied' }),
          expect.objectContaining({ kind: 'call', name: 'storage.delete', outcome: 'PermissionDenied' }),
          expect.objectContaining({
            kind: 'call',
            name: 'network.fetch',
            outcome: 'PermissionDenied',
            facet: expect.objectContaining({ host: 'example.org' })
          }),
          expect.objectContaining({ kind: 'count', name: 'storage.get', calls: 3, bytes: 0 })
        ])
      )
    const log = await readLog()
    expect(log.entries.filter((entry) => entry.kind === 'call' && entry.outcome === 'ok')).toEqual([])
    expect(JSON.stringify(log)).not.toContain('MP102-private')
    expect(log.days).toBe(1)
    expect(log.days).toBeLessThanOrEqual(7)
    expect(log.bytes).toBeGreaterThan(0)
    expect(log.bytes).toBeLessThanOrEqual(5 * 1024 * 1024)
    await activity.getByRole('button', { name: 'Refresh', exact: true }).click()
    const rows = activity.getByTestId('activity-list').locator('li')
    await expect(rows).toHaveCount(log.entries.length)
    await expect(activity.getByTestId('activity-list')).toContainText('storage.get × 3')
    await expect(activity.getByTestId('activity-list')).toContainText('Revoked storage.set')
    await expect(activity.getByTestId('activity-size')).toContainText('1 files')
    await screenshot('MP-102 real refusals permission change and aggregated calls')
    const filter = activity.getByRole('button', { name: 'Refusals only', exact: true })
    await filter.click()
    await expect(filter).toHaveAttribute('aria-pressed', 'true')
    await expect(rows).toHaveCount(3)
    for (const method of ['storage.set', 'storage.delete', 'network.fetch']) {
      await expect(rows.filter({ hasText: `${method} → PermissionDenied` })).toHaveCount(1)
    }
    expect((await readLog(true)).entries).toEqual(
      log.entries.filter((entry) => entry.kind === 'call' && entry.outcome !== 'ok')
    )
    await screenshot('MP-102 refusals only filter')
    await filter.click()
    await expect(rows).toHaveCount(log.entries.length)
    await activity.getByRole('button', { name: 'Clear log', exact: true }).click()
    await screenshot('MP-102 state after requesting clear log')
    const confirmation = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('button', { name: 'Confirm', exact: true }) })
    await expect(
      confirmation,
      'Clearing the activity log must ask for confirmation before deleting records'
    ).toBeVisible({ timeout: 3_000 })
    expect((await readLog()).entries).toEqual(log.entries)
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await readLog()).entries).toEqual(log.entries)
    await activity.getByRole('button', { name: 'Clear log', exact: true }).click()
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(activity.getByText('Nothing recorded yet.', { exact: true })).toBeVisible()
    await expect(activity.getByTestId('activity-list')).toHaveCount(0)
    await expect.poll(readLog).toEqual({ entries: [], bytes: 0, days: 0 })
    await filter.click()
    await expect(activity.getByText('Nothing recorded yet.', { exact: true })).toBeVisible()
    await screenshot('MP-102 empty activity log after confirmed clear')
  } finally {
    if (installed) await page.evaluate((appId) => window.api.ipcApi.request('mini_app.uninstall', { appId }), appId)
    await page.evaluate((value) => window.api.preference.set('menu.presentation_mode', value), previousMenu)
  }
}
