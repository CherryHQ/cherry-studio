import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { type BranchMessagesResponse, MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { evaluateCdpExpression } from '../../../scripts/e2e/regression/cdpClient'
import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { assertOwnedProcess, findListeningPid, MAIN_INSPECTOR_PORT } from '../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { sendChatMarker } from './chat'
import { expect } from './fixture'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'
import { openSettingsSection } from './settings'

export async function clearCacheItems(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  // Branch launches divert logs into the run profile while a packaged build logs to the OS directory,
  // so ask the run-owned application where cleanup will look instead of assuming one layout.
  const appLogsDirectory = async () => {
    const record = app.record
    assertOwnedProcess(record, record.electronPid, 'electron')
    const inspectArgument = record.args.find((arg) => /^--inspect(?:-brk)?=/.test(arg))
    const inspectorPort = Number(inspectArgument?.split(':').at(-1)?.split('=').at(-1)) || MAIN_INSPECTOR_PORT
    if (findListeningPid(record.platform, inspectorPort) !== record.electronPid) {
      throw new Error('UNCOVERED: the run-owned application main process is unavailable')
    }
    const targets = (await (await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json()) as {
      type: string
      webSocketDebuggerUrl: string
    }[]
    const target = targets.find(({ type }) => type === 'node')
    if (!target) throw new Error('UNCOVERED: the run-owned main-process inspector target is missing')
    return evaluateCdpExpression<string>(
      target.webSocketDebuggerUrl,
      `(async () => {
        const application = Object.values(process.mainModule.require.cache)
          .map(module => module.exports?.application).find(candidate => candidate?.getPath)
        if (!application) throw new Error('UNCOVERED: application path inspection is unavailable')
        return application.getPath('app.logs')
      })()`
    )
  }
  const server = await startMockChatServer()
  const providerId = `regression-cache-${Date.now()}`
  const topicName = app.resourceName('Cache preservation')
  const assistantName = app.resourceName('Cache preservation assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'menu.presentation_mode': 'cherry' })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Cache preservation mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: `${providerId}-enable`,
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        }),
      { providerId, modelId: server.modelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'clear-messages-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'clear-messages-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id

    const readMessages = async () => {
      const response = await page.evaluate(
        (topicId) =>
          window.api.dataApi.request({
            id: 'clear-messages-read',
            method: 'GET',
            path: `/topics/${topicId}/messages`
          }),
        topicId
      )
      expect(response.status).toBe(200)
      const branch = response.data as BranchMessagesResponse
      expect(branch.nextCursor).toBeUndefined()
      return branch.items.map(({ message }) => MessageSchema.parse(message))
    }

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    await expect(chat).toBeVisible({ timeout: 30_000 })
    const assistantRow = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(assistantRow).toBeVisible({ timeout: 30_000 })
    await assistantRow.hover()
    const expandButton = assistantRow.getByRole('button', { name: 'Expand', exact: true })
    if (await expandButton.isVisible().catch(() => false)) await expandButton.click()
    const topicRow = chat.getByTestId('topic-list-row').filter({ hasText: topicName })
    await expect(topicRow).toBeVisible({ timeout: 30_000 })
    await topicRow.click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    const history = [{ prompt: 'Keep MP118 chat history.', answer: 'MP118 history retained.' }]
    for (const turn of history) {
      await Promise.all([
        sendChatMarker(page, turn.prompt, turn.answer),
        (async () => {
          const request = await server.nextRequest()
          expect(request.body.model).toBe(server.modelId)
          expect(request.body.messages).toEqual(
            expect.arrayContaining([expect.objectContaining({ role: 'user', content: turn.prompt })])
          )
          request.complete(turn.answer)
        })()
      ])
    }
    await expect(messages).toHaveCount(2)
    const originalMessages = await readMessages()
    expect(originalMessages.map(({ role }) => role)).toEqual(['user', 'assistant'])
    await topicRow.click({ button: 'right' })
    const [otherWindow] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('menuitem', { name: 'Open in New Window', exact: true }).click()
    ])
    await otherWindow.waitForURL('**/windows/subWindow/index.html')
    const originalPreferences = await page.evaluate(() => window.api.preference.getAll())
    await page.evaluate(async () => {
      const cache = await caches.open('mp118-cache')
      await cache.put('/mp118-cache', new Response('cache precondition '.repeat(8192)))
      localStorage.setItem('persist:cherry-studio', JSON.stringify({ mp118: 'legacy fixture' }))
    })
    await openSettingsSection(page, 'Data')
    const logDirectory = await appLogsDirectory()
    const oldLog = join(logDirectory, 'mp118-history.log')
    await mkdir(logDirectory, { recursive: true })
    await writeFile(oldLog, 'MP118 previous session log\n'.repeat(2048))
    const dialog = page.getByRole('dialog', { name: 'Clear Cache', exact: true })
    const option = (name: string) => dialog.locator('label').filter({ has: page.getByText(name, { exact: true }) })
    const size = (name: string) =>
      option(name)
        .locator('span')
        .filter({
          hasText: /^(?:Approx\. )?\d[\d,.]* (?:B|KB|MB|GB)(?: counted; some sizes are unknown)?$|^Unable to calculate$/
        })
        .last()
    const openCleanup = async () => {
      await page
        .locator('[data-ui~="settings.content"]')
        .getByRole('button', { name: 'Clear Cache', exact: true })
        .click()
      await expect(dialog).toBeVisible()
      for (const name of [
        'App cache',
        'Website and mini app data',
        'Leftover files and knowledge bases',
        'Old logs',
        'Leftover data from v1'
      ]) {
        await expect(size(name)).toBeVisible()
        await expect(option(name).getByRole('checkbox')).not.toBeChecked()
      }
      await expect(dialog.getByRole('button', { name: 'Clear Cache', exact: true })).toBeDisabled()
    }
    const assertPreserved = async () => {
      expect(await readMessages()).toEqual(originalMessages)
      expect(await page.evaluate(() => window.api.preference.getAll())).toEqual(originalPreferences)
    }
    try {
      await openCleanup()
      await expect(size('App cache')).not.toHaveText(/^(?:Approx\. )?0 B$/)
      await expect(size('Old logs')).not.toHaveText('0 B')
      await attachScreenshot('MP-118 cache sizes before cleanup')
      await option('App cache').getByRole('checkbox').check()
      await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(1)
      await dialog.getByRole('button', { name: 'Clear Cache', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('mp118-cache')
      expect(await readFile(oldLog, 'utf8')).toContain('MP118 previous session log')
      await assertPreserved()
      await openCleanup()
      await expect
        .soft(size('App cache'), 'App cache size must return to zero after clearing')
        .toHaveText(/^(?:Approx\. )?0 B$/)
      await attachScreenshot('MP-118 app cache size after clearing')
      await option('Old logs').getByRole('checkbox').check()
      await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(1)
      await dialog.getByRole('button', { name: 'Clear Cache', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect
        .poll(() =>
          readFile(oldLog).then(
            () => false,
            (error) => error.code === 'ENOENT'
          )
        )
        .toBe(true)
      await assertPreserved()
      await openCleanup()
      await expect(size('Old logs')).toHaveText('0 B')
      await attachScreenshot('MP-118 cleared cache and historical logs')
      await option('Leftover data from v1').getByRole('checkbox').click()
      const warning = page.getByRole('dialog', { name: 'Select leftover v1 data?', exact: true })
      await expect(warning).toBeVisible()
      await expect(warning).toContainText('v1 data will be permanently deleted')
      await expect(warning).toContainText('Without a backup, this data cannot be recovered.')
      await attachScreenshot('MP-118 irreversible v1 cleanup warning')
      await warning.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(option('Leftover data from v1').getByRole('checkbox')).not.toBeChecked()
      await option('Leftover data from v1').getByRole('checkbox').click()
      await warning.getByRole('button', { name: 'Select Anyway', exact: true }).click()
      await expect(option('Leftover data from v1').getByRole('checkbox')).toBeChecked()
      // Keep a real legacy database connection open to exercise Chromium's blocked deletion path.
      const connection = await otherWindow.evaluateHandle(
        async () =>
          new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('CherryStudio')
            request.onupgradeneeded = () => request.result.createObjectStore('mp118')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
      )
      try {
        await dialog.getByRole('button', { name: 'Clear Cache', exact: true }).click()
        await expect(
          page.getByText(
            'Waiting for the old database to be released. Close other Cherry Studio windows; cleanup will continue after their connections close.',
            { exact: true }
          )
        ).toBeVisible()
        await expect(dialog).toBeVisible()
        await attachScreenshot('MP-118 close other windows while legacy database is in use')
      } finally {
        await connection.evaluate((db) => db.close())
        await connection.dispose()
        await otherWindow
          .evaluate(() => window.api.ipcApi.request('window.close'))
          .catch((error) => {
            if (!otherWindow.isClosed()) throw error
          })
      }
      await expect(dialog).toBeHidden()
      expect(await page.evaluate(() => localStorage.getItem('persist:cherry-studio'))).toBeNull()
      expect(
        await page.evaluate(async () => (await indexedDB.databases()).some(({ name }) => name === 'CherryStudio'))
      ).toBe(false)
      await assertPreserved()
      await selectSidebarApp(page, 'Chat')
      await expect(messages).toHaveCount(2)
      await expect(messages.filter({ hasText: 'MP118 history retained.' })).toBeVisible()
      await attachScreenshot('MP-118 chat history preserved after cleanup')
    } finally {
      if (!otherWindow.isClosed()) {
        await otherWindow.evaluate(() => window.api.ipcApi.request('window.close')).catch(() => undefined)
      }
      await rm(oldLog, { force: true })
      await page.evaluate(async () => {
        await caches.delete('mp118-cache')
        localStorage.removeItem('persist:cherry-studio')
        localStorage.removeItem('cherry-studio:legacy-v1-cleanup-pending')
      })
    }
  } finally {
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode
        })
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.dataApi.request({
          id: `${providerId}-delete`,
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { assistantId, providerId, preferences }
    )
  }
}
