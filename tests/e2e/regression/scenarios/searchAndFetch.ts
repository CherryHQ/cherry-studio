import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { webSearchOutputSchema } from '@shared/ai/builtinTools'
import { AssistantSchema } from '@shared/data/types/assistant'
import { MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function searchAndFetch(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode'),
    search: await window.api.preference.get('chat.web_search.default_search_keywords_provider'),
    fetch: await window.api.preference.get('chat.web_search.default_fetch_urls_provider'),
    native: await window.api.preference.get('chat.web_search.model_tools_preferred'),
    overrides: await window.api.preference.get('chat.web_search.provider_overrides')
  }))
  const config = app.config.customProvider
  const providerId = `regression-mp35-${Date.now()}`
  const topicName = app.resourceName('Search and fetch')
  const assistantName = app.resourceName('Search and fetch assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'menu.presentation_mode': 'cherry',
        'chat.web_search.default_search_keywords_provider': 'duckduckgo',
        'chat.web_search.default_fetch_urls_provider': 'fetch',
        'chat.web_search.model_tools_preferred': false
      })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl, apiKey }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP35 real provider',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mp35-key', key: apiKey, isEnabled: true }]
          }
        }),
      { providerId, baseUrl: config.baseUrl, apiKey: config.apiKey }
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
      { providerId, modelId: config.chatModel }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp35-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, config.chatModel) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp35-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    expect(TopicSchema.parse(topic.data).name).toBe(topicName)

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const row = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.hover()
    const expand = row.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible().catch(() => false)) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    const toggle = chat.getByRole('button', { name: 'Web Search', exact: true })
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]')
    const readMessage = async (id: string) => {
      const response = await page.evaluate(
        (id) =>
          window.api.dataApi.request({
            id: 'mp35-read',
            method: 'GET',
            path: `/messages/${id}`
          }),
        id
      )
      expect(response.status).toBe(200)
      return MessageSchema.parse(response.data)
    }
    const send = async (prompt: string) => {
      const previous = await messages.count()
      await chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first().fill(prompt)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(messages).toHaveCount(previous + 2)
      const response = messages.last()
      const id = (await response.getAttribute('data-message-id'))!
      await expect.poll(async () => (await readMessage(id)).status, { timeout: 120_000 }).toMatch(/^(success|error)$/)
      return { response, message: await readMessage(id) }
    }
    const outputs = (message: Awaited<ReturnType<typeof readMessage>>, tool: string) =>
      (message.data.parts ?? [])
        .filter((part) => part.type === `tool-${tool}`)
        .flatMap((part) => {
          const parsed = webSearchOutputSchema.safeParse((part as { output?: unknown }).output)
          return parsed.success ? parsed.data : []
        })

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await attachScreenshot('MP-35 web search enabled')
    const today = new Date().toISOString().slice(0, 10)
    const question = `Today is ${today}. Use web_search to find the latest BBC world news published today or yesterday. Summarize one headline with its publication date in YYYY-MM-DD format and cite the search result using [cite:id]. Do not invent current news.`
    const searched = await send(question)
    await attachScreenshot('MP-35 real search result and citations')
    expect.soft(searched.message.status).toBe('success')
    const results = outputs(searched.message, 'web_search')
    expect.soft(results.length, 'Enabled search must return real provider results').toBeGreaterThan(0)
    const currentDates = [0, 1].map((days) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10))
    expect
      .soft(searched.message.searchableText, 'Answer must date the current news')
      .toMatch(new RegExp(currentDates.join('|')))
    const citations = searched.response.locator('a[href^="http"]').filter({ has: page.locator('sup[data-citation]') })
    await expect
      .soft(citations.first(), 'Search answer must contain a clickable citation')
      .toBeVisible({ timeout: 5000 })
    // The model may open a search hit before citing it; every citation must match a real lookup result.
    const sources = [...results, ...outputs(searched.message, 'web_fetch')]
    for (const citation of await citations.all()) {
      expect.soft(sources.map((result) => result.url)).toContain(await citation.getAttribute('href'))
    }

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const offline = await send(
      `${question} Web search is now disabled. Do not reuse previous citations or claim a new search. If current information cannot be verified, say so.`
    )
    expect.soft(offline.message.status).toBe('success')
    expect
      .soft((offline.message.data.parts ?? []).filter((part) => /tool-(web_search|web_fetch)/.test(part.type)))
      .toEqual([])
    await expect.soft(offline.response.locator('sup[data-citation]')).toHaveCount(0)
    await attachScreenshot('MP-35 search disabled response')

    await toggle.click()
    const fetched = await send(
      'Use web_fetch to read https://example.com/ . Report the actual page title and summarize its body. Cite the fetched source. Do not answer from memory.'
    )
    expect.soft(fetched.message.status).toBe('success')
    const pages = outputs(fetched.message, 'web_fetch')
    expect.soft(pages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringMatching(/Example Domain/i),
          url: expect.stringMatching(/^https:\/\/example\.com\/?$/),
          content: expect.stringMatching(/documentation examples/i)
        })
      ])
    )
    expect.soft(fetched.message.searchableText).toMatch(/Example Domain/i)
    expect.soft(fetched.message.searchableText).toMatch(/documentation|illustrative|example/i)
    await attachScreenshot('MP-35 public URL title and summary')

    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'chat.web_search.default_search_keywords_provider': 'searxng',
        'chat.web_search.provider_overrides': { searxng: { capabilities: { searchKeywords: { apiHost: '' } } } }
      })
    )
    await toggle.hover()
    await expect(page.getByRole('tooltip')).toContainText(/Searxng is unavailable.*query is sent to ExaMCP/i)
    await attachScreenshot('MP-35 unavailable provider fallback notice')
  } finally {
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode,
          'chat.web_search.default_search_keywords_provider': preferences.search,
          'chat.web_search.default_fetch_urls_provider': preferences.fetch,
          'chat.web_search.model_tools_preferred': preferences.native,
          'chat.web_search.provider_overrides': preferences.overrides
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({ id: 'mp35-delete', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { assistantId, providerId, preferences }
    )
  }
}
