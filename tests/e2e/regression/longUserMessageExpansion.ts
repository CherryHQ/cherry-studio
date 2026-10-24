import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { MessageSchema } from '@shared/data/types/message'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { dismissOnboarding, selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function longUserMessageExpansion(
  app: RegressionApp,
  mainWindow: Page,
  testInfo: TestInfo
): Promise<void> {
  let page = mainWindow
  const language = await page.evaluate(() => window.api.preference.get('app.language'))
  const assistantName = app.resourceName('Long user messages')
  const topicName = app.resourceName('Long message expansion')
  const otherTopicName = app.resourceName('Switch away')
  const label = '默认展开长用户消息'
  const description = '默认完整显示较长的用户消息。手动展开或收起的消息会在本次会话中保留你的选择。'
  const texts = ['Manual', 'Default'].map((name) =>
    Array.from({ length: 18 }, (_, index) => `MP147 ${name} line ${index + 1}: long user message content.`).join('\n')
  )
  let assistantId: string | undefined
  let enabled = false
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const toggle = () =>
    page.getByRole('button', { name: label, exact: true }).or(page.getByRole('switch', { name: label, exact: true }))
  const openSettings = async () => {
    await page.evaluate(() => window.api.preference.set('app.language', 'en-US'))
    await selectSidebarApp(page, 'Settings')
    await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
    const navigation = page.locator('[data-ui~="settings.navigation"]')
    await screenshot('MP-147 message settings navigation')
    await expect(navigation.getByText('偏好', { exact: true })).toBeVisible({ timeout: 5_000 })
    await navigation.getByRole('button', { name: '消息设置', exact: true }).click()
    await expect(toggle()).toBeVisible()
    await expect(page.getByText(description, { exact: true })).toBeVisible()
  }
  const openTopic = async (name = topicName) => {
    await page.evaluate(() => window.api.preference.set('app.language', 'en-US'))
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: name }).click()
    await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
  }

  try {
    // Persisted messages exercise the real renderer; no model request or UI state is mocked.
    const assistant = await page.evaluate(
      (name) =>
        window.api.dataApi.request({ id: 'mp147-assistant', method: 'POST', path: '/assistants', body: { name } }),
      assistantName
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    let topicId = ''
    for (const name of [topicName, otherTopicName]) {
      const topic = await page.evaluate(
        ({ name, assistantId }) =>
          window.api.dataApi.request({
            id: 'mp147-topic',
            method: 'POST',
            path: '/topics',
            body: { name, assistantId }
          }),
        { name, assistantId }
      )
      expect(topic.status).toBe(201)
      if (name === topicName) topicId = TopicSchema.parse(topic.data).id
    }
    const messageIds: string[] = []
    for (const text of texts) {
      const message = await page.evaluate(
        ({ topicId, text }) =>
          window.api.dataApi.request({
            id: 'mp147-message',
            method: 'POST',
            path: `/topics/${topicId}/messages`,
            body: { role: 'user', data: { parts: [{ type: 'text', text }] }, status: 'success' }
          }),
        { topicId, text }
      )
      expect(message.status).toBe(201)
      messageIds.push(MessageSchema.parse(message.data).id)
    }
    await page.reload()
    await openSettings()
    await expect(toggle(), 'The default must be off before any toggle interaction').toHaveAttribute(
      'data-state',
      'unchecked'
    )
    await screenshot('MP-147 default disabled and help text')

    await openTopic()
    const message = (index: number) => page.locator(`[data-ui~="chat.message"][data-message-id="${messageIds[index]}"]`)
    const content = (index: number) => message(index).locator('[data-user-message-collapsible-content-preview]')
    const collapsed = async (index: number) => {
      await expect(message(index).getByRole('button', { name: '展开', exact: true })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
      await expect(content(index)).toContainText(`MP147 ${index === 0 ? 'Manual' : 'Default'} line 1:`)
      await expect(content(index)).not.toContainText(`line 18:`)
    }
    const expanded = async (index: number) => {
      await expect(content(index)).toHaveText(texts[index])
      await expect(message(index).getByRole('button', { name: '展开', exact: true })).toHaveCount(0)
      await expect(message(index).getByRole('button', { name: '收起', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    }
    await collapsed(0)
    await collapsed(1)
    await screenshot('MP-147 disabled truncates long messages')
    await message(0).getByRole('button', { name: '展开', exact: true }).click()
    await expanded(0)
    await openTopic(otherTopicName)
    await openTopic()
    await expanded(0)
    await message(0).getByRole('button', { name: '收起', exact: true }).click()
    await collapsed(0)

    await openSettings()
    await toggle().click()
    enabled = true
    await expect(toggle()).toHaveAttribute('data-state', 'checked')
    await openTopic()
    // The untouched message proves the new default independently of manual session choices.
    await expanded(1)
    await collapsed(0)
    await screenshot('MP-147 enabled expands untouched message')
    await message(1).getByRole('button', { name: '收起', exact: true }).click()
    await collapsed(1)
    await openTopic(otherTopicName)
    await openTopic()
    await collapsed(1)
    await screenshot('MP-147 manual collapse survives topic navigation')

    page = await app.restart('authenticated')
    await dismissOnboarding(page)
    await openSettings()
    await expect(toggle(), 'The enabled preference must survive a complete app restart').toHaveAttribute(
      'data-state',
      'checked'
    )
    await screenshot('MP-147 enabled preference survives restart')
    await openTopic()
    await expanded(0)
    await expanded(1)
  } finally {
    page = await app.mainWindow()
    if (enabled) {
      await openSettings()
      await toggle().click()
      await expect(toggle()).toHaveAttribute('data-state', 'unchecked')
    }
    await page.evaluate(
      async ({ assistantId, language }) => {
        await window.api.preference.set('app.language', language)
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
      },
      { assistantId, language }
    )
  }
}
