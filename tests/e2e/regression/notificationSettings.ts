import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import type { BranchMessagesResponse } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../helpers/http/mockChatServer'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'
import { openSettingsSection } from './settings'

function nativeNotification(text: string, click = false): boolean {
  const script = `on run argv
    tell application "System Events" to tell process "NotificationCenter"
      repeat with windowIndex from 1 to count of windows
        set windowElements to entire contents of window windowIndex
        repeat with groupReference in windowElements
          set notificationGroup to contents of groupReference
          if role of notificationGroup is "AXGroup" and subrole of notificationGroup is "AXNotificationCenterAlert" then
            set alertElements to entire contents of notificationGroup
            repeat with elementReference in alertElements
              set element to contents of elementReference
              if role of element is "AXStaticText" then
                if value of element as text is item 1 of argv then
                  if item 2 of argv is "click" then perform action "AXPress" of notificationGroup
                  return "found"
                end if
              end if
            end repeat
          end if
        end repeat
      end repeat
    end tell
    return "absent"
  end run`
  return (
    execFileSync('osascript', ['-e', script, '--', text, click ? 'click' : 'read'], {
      encoding: 'utf8',
      timeout: 10_000
    }).trim() === 'found'
  )
}

// A failure after the case hides the application must not leave it hidden for the cases that follow.
function restoreAppVisibility(pid: number): void {
  for (const action of ['set visible to true', 'set frontmost to true']) {
    try {
      execFileSync(
        'osascript',
        [
          '-e',
          `tell application "System Events" to tell (first application process whose unix id is ${pid}) to ${action}`
        ],
        {
          timeout: 10_000,
          stdio: 'ignore'
        }
      )
    } catch {
      // The application may already be gone; nothing is left to restore.
    }
  }
}

export async function notificationSettings(app: RegressionApp, initialPage: Page, testInfo: TestInfo): Promise<void> {
  expect(process.platform, 'Native notification automation requires macOS').toBe('darwin')
  let page = initialPage
  const keys = [
    'app.notification.assistant.enabled',
    'app.notification.backup.enabled',
    'app.notification.knowledge.enabled',
    'app.notification.mini_app.enabled',
    'app.notification.update.enabled'
  ] as const
  const rows = [
    'assistant-notification',
    'backup-notification',
    'knowledge-embed-notification',
    'mini-app-notification',
    'update-notification'
  ]
  const readPreferences = () =>
    page.evaluate(async (keys) => Promise.all(keys.map((key) => window.api.preference.get(key))), keys)
  const original = await readPreferences()
  const namingEnabled = await page.evaluate(() => window.api.preference.get('topic.naming.enabled'))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const server = await startMockChatServer()
  const providerId = `regression-notification-${Date.now()}`
  const topicName = app.resourceName(`Notification ${Date.now()}`)
  const assistantName = app.resourceName('Notification assistant')
  let assistantId: string | undefined
  try {
    await page.evaluate(() => window.api.preference.set('topic.naming.enabled', false))
    await openSettingsSection(page, 'Notifications')
    const changed = original.map((value, index) => (index === 0 ? true : !value))
    for (const [index, row] of rows.entries()) {
      const toggle = page.locator(`#setting-notifications-${row}`).getByRole('switch')
      await toggle.setChecked(changed[index])
      await expect(toggle).toBeChecked({ checked: changed[index] })
    }
    await expect.poll(readPreferences).toEqual(changed)
    await screenshot('MP-110 notification switches enabled and changed')
    page = await app.restart()
    await openSettingsSection(page, 'Notifications')
    for (const [index, row] of rows.entries()) {
      await expect(page.locator(`#setting-notifications-${row}`).getByRole('switch')).toBeChecked({
        checked: changed[index]
      })
    }
    await expect.poll(readPreferences).toEqual(changed)
    await screenshot('MP-110 notification switches persisted after restart')
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Notification settings mock',
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
          id: 'notification-settings-assistant',
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
          id: 'notification-settings-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const assistantRow = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(assistantRow).toBeVisible()
    await assistantRow.hover()
    const expand = assistantRow.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible().catch(() => false)) await expand.click()
    const topicRow = chat.getByTestId('topic-list-row').filter({ hasText: topicName })
    await topicRow.click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(server.modelId)

    for (const enabled of [true, false]) {
      if (!enabled) {
        await openSettingsSection(page, 'Notifications')
        await page.locator('#setting-notifications-assistant-notification').getByRole('switch').setChecked(false)
        await expect.poll(readPreferences).toEqual([false, ...changed.slice(1)])
        await selectSidebarApp(page, 'Chat')
        await topicRow.click()
      }
      const prompt = `MP-110 ${enabled ? 'enabled' : 'disabled'} ${Date.now()}`
      const answer = `${prompt} completed.`
      await chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill(prompt)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const request = await server.nextRequest()
      expect(request.body.model).toBe(server.modelId)
      expect(request.body.messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: 'user', content: prompt })])
      )
      // The mock holds the real HTTP response until the app is demonstrably in the background.
      await openSettingsSection(page, 'Notifications')
      execFileSync(
        'osascript',
        [
          '-e',
          `tell application "System Events" to set visible of (first application process whose unix id is ${app.record.electronPid}) to false`
        ],
        { timeout: 10_000 }
      )
      await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false)
      expect(nativeNotification(answer)).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      request.complete(answer)
      await expect
        .poll(async () =>
          page.evaluate(
            async ({ topicId, answer }) => {
              const response = await window.api.dataApi.request({
                id: 'notification-read',
                method: 'GET',
                path: `/topics/${topicId}/messages`
              })
              if (response.status !== 200) throw new Error('Could not read completed conversation')
              const branch = response.data as BranchMessagesResponse
              return branch.items.some(
                ({ message }) =>
                  message.role === 'assistant' &&
                  message.status === 'success' &&
                  message.searchableText.includes(answer)
              )
            },
            { topicId, answer }
          )
        )
        .toBe(true)
      if (enabled) {
        await expect.poll(() => nativeNotification(answer), { timeout: 15_000 }).toBe(true)
        expect(nativeNotification(answer, true)).toBe(true)
        await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
        await expect(chat).toBeVisible()
        await expect(chat.getByText(answer, { exact: true })).toBeVisible()
        await expect(topicRow).toHaveAttribute('data-selected', 'true')
        await screenshot('MP-110 system notification clicked returns to completed topic')
      } else {
        // Observe a bounded delivery window after confirmed completion, rather than checking too early.
        const deadline = Date.now() + 8000
        while (Date.now() < deadline) {
          expect(nativeNotification(answer), 'Disabled conversation notifications must never appear').toBe(false)
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        execFileSync(
          'osascript',
          [
            '-e',
            `tell application "System Events" to set frontmost of (first application process whose unix id is ${app.record.electronPid}) to true`
          ],
          { timeout: 10_000 }
        )
        await selectSidebarApp(page, 'Chat')
        await topicRow.click()
        await expect(chat.getByText(answer, { exact: true })).toBeVisible()
        await openSettingsSection(page, 'Notifications')
        await expect(
          page.locator('#setting-notifications-assistant-notification').getByRole('switch')
        ).not.toBeChecked()
        await screenshot('MP-110 completed reply with notifications disabled')
      }
    }
  } finally {
    await server.close()
    restoreAppVisibility(app.record.electronPid)
    await page.evaluate(
      async ({ keys, original, namingEnabled, assistantId, providerId }) => {
        for (const [index, key] of keys.entries()) await window.api.preference.set(key, original[index])
        await window.api.preference.set('topic.naming.enabled', namingEnabled)
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.dataApi.request({
          id: 'notification-cleanup',
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { keys, original, namingEnabled, assistantId, providerId }
    )
  }
}
