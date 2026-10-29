import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'

import type { ConfigurationPayload } from '../../../src/main/data/db/restore/configurationBackup'
import type { DataRequest } from '../../../src/shared/data/api/types'
import type { Assistant } from '../../../src/shared/data/types/assistant'
import type { Message } from '../../../src/shared/data/types/message'
import type { Provider } from '../../../src/shared/data/types/provider'
import type { Topic } from '../../../src/shared/data/types/topic'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const launch = (profile: string) =>
  electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
    timeout: 60_000
  })

async function mainPage(app: ElectronApplication): Promise<Page> {
  const existing = await Promise.all(app.windows().map(async (page) => ({ page, title: await page.title() })))
  const page =
    existing.find(({ title }) => title === 'Cherry Studio')?.page ??
    (await app.waitForEvent('window', {
      predicate: async (window) => (await window.title()) === 'Cherry Studio',
      timeout: 60_000
    }))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.api?.preference), undefined, { timeout: 60_000 })
  await page.setViewportSize({ width: 1600, height: 1100 })
  return page
}

const test = base.extend<{ isolatedProfile: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture arguments.
  isolatedProfile: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    await mkdir(profile, { recursive: true })
    try {
      await use(profile)
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  },
  electronApp: async ({ isolatedProfile }, use) => {
    const app = await launch(isolatedProfile)
    try {
      await use(app)
    } finally {
      try {
        const proc = app.process?.()
        if (proc && proc.exitCode === null) await app.close()
      } catch {
        // Restore may already have detached the Electron handle.
      }
    }
  },
  mainWindow: async ({ electronApp }, use) => {
    await use(await mainPage(electronApp))
  }
})

async function request<T>(page: Page, input: Omit<DataRequest, 'id'>, status = 200): Promise<T> {
  const response = await page.evaluate((input) => window.api.dataApi.request(input), { ...input, id: randomUUID() })
  expect(response.status, `${input.method} ${input.path}: ${JSON.stringify(response.error)}`).toBe(status)
  return response.data as T
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file })
  await testInfo.attach(name, { path: file, contentType: 'image/png' })
}

test('configuration export excludes conversations and restores settings without replacing local conversations', async ({
  electronApp,
  isolatedProfile,
  mainWindow
}, testInfo) => {
  test.setTimeout(240_000)
  const suffix = randomUUID()
  const providerId = `e2e-config-${suffix}`
  const providerName = `Config ${suffix.slice(0, 8)}`
  const changedName = `Changed ${suffix.slice(0, 8)}`
  const modelId = 'e2e-configuration-model'
  const modelName = 'E2E model'
  const uniqueModelId = `${providerId}::${modelId}`
  const prompt = `Use the archived configuration instructions ${suffix}.`
  const sentinel = `CONVERSATION-SENTINEL-2211-${suffix}-${'private conversation bytes '.repeat(32)}`
  const messageText = `Keep this local conversation intact. ${sentinel}`
  const baseUrl = `http://127.0.0.1:1/${providerId}/v1`
  const exportDirectory = testInfo.outputPath('configuration-export')
  await mkdir(exportDirectory, { recursive: true })

  let app = electronApp
  let page = mainWindow
  let replacement: ElectronApplication | undefined
  const previous = await page.evaluate(async () => ({
    language: await window.api.preference.get('app.language'),
    onboarding: await window.api.preference.get('app.onboarding.provider_setup.status'),
    privacy: await window.api.preference.get('app.privacy.data_collection.enabled'),
    naming: await window.api.preference.get('topic.naming.enabled')
  }))

  try {
    await page.evaluate(async () => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('app.privacy.data_collection.enabled', false)
      await window.api.preference.set('topic.naming.enabled', false)
    })
    expect(previous.naming, 'The fresh-profile naming default must differ from the exported value').toBe(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(uiLocator(page, 'app.shell').first()).toBeVisible({ timeout: 120_000 })

    const provider = await request<Provider>(
      page,
      {
        method: 'POST',
        path: '/providers',
        body: {
          providerId,
          name: providerName,
          defaultChatEndpoint: 'openai-chat-completions',
          endpointConfigs: { 'openai-chat-completions': { baseUrl } }
        }
      },
      201
    )
    expect(provider).toMatchObject({ id: providerId, name: providerName })
    await request(
      page,
      {
        method: 'POST',
        path: '/models',
        body: [{ providerId, modelId, name: modelName, endpointTypes: ['openai-chat-completions'] }]
      },
      201
    )
    const assistant = await request<Assistant>(
      page,
      {
        method: 'POST',
        path: '/assistants',
        body: { name: `Configuration assistant ${suffix.slice(0, 8)}`, prompt, modelId: uniqueModelId }
      },
      201
    )
    const topic = await request<Topic>(
      page,
      {
        method: 'POST',
        path: '/topics',
        body: { name: `Preserved conversation ${suffix.slice(0, 8)}`, assistantId: assistant.id }
      },
      201
    )
    const message = await request<Message>(
      page,
      {
        method: 'POST',
        path: `/topics/${topic.id}/messages`,
        body: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: messageText }] } }
      },
      201
    )
    const readConversation = async () => ({
      topic: await request<Topic>(page, { method: 'GET', path: `/topics/${topic.id}` }),
      message: await request<Message>(page, { method: 'GET', path: `/messages/${message.id}` })
    })
    const before = await readConversation()
    expect(before.topic).toMatchObject({ id: topic.id, assistantId: assistant.id, activeNodeId: message.id })
    expect(before.message).toMatchObject({
      id: message.id,
      topicId: topic.id,
      data: { parts: [{ type: 'text', text: messageText }] }
    })

    await uiLocator(page, 'app.sidebar').getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = uiLocator(page, 'settings.view').filter({ visible: true }).first()
    await expect(settings).toBeVisible()
    await uiLocator(settings, 'settings.navigation').getByRole('button', { name: 'Data', exact: true }).click()
    const exportButton = uiLocator(settings, 'settings.data.action.export-configuration')
    await expect(exportButton).toHaveText('Export configuration')
    await expect(exportButton).toBeVisible()
    await expect(exportButton).toBeEnabled()
    await screenshot(page, testInfo, 'configuration-backup-01-data-settings')

    await exportButton.click()
    const exportPopup = page.getByRole('dialog', { name: 'Export configuration', exact: true })
    await expect(exportPopup).toBeVisible()
    const exclusions = exportPopup.getByText(/^Exports provider\/model configuration/)
    await expect(exclusions).toBeVisible()
    for (const exclusion of [
      'conversations and history',
      'attachments and other files',
      'uploaded logos',
      'MCP setup and selections',
      'knowledge bases and selections',
      'installed skills',
      'workspaces',
      'channels',
      'scheduled tasks and heartbeat configuration',
      'mini-apps/sites',
      'pins/tags',
      'resource sidebar shortcuts/favorites',
      'Machine startup settings, caches, browser/runtime data and system-agent roles are not copied.'
    ]) {
      await expect(exclusions).toContainText(exclusion)
    }
    await expect(exportPopup.getByRole('button', { name: 'Export configuration', exact: true })).toBeEnabled()
    await screenshot(page, testInfo, 'configuration-backup-02-export-confirmation')

    const originalOpenDialog = await app.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
    try {
      await app.evaluate(({ dialog }, destination) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] })
      }, exportDirectory)
      await exportPopup.getByRole('button', { name: 'Export configuration', exact: true }).click()
      await expect(exportPopup).toBeHidden({ timeout: 30_000 })
    } finally {
      try {
        await app.evaluate(({ dialog }, original) => {
          dialog.showOpenDialog = original
        }, originalOpenDialog)
      } finally {
        await originalOpenDialog.dispose()
      }
    }

    const archiveNames = (await readdir(exportDirectory)).filter((name) =>
      /^cherry-studio\.configuration\..+\.zip$/.test(name)
    )
    expect(archiveNames).toHaveLength(1)
    const archivePath = path.join(exportDirectory, archiveNames[0])
    expect((await stat(archivePath)).isFile()).toBe(true)
    const archive = new AdmZip(archivePath)
    const entries = archive.getEntries()
    expect(entries.map((entry) => entry.entryName).sort()).toEqual([
      'Configuration/configuration.json',
      'metadata.json'
    ])
    for (const entry of entries) {
      expect(
        entry.getData().includes(Buffer.from(sentinel)),
        `${entry.entryName} must contain no conversation bytes`
      ).toBe(false)
    }
    const metadata = JSON.parse(archive.readAsText('metadata.json'))
    expect(metadata).toMatchObject({ version: 8, scope: 'configuration' })
    expect(metadata.resources).toEqual({
      database: false,
      cache: false,
      indexedDB: false,
      localStorage: false,
      appClaude: false,
      data: false
    })
    const payload = JSON.parse(archive.readAsText('Configuration/configuration.json')) as ConfigurationPayload
    expect(payload.tables.user_provider).toContainEqual(
      expect.objectContaining({
        providerId,
        name: providerName,
        endpointConfigs: { 'openai-chat-completions': { baseUrl } }
      })
    )
    expect(payload.tables.user_model).toContainEqual(
      expect.objectContaining({ id: uniqueModelId, providerId, modelId })
    )
    expect(payload.tables.assistant).toContainEqual(expect.objectContaining({ id: assistant.id, prompt }))
    expect(payload.tables.preference).toContainEqual({ scope: 'default', key: 'topic.naming.enabled', value: false })

    const changed = await request<Provider>(page, {
      method: 'PATCH',
      path: `/providers/${providerId}`,
      body: { name: changedName }
    })
    expect(changed.name).toBe(changedName)
    expect((await request<Provider>(page, { method: 'GET', path: `/providers/${providerId}` })).name).toBe(changedName)
    expect(await readConversation()).toEqual(before)

    await uiLocator(settings, 'settings.content').getByRole('button', { name: 'Restore', exact: true }).click()
    const restorePopup = page.getByRole('dialog', { name: 'Data Restore', exact: true })
    await expect(restorePopup).toBeVisible()
    await expect(restorePopup).toContainText(
      'Full and Slim backups replace the current database, including conversations.'
    )
    await expect(restorePopup).toContainText(
      'Configuration backups merge their supported configuration and keep existing conversations and local-only definitions.'
    )
    await expect(restorePopup).toContainText('Cherry Studio will restart after restoration.')
    await expect(restorePopup.getByRole('button', { name: 'Select Backup File', exact: true })).toBeEnabled()
    await screenshot(page, testInfo, 'configuration-backup-03-restore-confirmation')

    // These one-shot native dialog stubs restore themselves before the real dev relaunch exits.
    const restoreProcess = app.process?.()
    const originalRestoreDialogs = await app.evaluateHandle(({ dialog }) => ({
      open: dialog.showOpenDialog,
      message: dialog.showMessageBoxSync
    }))
    try {
      await app.evaluate(({ dialog }, filePath) => {
        const open = dialog.showOpenDialog
        const message = dialog.showMessageBoxSync
        dialog.showOpenDialog = async () => {
          dialog.showOpenDialog = open
          return { canceled: false, filePaths: [filePath] }
        }
        dialog.showMessageBoxSync = (options) => {
          dialog.showMessageBoxSync = message
          if (
            options.title !== 'Manual Restart Required' ||
            options.message !== 'Auto-relaunch is not available in development mode.'
          ) {
            throw new Error(`Unexpected native restore dialog: ${JSON.stringify(options)}`)
          }
          return 0
        }
      }, archivePath)
      await Promise.all([
        app.waitForEvent('close', { timeout: 60_000 }),
        restorePopup.getByRole('button', { name: 'Select Backup File', exact: true }).click()
      ])
      await expect.poll(() => restoreProcess?.exitCode ?? null, { timeout: 15_000 }).toBe(0)
    } finally {
      try {
        if (restoreProcess?.exitCode === null) {
          await app.evaluate(({ dialog }, original) => {
            dialog.showOpenDialog = original.open
            dialog.showMessageBoxSync = original.message
          }, originalRestoreDialogs)
        }
      } finally {
        await originalRestoreDialogs.dispose()
      }
    }

    replacement = await launch(isolatedProfile)
    app = replacement
    page = await mainPage(app)
    await expect(uiLocator(page, 'app.shell').first()).toBeVisible({ timeout: 120_000 })
    const restored = await request<Provider>(page, { method: 'GET', path: `/providers/${providerId}` })
    expect(restored.name).toBe(providerName)
    expect(await readConversation()).toEqual(before)
    expect(await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))).toBe(false)

    const userData = path.join(isolatedProfile, 'userData')
    expect(existsSync(path.join(userData, 'Data', 'cherrystudio.sqlite'))).toBe(true)
    const artifacts = (await readdir(userData, { recursive: true })).filter((entry) =>
      ['restore-journal.json', 'work.sqlite'].includes(path.basename(entry))
    )
    expect(artifacts, 'Configuration restore must not leave full-restore artifacts anywhere in userData').toEqual([])
    const stagingRoot = path.join(userData, 'restore-staging')
    if (existsSync(stagingRoot)) {
      expect(await readdir(stagingRoot), 'Configuration restore must not stage a database promotion').toEqual([])
    }

    const navigation = await page.evaluate(
      (topicId) =>
        window.api.ipcApi.request('navigation.open_route_in_main', {
          path: `/app/chat?topicId=${encodeURIComponent(topicId)}`
        }),
      topic.id
    )
    expect(navigation).toMatchObject({ ok: true })
    const chat = uiLocator(page, 'chat.view').filter({ visible: true }).first()
    await expect(chat).toBeVisible()
    await expect(uiLocator(chat, 'chat.message').filter({ hasText: messageText })).toBeVisible()
    await expect(
      chat.getByText(`${modelName} | ${providerName}`, { exact: true }).filter({ visible: true }).first()
    ).toBeVisible()
    await screenshot(page, testInfo, 'configuration-backup-04-restored-chat')
  } finally {
    try {
      if (page.isClosed()) {
        try {
          const proc = app.process?.()
          if (proc && proc.exitCode === null) await app.close()
        } catch {
          // Restore may already have detached the Electron handle.
        }
        replacement = await launch(isolatedProfile)
        app = replacement
        page = await mainPage(app)
      }
      await page.evaluate(async (values) => {
        await window.api.preference.set('topic.naming.enabled', values.naming)
        await window.api.preference.set('app.privacy.data_collection.enabled', values.privacy)
        await window.api.preference.set('app.onboarding.provider_setup.status', values.onboarding)
        await window.api.preference.set('app.language', values.language)
      }, previous)
    } finally {
      try {
        const proc = replacement?.process?.()
        if (proc && proc.exitCode === null) await replacement?.close()
      } catch {
        // The replacement may already have closed or detached.
      }
    }
  }
})
