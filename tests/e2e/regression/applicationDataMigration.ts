import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, parse } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'
import JSZip from 'jszip'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { adoptRelaunchedApp, stopOwnedApp } from '../../../scripts/e2e/regression/lifecycle'
import { findCdpPid } from '../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { sendChatMarker } from './chat'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'
import { openSettingsSection } from './settings'

export async function applicationDataMigration(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  // The relocated data directory holds a full profile (including the database with real provider
  // keys), so it lives outside the uploaded artifact roots.
  const destination = await mkdtemp(join(app.paths.private, 'mp119-new-data-'))
  const nonempty = join(app.paths.private, 'mp119-nonempty')
  const readonly = join(app.paths.private, 'mp119-readonly')
  const backup = join(app.paths.private, 'mp119-backup')
  // Relocation rewrites the install-scoped boot config and only packaged builds accept it;
  // branch runs launch unpackaged Electron from the repository.
  const packaged = app.record.mode === 'tag'
  const bootConfigPath = packaged
    ? join(homedir(), '.cherrystudio', 'boot-config.json')
    : join(app.paths.profiles, app.record.profile, '.cherrystudio', 'boot-config.json')
  const bootConfigBackup = existsSync(bootConfigPath) ? await readFile(bootConfigPath) : undefined
  let restoreBootConfig = false
  for (const directory of [destination, nonempty, readonly, backup]) await mkdir(directory, { recursive: true })
  await writeFile(join(nonempty, 'keep.txt'), 'MP119 existing content')
  await chmod(readonly, 0o555)
  const readAppInfo = () =>
    page.evaluate(async () => {
      const result = (await window.api.ipcApi.request('app.get_info')) as IpcResult<OutputFor<'app.get_info'>>
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    })
  const original = await readAppInfo()
  const previous = await page.evaluate(async () => ({
    naming: await window.api.preference.get('topic.naming.enabled'),
    retention: await window.api.preference.get('app.logs.retention_days'),
    backup: await window.api.preference.get('data.backup.local.dir')
  }))
  const server = await startMockChatServer()
  const providerId = `mp119-${Date.now()}`
  const assistantName = app.resourceName('Migration history')
  let assistantId: string | undefined
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'app.logs.retention_days': 14
      })
    )
    const statuses = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp119-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP119 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp119-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mp119-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [provider.status, enabled.status, models.status]
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(statuses).toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp119-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const group = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await group.hover()
    await group.getByRole('button', { name: 'New Chat', exact: true }).click()
    // Only model inference is mocked; migration, backup and stored history use the real application.
    await Promise.all([
      sendChatMarker(page, 'Remember MP119-ORCHID-731', 'MP119-ORCHID-731 saved'),
      server.nextRequest().then((request) => request.complete('MP119-ORCHID-731 saved'))
    ])
    await openSettingsSection(page, 'Data')
    await page.getByRole('button', { name: 'Local Backup', exact: true }).click()
    const backupInput = page.getByPlaceholder('Select a directory for local backups', { exact: true })
    await backupInput.fill(backup)
    await backupInput.blur()
    await expect.poll(() => page.evaluate(() => window.api.preference.get('data.backup.local.dir'))).toBe(backup)
    await page.getByRole('button', { name: 'Backup to Local', exact: true }).click()
    const backupDialog = page.getByRole('dialog', { name: 'Backup to Local Directory', exact: true })
    const archiveName = await backupDialog.getByRole('textbox').inputValue()
    await backupDialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(backupDialog).toBeHidden({ timeout: 90_000 })
    const archive = await JSZip.loadAsync(await readFile(join(backup, archiveName)))
    expect(archive.file('Data/cherrystudio.sqlite')).not.toBeNull()
    await page.getByRole('button', { name: 'Data Directory', exact: true }).click()
    await screenshot('MP-119 application data before migration')
    const selectDirectory = async (path: string) => {
      await page
        .locator('#setting-data-data-app-data')
        .getByRole('button', { name: 'Modify Directory', exact: true })
        .click()
      try {
        chooseNativeFile(app.record.platform, { ...app.paths, fixtures: dirname(path) }, path)
      } catch (error) {
        throw new Error(`UNCOVERED: native directory chooser cannot be automated: ${String(error)}`)
      }
    }
    const dialog = page.getByRole('dialog', { name: 'Data Migration', exact: true })
    // A read-only directory only fails the write check on macOS: Node's Windows libuv accepts
    // directories regardless of the read-only attribute, so that toast cannot appear there.
    const rejected: [string, string][] = [[parse(destination).root, 'New path cannot be the root path']]
    if (app.record.platform === 'macos') rejected.push([readonly, 'New path does not have write permission'])
    for (const [path, error] of rejected) {
      await selectDirectory(path)
      await expect.soft(page.getByText(error, { exact: true }).first()).toBeVisible({ timeout: 3_000 })
      await screenshot(`MP-119 invalid directory ${path === readonly ? 'readonly' : 'root'}`)
      if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect((await readAppInfo()).appDataPath).toBe(original.appDataPath)
    }
    // A nonempty destination stays selectable; only an explicit copy request is refused.
    await selectDirectory(nonempty)
    await expect(dialog).toBeVisible()
    const nonemptySwitch = dialog.getByRole('switch')
    await expect(nonemptySwitch, 'Copying into a nonempty directory must be off').not.toBeChecked()
    await expect(nonemptySwitch, 'Copying into a nonempty directory must be unavailable').toBeDisabled()
    await screenshot('MP-119 nonempty destination without a copy request')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect((await readAppInfo()).appDataPath).toBe(original.appDataPath)
    expect(await readFile(join(nonempty, 'keep.txt'), 'utf8')).toBe('MP119 existing content')
    expect(await readdir(destination)).toEqual([])
    await selectDirectory(destination)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(original.appDataPath)
    await expect(dialog).toContainText(destination)
    await expect(dialog.getByRole('switch')).toBeChecked()
    await expect(dialog).toContainText('The app may need to restart multiple times to apply the changes')
    await expect(dialog).toContainText('Copying data may take a while, do not force quit app')
    await screenshot('MP-119 migration confirmation and copy warning')
    if (!packaged) {
      // Unpackaged builds refuse relocation by design, so no relocation window can appear.
      // Assert the documented rejection instead of waiting for a window that never opens.
      const rejection = await page.evaluate(async (target) => {
        const result = (await window.api.ipcApi.request('app.user_data_relocation.request', {
          path: target,
          copy: true
        })) as IpcResult<unknown>
        return result.ok ? 'accepted' : result.error.code
      }, destination)
      expect(rejection).toBe('USER_DATA_RELOCATION_UNAVAILABLE')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await screenshot('MP-119 relocation rejected for an unpackaged build')
      return
    }
    restoreBootConfig = true
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(dialog).toBeHidden()
    await app.disconnect()
    await adoptRelaunchedApp(app.paths)
    const relocation = await app.window('/userDataRelocation/')
    await expect(relocation.getByRole('button', { name: /Restart/ })).toBeVisible({ timeout: 120_000 })
    const migrationImage = await captureMaskedScreenshot(relocation, getSensitiveConfigValues())
    await testInfo.attach('MP-119 migration completed', { body: migrationImage, contentType: 'image/png' })
    page = await app.restart()
    expect((await readAppInfo()).appDataPath).toBe(destination)
    const migratedDb = await readFile(join(destination, 'Data/cherrystudio.sqlite'))
    expect(migratedDb.subarray(0, 16).toString()).toBe('SQLite format 3\0')
    expect((await readFile(join(original.appDataPath, 'Data/cherrystudio.sqlite'))).length).toBeGreaterThan(0)
    expect(await page.evaluate(() => window.api.preference.get('app.logs.retention_days'))).toBe(14)
    await selectSidebarApp(page, 'Chat')
    const restoredGroup = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await restoredGroup.hover()
    const expand = restoredGroup.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await page.getByTestId('topic-list-row').filter({ hasText: 'Remember MP119-ORCHID-731' }).click()
    await expect(page.getByText('MP119-ORCHID-731 saved', { exact: true }).last()).toBeVisible()
    await Promise.all([
      sendChatMarker(page, 'What code did I give you?', 'MP119-ORCHID-731 preserved'),
      server.nextRequest().then((request) => {
        expect(JSON.stringify(request.body.messages)).toContain('Remember MP119-ORCHID-731')
        request.complete('MP119-ORCHID-731 preserved')
      })
    ])
    await screenshot('MP-119 migrated history settings and usable conversation')
  } finally {
    try {
      if (restoreBootConfig) {
        await app.disconnect()
        const cdpPid = findCdpPid(app.record.platform)
        if (cdpPid && cdpPid !== app.record.electronPid) await adoptRelaunchedApp(app.paths)
        await stopOwnedApp(app.paths)
        if (bootConfigBackup) await writeFile(bootConfigPath, bootConfigBackup)
        else await rm(bootConfigPath, { force: true })
        page = await app.restart()
        expect((await readAppInfo()).appDataPath).toBe(original.appDataPath)
      }
      if (!page.isClosed())
        await page.evaluate(
          async ({ previous, assistantId, providerId }) => {
            await window.api.preference.setMultiple({
              'topic.naming.enabled': previous.naming,
              'app.logs.retention_days': previous.retention,
              'data.backup.local.dir': previous.backup
            })
            if (assistantId) {
              const deleted = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
                assistantId,
                deleteTopics: true
              })) as IpcResult<unknown>
              if (!deleted.ok) throw new Error(deleted.error.message)
            }
            await window.api.dataApi.request({
              id: 'mp119-cleanup',
              method: 'DELETE',
              path: `/providers/${providerId}`
            })
          },
          { previous, assistantId, providerId }
        )
    } finally {
      await chmod(readonly, 0o755)
      await server.close()
    }
  }
}
