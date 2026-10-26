import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

import JSZip from 'jszip'

import { AssistantSchema } from '@shared/data/types/assistant'
import type { BranchMessagesResponse } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { dismissNativeMessageBox } from '../../../scripts/e2e/regression/systemAutomation'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { applicationDataMigration } from './applicationDataMigration'
import { sendChatMarker } from './chat'
import { chooseImportFile } from './chooseImportFile'
import { clearCacheItems } from './clearCacheItems'
import { test, expect } from './fixture'
import { importConversationFixtures } from './importConversationFixtures'
import { selectSidebarApp } from './navigation'
import { resetAppData } from './resetAppData'
import { openSettingsSection } from './settings'

test(...caseDefinition('MP-115'), async ({ app, mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  // Backup archives embed Data/cherrystudio.sqlite, whose provider rows hold the real API keys, so
  // they are written outside every uploaded artifact root.
  const directory = join(app.paths.private, 'MP-115-local-backups')
  await mkdir(directory, { recursive: true })
  const keys = [
    'data.backup.local.dir',
    'data.backup.local.max_backups',
    'data.backup.local.auto_sync',
    'data.backup.local.sync_interval',
    'topic.naming.enabled'
  ] as const
  const previous = await page.evaluate(async (keys) => {
    return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await window.api.preference.get(key)])))
  }, keys)
  const server = await startMockChatServer()
  const providerId = `mp115-${Date.now()}`
  const assistantName = app.resourceName('Backup history')
  let assistantId: string | undefined
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'data.backup.local.max_backups': 3,
        'data.backup.local.auto_sync': false,
        'data.backup.local.sync_interval': 0,
        'topic.naming.enabled': false
      })
    )
    // Only the remote model is mocked; all backup operations use the real application and filesystem.
    const providerStatuses = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const created = await window.api.dataApi.request({
          id: 'mp115-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-115 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp115-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mp115-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [created.status, enabled.status, models.status]
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(providerStatuses).toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp115-assistant',
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
    await Promise.all([
      sendChatMarker(page, 'MP115 preserve this conversation in the backup.', 'MP115 backup history ready.'),
      server.nextRequest().then((request) => request.complete('MP115 backup history ready.'))
    ])
    await openSettingsSection(page, 'Data')
    await page.getByRole('button', { name: 'Local Backup', exact: true }).click()
    const directoryInput = page.getByPlaceholder('Select a directory for local backups', { exact: true })
    await directoryInput.fill(directory)
    await directoryInput.blur()
    await expect.poll(() => page.evaluate(() => window.api.preference.get('data.backup.local.dir'))).toBe(directory)
    await page.evaluate(() => window.api.preference.set('data.backup.local.auto_sync', false))
    await attachScreenshot('MP-115 selected writable local directory')

    const backupButton = page.getByRole('button', { name: 'Backup to Local', exact: true })
    const backupDialog = page.getByRole('dialog', { name: 'Backup to Local Directory', exact: true })
    const manager = page.getByRole('dialog', { name: 'Local Backup Manager', exact: true })
    const inspectManager = async (names: string[]) => {
      await page.getByRole('button', { name: 'Restore from Local', exact: true }).click()
      await expect(manager).toBeVisible()
      for (const name of ['Filename', 'Modified Time', 'Size']) {
        await expect(manager.getByRole('columnheader', { name, exact: true })).toBeVisible()
      }
      for (const name of names) {
        const row = manager.getByRole('row').filter({ hasText: name })
        await expect(row).toBeVisible()
        await expect(row).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
        await expect(row).toContainText(/\d+(?:\.\d+)?\s+(?:KB|MB|GB)/)
        const cells = await row.getByRole('cell').allTextContents()
        const fileStat = await stat(join(directory, name))
        const displayedDate = cells.find((text) => /^\d{4}-\d{2}-\d{2}/.test(text))!
        expect(Math.abs(new Date(displayedDate).getTime() - fileStat.mtimeMs)).toBeLessThan(2_000)
        const size = cells.find((text) => /\d+.*(?:KB|MB|GB)/.test(text))!
        const unit = size.match(/(KB|MB|GB)/)![1]
        const divisor = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[unit]!
        expect(Math.abs(Number.parseFloat(size) * divisor - fileStat.size)).toBeLessThanOrEqual(divisor / 2)
      }
      await attachScreenshot(`MP-115 manager with ${names.length} archives`)
      await manager.getByRole('button', { name: 'Close', exact: true }).first().click()
    }
    const backups: { name: string; size: number; hash: string }[] = []
    for (let index = 0; index < 2; index++) {
      await backupButton.click()
      const name = await backupDialog.getByRole('textbox').inputValue()
      expect(name).toMatch(/^cherry-studio\..+\.zip$/)
      expect(backups.map((backup) => backup.name)).not.toContain(name)
      await backupDialog.getByRole('button', { name: 'Confirm', exact: true }).click()
      await expect(backupDialog).toBeHidden({ timeout: 90_000 })
      await expect
        .soft(page.getByText('Backup successful', { exact: true }).first(), 'Completion must be announced')
        .toBeVisible({ timeout: 5_000 })
      const bytes = await readFile(join(directory, name))
      const archive = await JSZip.loadAsync(bytes)
      expect(archive.file('metadata.json')).not.toBeNull()
      const database = archive.file('Data/cherrystudio.sqlite')
      expect(database, 'Backup must contain the database holding chat history and settings').not.toBeNull()
      expect((await database!.async('nodebuffer')).subarray(0, 16).toString()).toBe('SQLite format 3\0')
      backups.push({ name, size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') })
      expect(bytes.length).toBeGreaterThan(0)
      expect((await readdir(directory)).filter((name) => name.endsWith('.zip')).sort()).toEqual(
        backups.map(({ name }) => name).sort()
      )
      await inspectManager(backups.map(({ name }) => name))
    }
    expect(
      createHash('sha256')
        .update(await readFile(join(directory, backups[0].name)))
        .digest('hex')
    ).toBe(backups[0].hash)
    await testInfo.attach('MP-115 backup size comparison', {
      body: JSON.stringify(backups, null, 2),
      contentType: 'application/json'
    })

    await selectSidebarApp(page, 'Chat')
    await page
      .locator('[data-ui~="chat.composer"] [contenteditable="true"]')
      .first()
      .fill('MP115 keep this task running.')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const running = await server.nextRequest()
    running.sendText('MP115 still running')
    await expect(page.locator('[data-ui~="chat.composer.action.pause"]')).toBeVisible()
    await openSettingsSection(page, 'Data')
    await page.getByRole('button', { name: 'Local Backup', exact: true }).click()
    await backupButton.click()
    await backupDialog.getByRole('textbox').fill('mp115-running-task-blocked.zip')
    await backupDialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    const errorDialog = page.getByRole('dialog', { name: 'Backup failed', exact: true })
    await expect(errorDialog).toContainText(
      'A conversation or agent is still running. Wait for it to finish, then try again.'
    )
    await attachScreenshot('MP-115 active task backup blocked')
    expect((await readdir(directory)).filter((name) => name.endsWith('.zip')).sort()).toEqual(
      backups.map(({ name }) => name).sort()
    )
    running.complete(' finished')
  } finally {
    await server.close()
    await page.keyboard.press('Escape')
    await page.evaluate(
      async ({ previous, assistantId, providerId }) => {
        await window.api.preference.setMultiple(previous)
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.dataApi.request({ id: 'mp115-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { previous, assistantId, providerId }
    )
  }
})

test(...caseDefinition('MP-116'), async ({ app, mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  // Restored archives carry the live database; keep them out of the uploaded evidence roots.
  const backupDir = join(app.paths.private, 'MP-116-local-backups')
  await mkdir(backupDir, { recursive: true })
  const assistantName = app.resourceName('Restore assistant')
  const topicName = app.resourceName('Restore topic')
  const originalPreferences = await page.evaluate(async () => ({
    dir: await window.api.preference.get('data.backup.local.dir'),
    autoSync: await window.api.preference.get('data.backup.local.auto_sync'),
    slim: await window.api.preference.get('data.backup.local.skip_backup_file'),
    naming: await window.api.preference.get('topic.naming.enabled')
  }))
  await page.evaluate(async (backupDir) => {
    await window.api.preference.setMultiple({
      'data.backup.local.dir': backupDir,
      'data.backup.local.auto_sync': false,
      'data.backup.local.skip_backup_file': false,
      'topic.naming.enabled': false
    })
  }, backupDir)
  const assistant = await page.evaluate(
    (name) =>
      window.api.dataApi.request({
        id: 'mp116-assistant',
        method: 'POST',
        path: '/assistants',
        body: { name }
      }),
    assistantName
  )
  expect(assistant.status).toBe(201)
  const assistantId = AssistantSchema.parse(assistant.data).id
  const topic = await page.evaluate(
    ({ name, assistantId }) =>
      window.api.dataApi.request({
        id: 'mp116-topic',
        method: 'POST',
        path: '/topics',
        body: { name, assistantId }
      }),
    { name: topicName, assistantId }
  )
  expect(topic.status).toBe(201)
  const topicId = TopicSchema.parse(topic.data).id
  const readTopic = () =>
    page.evaluate(
      (id) =>
        window.api.dataApi.request({
          id: 'mp116-read',
          method: 'GET',
          path: `/topics/${id}`
        }),
      topicId
    )

  try {
    await openSettingsSection(page, 'Data')
    await page
      .locator('[data-slot="menu-item"]')
      .filter({ hasText: /^Local Backup$/ })
      .click()
    await page.getByRole('button', { name: 'Backup to Local', exact: true }).click()
    const backupDialog = page.getByRole('dialog', { name: 'Backup to Local Directory', exact: true })
    await backupDialog.getByRole('textbox').fill('MP-116-valid.zip')
    await backupDialog.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(backupDialog).toBeHidden({ timeout: 60_000 })
    const zip = await JSZip.loadAsync(await readFile(join(backupDir, 'MP-116-valid.zip')))
    expect(zip.file('metadata.json')).not.toBeNull()
    const metadata = JSON.parse(await zip.file('metadata.json')!.async('string'))
    zip.file('metadata.json', JSON.stringify({ ...metadata, version: metadata.version + 1 }))
    await writeFile(join(backupDir, 'MP-116-newer.zip'), await zip.generateAsync({ type: 'nodebuffer' }))
    await writeFile(join(backupDir, 'MP-116-broken.zip'), 'This is not a ZIP backup')

    await page.evaluate(async (topicId) => {
      await window.api.ipcApi.request('trash.topic.archive', { topicIds: [topicId] })
      await window.api.ipcApi.request('trash.topic.delete_permanently', { topicIds: [topicId] })
      await window.api.preference.set('topic.naming.enabled', true)
    }, topicId)
    expect((await readTopic()).status).toBe(404)
    expect(await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))).toBe(true)
    await page.getByRole('button', { name: 'Restore from Local', exact: true }).click()
    const manager = page.getByRole('dialog', { name: 'Local Backup Manager', exact: true })
    const confirmRestore = async (fileName: string) => {
      await manager
        .getByRole('row')
        .filter({ hasText: fileName })
        .getByRole('button', {
          name: 'Restore',
          exact: true
        })
        .click()
      const confirmation = page.getByRole('dialog', { name: 'Confirm Restore', exact: true })
      await expect(confirmation).toContainText(
        'Restoring from local backup will replace current data. Do you want to continue?'
      )
      return confirmation
    }
    await (await confirmRestore('MP-116-newer.zip')).getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect(
      page.getByText(
        'This backup was created by a newer version of Cherry Studio and cannot be restored on this version. Please update Cherry Studio and try again.',
        { exact: true }
      )
    ).toBeVisible()
    expect((await readTopic()).status).toBe(404)
    await attachScreenshot('MP-116 newer backup rejected')

    await (await confirmRestore('MP-116-broken.zip')).getByRole('button', { name: 'Confirm', exact: true }).click()
    await attachScreenshot('MP-116 restore failure response')
    await expect(
      page
        .getByText(/invalid.*zip|not.*zip|bad.*signature|central directory|invalid archive|corrupt|format error/i)
        .first()
    ).toBeVisible()
    expect((await readTopic()).status).toBe(404)
    await attachScreenshot('MP-116 restore failure reason')

    const confirmation = await confirmRestore('MP-116-valid.zip')
    await attachScreenshot('MP-116 overwrite confirmation')
    const visibleStages = new Set<string>()
    await page.exposeFunction('mp116VisibleStage', (stage: string) => visibleStages.add(stage))
    await page.evaluate(() => {
      const stages = [
        'Preparing restore...',
        'Extracting backup...',
        'Extraction successful',
        'Validating backup...',
        'Restoring files...',
        'Restoring database...',
        'Restore completed'
      ]
      const observer = new MutationObserver(() => {
        for (const stage of stages) {
          if (document.body.innerText.includes(stage)) {
            void (window as unknown as { mp116VisibleStage: (stage: string) => Promise<void> }).mp116VisibleStage(stage)
          }
        }
      })
      observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    const closed = page.waitForEvent('close', { timeout: 30_000 })
    // A development build ends the restore with a blocking native dialog before it exits,
    // so the box has to be acknowledged from the desktop while the click is still in flight.
    const acknowledged =
      app.record.mode === 'branch'
        ? dismissNativeMessageBox(app.record.platform, app.paths, 'Manual Restart Required')
        : undefined
    await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click()
    await Promise.all([closed, acknowledged])
    if (app.record.mode === 'branch') {
      // The exit was the restart the dialog asks for; bring the application back through the harness.
      page = await app.restart()
    } else {
      await expect(async () => {
        page = await app.mainWindow()
        await expect(page.locator('[data-ui="app.shell"]').first()).toBeVisible()
      }).toPass({ timeout: 60_000 })
    }
    await expect(page.locator('[data-ui="app.shell"]').first()).toBeVisible()
    const restored = await readTopic()
    expect(restored.status).toBe(200)
    expect(TopicSchema.parse(restored.data)).toMatchObject({ id: topicId, name: topicName, assistantId })
    expect(await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))).toBe(false)
    await selectSidebarApp(page, 'Chat')
    const header = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await header.hover()
    const expand = header.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await expect(page.getByTestId('topic-list-row').filter({ hasText: topicName })).toBeVisible()
    await attachScreenshot('MP-116 topic and settings restored')
    expect(
      visibleStages.size,
      'Restore must display multiple progress stages in the application window'
    ).toBeGreaterThanOrEqual(2)
  } finally {
    if (!page.isClosed()) {
      await page.evaluate(
        async ({ assistantId, originalPreferences }) => {
          await window.api.preference.setMultiple({
            'data.backup.local.dir': originalPreferences.dir,
            'data.backup.local.auto_sync': originalPreferences.autoSync,
            'data.backup.local.skip_backup_file': originalPreferences.slim,
            'topic.naming.enabled': originalPreferences.naming
          })
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        },
        { assistantId, originalPreferences }
      )
    }
  }
})

test(...caseDefinition('MP-117'), async ({ app, mainWindow: page }, testInfo) => {
  test.setTimeout(8 * 60_000)
  const original = await page.evaluate(async () => ({
    'data.backup.local.dir': await window.api.preference.get('data.backup.local.dir'),
    'data.backup.local.auto_sync': await window.api.preference.get('data.backup.local.auto_sync'),
    'data.backup.local.sync_interval': await window.api.preference.get('data.backup.local.sync_interval'),
    'data.backup.local.max_backups': await window.api.preference.get('data.backup.local.max_backups')
  }))
  const directory = join(app.paths.private, `MP-117-backups-${Date.now()}`)
  const savedDirectory = `${directory}-saved`
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const backups = async () => (await readdir(directory)).filter((name) => name.endsWith('.zip')).sort()
  const interval = page.getByRole('combobox').nth(0)
  const maximum = page.getByRole('combobox').nth(1)
  const lastBackup = page.getByText(/^Last Backup: \d{2}:\d{2}:\d{2}$/)
  const selectInterval = async (name: string) => {
    await interval.click()
    await page.getByRole('option', { name, exact: true }).click()
    await expect(interval).toHaveText(name)
  }

  await mkdir(directory, { recursive: true })
  try {
    // Seed only the configured-directory precondition; settings and scheduling use the real UI and clock.
    await page.evaluate(async (directory) => {
      await window.api.preference.set('data.backup.local.auto_sync', false)
      await window.api.preference.setMultiple({
        'data.backup.local.dir': directory,
        'data.backup.local.sync_interval': 0
      })
    }, directory)
    await openSettingsSection(page, 'Data')
    await page
      .locator('[data-slot="menu-item"]')
      .filter({ hasText: /^Local Backup$/ })
      .click()
    await expect(page.getByPlaceholder('Select a directory for local backups')).toHaveValue(directory)
    await selectInterval('1 minute')
    await expect.poll(() => page.evaluate(() => window.api.preference.get('data.backup.local.auto_sync'))).toBe(true)
    await attachScreenshot('MP-117 automatic backup at minimum interval')

    await maximum.click()
    await attachScreenshot('MP-117 maximum backup choices')
    const retention = page.getByRole('option', { name: '1', exact: true })
    await expect(retention, 'Maximum backups must offer a supported retention limit').toBeVisible()
    await retention.click()
    await expect(maximum).toHaveText('1')
    await expect.poll(() => page.evaluate(() => window.api.preference.get('data.backup.local.max_backups'))).toBe(1)

    let previousFiles: string[] = []
    let previousTime: string | null = null
    const generations: { files: string[]; lastBackup: string | null }[] = []
    for (let generation = 1; generation <= 2; generation++) {
      await expect
        .poll(
          async () => {
            const current = await backups()
            return current.length === 1 && current.some((name) => !previousFiles.includes(name))
          },
          { timeout: 90_000, intervals: [1_000] }
        )
        .toBe(true)
      const current = await backups()
      expect(current, 'A retention limit of one backup must prune older archives').toHaveLength(1)
      for (const name of current) expect((await stat(join(directory, name))).size).toBeGreaterThan(0)
      await expect(lastBackup).toBeVisible()
      if (previousTime) await expect(lastBackup).not.toHaveText(previousTime)
      if (generation === 2) expect(current).not.toContain(generations[0].files[0])
      previousFiles = current
      previousTime = await lastBackup.textContent()
      generations.push({ files: current, lastBackup: previousTime })
    }
    await testInfo.attach('MP-117 automatic backup generations', {
      body: JSON.stringify(generations),
      contentType: 'application/json'
    })
    await attachScreenshot('MP-117 two automatic backups retain the newest one')

    await selectInterval('Off')
    await expect.poll(() => page.evaluate(() => window.api.preference.get('data.backup.local.auto_sync'))).toBe(false)
    const stoppedAt = Date.now()
    await expect
      .poll(
        async () => {
          expect(await backups()).toEqual(previousFiles)
          return Date.now() - stoppedAt
        },
        { timeout: 75_000, intervals: [1_000] }
      )
      .toBeGreaterThanOrEqual(65_000)
    await attachScreenshot('MP-117 disabled backup produces no additional files')

    // Replace only the case-owned directory with a file to cause a real filesystem failure.
    await rename(directory, savedDirectory)
    await writeFile(directory, 'MP-117 destination is no longer a directory')
    await selectInterval('1 minute')
    const warning = page.getByRole('img', { name: /^Backup Error:/ })
    await expect(warning, 'Automatic backup must surface a real destination failure').toBeVisible({ timeout: 150_000 })
    await warning.hover()
    await expect(page.getByRole('tooltip').filter({ hasText: 'Backup Error:' }).first()).toBeVisible()
    await attachScreenshot('MP-117 automatic backup failure is visible')
  } finally {
    await page.keyboard.press('Escape')
    await page.evaluate(async (original) => {
      await window.api.preference.set('data.backup.local.auto_sync', false)
      await window.api.preference.setMultiple(original)
    }, original)
    await rm(directory, { recursive: true, force: true })
    await rm(savedDirectory, { recursive: true, force: true })
  }
})

test(...caseDefinition('MP-118'), async ({ app, mainWindow }, testInfo) => {
  await clearCacheItems(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-119'), async ({ app, mainWindow }, testInfo) => {
  await applicationDataMigration(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-120'), async ({ app, mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const readState = () =>
    page.evaluate(async () => {
      const assistants = await window.api.dataApi.request({
        id: 'mp120-assistants',
        method: 'GET',
        path: '/assistants',
        params: { limit: 200 }
      })
      const topics = await window.api.dataApi.request({
        id: 'mp120-topics',
        method: 'GET',
        path: '/topics',
        params: { limit: 200 }
      })
      if (assistants.status !== 200 || topics.status !== 200) throw new Error('Cannot read import state')
      const a = assistants.data as { items: { id: string; name: string }[]; total: number }
      const t = topics.data as { items: { id: string; name: string; assistantId?: string }[]; nextCursor?: string }
      if (a.total > a.items.length || t.nextCursor) throw new Error('Import state exceeds one page')
      const messages = await Promise.all(
        t.items.map(async (topic) => {
          const response = await window.api.dataApi.request({
            id: `mp120-messages-${topic.id}`,
            method: 'GET',
            path: `/topics/${topic.id}/messages`
          })
          if (response.status !== 200) throw new Error('Cannot read imported messages')
          return { topicId: topic.id, data: response.data }
        })
      )
      return { assistants: a.items, topics: t.items, messages }
    })
  const original = await readState()
  const importedIds: string[] = []
  try {
    for (const source of ['ChatGPT', 'Claude'] as const) {
      const fixtures = importConversationFixtures(source)
      const slug = source.toLowerCase()
      const importsDir = join(app.paths.fixtures, 'imports')
      await mkdir(importsDir, { recursive: true })
      const validPath = join(importsDir, `${slug}-conversations.json`)
      const invalidPath = join(importsDir, `${slug}-conversations-invalid.json`)
      await writeFile(validPath, fixtures.valid)
      await writeFile(invalidPath, fixtures.invalid)
      const importFile = async (path: string) => {
        await openSettingsSection(page, 'Data')
        await page
          .locator('[data-slot="menu-item"]')
          .filter({ hasText: /^Import App Data$/ })
          .click()
        await page
          .locator(`#setting-data-import-${slug}`)
          .getByRole('button', { name: 'Import Json File', exact: true })
          .click()
        const dialog = page.getByRole('dialog', { name: `Import ${source} Conversations`, exact: true })
        await expect(dialog).toBeVisible()
        await dialog.getByRole('button', { name: 'Select File', exact: true }).click()
        chooseImportFile(app, path)
        return dialog
      }
      const before = await readState()
      const dialog = await importFile(validPath)
      await expect(
        page.getByText('Successfully imported 2 conversations with 6 messages', { exact: true })
      ).toBeVisible()
      await expect(dialog).toBeHidden()
      await attachScreenshot(`MP-120 ${source} success counts`)
      const after = await readState()
      const newAssistants = after.assistants.filter((a) => !before.assistants.some((old) => old.id === a.id))
      importedIds.push(...newAssistants.map((a) => a.id))
      expect(newAssistants).toHaveLength(1)
      expect(newAssistants[0].name).toBe(`${source} Import`)
      const topics = after.topics.filter((t) => t.assistantId === newAssistants[0].id)
      expect(topics.map((t) => t.name).sort()).toEqual(fixtures.conversations.map((c) => c.name).sort())
      await selectSidebarApp(page, 'Chat')
      const header = page
        .locator('[data-ui~="chat.group-header"]')
        .filter({ hasText: `${source} Import` })
        .first()
      await expect(header).toBeVisible()
      await header.hover()
      const expand = header.getByRole('button', { name: 'Expand', exact: true })
      if (await expand.isVisible()) await expand.click()
      for (const conversation of fixtures.conversations) {
        const topic = topics.find((t) => t.name === conversation.name)!
        const stored = after.messages.find((m) => m.topicId === topic.id)!.data as BranchMessagesResponse
        expect(stored.nextCursor).toBeUndefined()
        expect(
          stored.items.map(({ message }) => ({
            role: message.role,
            parts: message.data.parts
          }))
        ).toEqual(
          conversation.messages.map((text, i) => ({
            role: i % 2 ? 'assistant' : 'user',
            parts: [{ type: 'text', text }]
          }))
        )
        await page.getByTestId('topic-list-row').filter({ hasText: conversation.name }).click()
        const messages = page.locator('[data-ui~="chat.message"][data-message-id]:visible')
        await expect(messages).toHaveCount(conversation.messages.length)
        for (const [i, text] of conversation.messages.entries()) await expect(messages.nth(i)).toContainText(text)
      }
      await attachScreenshot(`MP-120 ${source} complete imported conversation`)
      const beforeInvalid = await readState()
      const invalidDialog = await importFile(invalidPath)
      await expect(page.getByText(`Invalid ${source} format`, { exact: true })).toBeVisible()
      await expect(invalidDialog.getByRole('button', { name: 'Select File', exact: true })).toBeEnabled()
      expect(await readState()).toEqual(beforeInvalid)
      await attachScreenshot(`MP-120 ${source} invalid file rejected without partial data`)
      await invalidDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    }
  } finally {
    const current = await readState()
    const ids = new Set([
      ...importedIds,
      ...current.assistants.filter((a) => !original.assistants.some((old) => old.id === a.id)).map((a) => a.id)
    ])
    for (const assistantId of ids) {
      await page.evaluate(async (assistantId) => {
        await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
        await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
      }, assistantId)
    }
  }
})

test(...caseDefinition('MP-121'), async ({ app, mainWindow }, testInfo) => {
  await resetAppData(app, mainWindow, testInfo)
})
