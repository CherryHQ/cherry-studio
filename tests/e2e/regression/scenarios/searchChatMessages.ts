import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function searchChatMessages(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode')
  }))
  const server = await startMockChatServer()
  const providerId = `regression-search-${Date.now()}`
  const topicName = app.resourceName('Search messages')
  const assistantName = app.resourceName('Search messages assistant')
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
            name: 'Search messages mock',
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
          id: 'search-messages-assistant',
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
          id: 'search-messages-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    const { id: _topicId } = TopicSchema.parse(topic.data)

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
    // Mock supplies deterministic content; all search behavior is exercised in the real application.
    const answerIds: string[] = []
    for (let index = 0; index < 10; index++) {
      const prompt = index === 1 ? 'MP38 user canary-seven question' : `MP38 question ${index}`
      const marker = index === 1 || index === 4 ? 'canary-seven' : `filler-${index}`
      const answer =
        `MP38 reply ${index}: ${marker}.\n\n` +
        Array.from(
          { length: 5 },
          (_, paragraph) =>
            `History paragraph ${index}.${paragraph}: sufficient conversation content to exercise scrolling and offscreen message navigation.`
        ).join('\n\n')
      const [id] = await Promise.all([
        sendChatMarker(page, prompt, answer),
        (async () => {
          const request = await server.nextRequest()
          expect(request.body.model).toBe(server.modelId)
          request.complete(answer)
        })()
      ])
      answerIds.push(id)
    }
    const scroller = chat.locator('[data-message-virtual-list-scroller]:visible')
    await expect(scroller).toHaveCount(1)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(1000)
    const originalScrollTop = await scroller.evaluate((element) => element.scrollTop)
    const target = chat.locator(`[data-ui~="chat.message"][data-message-id="${answerIds[1]}"]`)
    await expect(target).not.toBeInViewport()

    await page.keyboard.press('ControlOrMeta+f')
    const input = page.getByRole('textbox', { name: 'Search', exact: true })
    await expect(input).toBeVisible()
    const bar = input.locator('..').locator('..')
    await input.fill('canary')
    await expect(bar).toContainText('0/2')
    await bar.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(bar).toContainText('1/2')
    await expect(target).toBeInViewport()
    await expect(target).toContainText('canary-seven')
    const currentHighlight = () =>
      page.evaluate(() => {
        const highlights = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights
        return Array.from(highlights.get('message-search-current') ?? []).map((range) => {
          const node = range.startContainer.parentElement
          const rect = range.getBoundingClientRect()
          const scroller = node?.closest('[data-message-virtual-list-scroller]')
          const bounds = scroller?.getBoundingClientRect()
          return {
            text: range.toString(),
            messageId: node?.closest('[data-message-id]')?.getAttribute('data-message-id'),
            inViewport: Boolean(bounds && rect.top >= bounds.top && rect.bottom <= bounds.bottom)
          }
        })
      })
    await expect.poll(currentHighlight).toEqual([{ text: 'canary', messageId: answerIds[1], inViewport: true }])
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeLessThan(originalScrollTop - 500)
    await attachScreenshot('MP-38 search match highlighted and scrolled into view')

    const includeUser = bar.getByRole('button', { name: 'Include Your Questions', exact: true })
    await expect(includeUser).toHaveAttribute('aria-pressed', 'false')
    await includeUser.click()
    await expect(includeUser).toHaveAttribute('aria-pressed', 'true')
    await expect(bar).toContainText('0/3')
    await attachScreenshot('MP-38 search count and user-question toggle')

    await input.fill('mp38-no-such-word-9081726354')
    await expect(bar).toContainText('0/0')
    await expect(bar.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
    await expect(bar.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    await expect(bar.locator('[role="progressbar"], [aria-busy="true"], .animate-spin')).toHaveCount(0)
    await expect.poll(currentHighlight).toEqual([])
    await attachScreenshot('MP-38 no results empty state')

    await bar.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(input).toBeHidden()
    await expect.soft
      .poll(async () => Math.abs((await scroller.evaluate((element) => element.scrollTop)) - originalScrollTop), {
        timeout: 5000,
        message: 'Closing search must restore the original conversation scroll position'
      })
      .toBeLessThanOrEqual(3)
    await attachScreenshot('MP-38 conversation after closing search')
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
