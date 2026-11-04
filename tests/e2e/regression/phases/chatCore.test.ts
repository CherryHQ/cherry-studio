import { writeFile } from 'node:fs/promises'

import type { Page } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { MessageSchema } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { test, expect } from '../fixture'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import { openSettingsSection } from '../helpers/settings'
import { chatImageGeneration } from '../scenarios/chatImageGeneration'
import { htmlArtifactPreview } from '../scenarios/htmlArtifactPreview'
import { imageAttachments } from '../scenarios/imageAttachments'
import { manageChatContext } from '../scenarios/manageChatContext'
import { messageBranches } from '../scenarios/messageBranches'
import { messageTokenDetails } from '../scenarios/messageTokenDetails'
import { searchAndFetch } from '../scenarios/searchAndFetch'

test(...caseDefinition('MP-10'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const preferences = await page.evaluate(async () => ({
    search: await window.api.preference.get('chat.web_search.default_search_keywords_provider'),
    fetch: await window.api.preference.get('chat.web_search.default_fetch_urls_provider'),
    overrides: await window.api.preference.get('chat.web_search.provider_overrides'),
    preferred: await window.api.preference.get('chat.web_search.model_tools_preferred'),
    naming: await window.api.preference.get('topic.naming.enabled')
  }))
  await testInfo.attach('Original provider selections', {
    body: JSON.stringify({ search: preferences.search, fetch: preferences.fetch }),
    contentType: 'application/json'
  })
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const searchSection = () => page.getByRole('region', { name: 'Search service provider', exact: true })
  const fetchSection = () => page.getByRole('region', { name: 'URL fetch provider', exact: true })
  const selectProvider = async (section: 'search' | 'fetch', name: string) => {
    const region = section === 'search' ? searchSection() : fetchSection()
    await region.getByRole('combobox').click()
    await page.getByRole('option', { name, exact: true }).click()
    await expect(region.getByRole('combobox')).toHaveText(name)
  }
  const providerId = `regression-mp10-${Date.now()}`
  let assistantId: string | undefined
  try {
    await openSettingsSection(page, 'Web Search')
    await searchSection().getByRole('combobox').click()
    const options = page.getByRole('option')
    const actualProviders = await options.allTextContents()
    await screenshot('MP-10 actual search provider list')
    const required = [
      'DuckDuckGo',
      'DeepSeek',
      'Querit',
      'Jina',
      'Exa',
      'Tavily',
      'Zhipu',
      'Searxng',
      'Tencent Yuanbao',
      'Bocha'
    ]
    for (const name of required) {
      const option = page.getByRole('option', { name, exact: true })
      if (await option.count()) {
        await option.scrollIntoViewIfNeeded()
        await expect(option).toBeVisible()
      } else {
        testInfo.annotations.push({ type: 'provider-unavailable-in-version', description: name })
      }
    }
    expect(actualProviders.some((name) => /Firecrawl|Serply|Parallel/.test(name))).toBe(true)
    await testInfo.attach('Actual search providers and version omissions', {
      body: JSON.stringify({ actualProviders, absent: required.filter((name) => !actualProviders.includes(name)) }),
      contentType: 'application/json'
    })
    await screenshot('MP-10 scrolled search provider list')
    await page.getByRole('option', { name: 'DuckDuckGo', exact: true }).click()
    await expect(searchSection()).toContainText('No API key required')
    expect(await page.evaluate(() => window.api.preference.get('chat.web_search.default_fetch_urls_provider'))).toBe(
      preferences.fetch
    )
    await expect(searchSection().getByPlaceholder('API Key', { exact: true })).toHaveCount(0)
    await expect(searchSection().getByRole('button', { name: 'Check', exact: true })).toHaveCount(0)
    await screenshot('MP-10 key-free DuckDuckGo settings')

    await selectProvider('fetch', 'fetch')
    await expect(searchSection().getByRole('combobox')).toHaveText('DuckDuckGo')
    await selectProvider('search', 'Tavily')
    await expect(fetchSection().getByRole('combobox')).toHaveText('fetch')
    await page.evaluate(async () => {
      const overrides = await window.api.preference.get('chat.web_search.provider_overrides')
      await window.api.preference.set('chat.web_search.provider_overrides', {
        ...overrides,
        tavily: { ...overrides.tavily, apiKeys: [] }
      })
    })
    await expect(searchSection().getByPlaceholder('API Key', { exact: true })).toHaveValue('')
    await searchSection().getByRole('button', { name: 'Check', exact: true }).click()
    await expect(page.getByText(/Verification failed:.*API key/i).last()).toBeVisible({ timeout: 60_000 })
    await screenshot('MP-10 readable missing API key error')
    await selectProvider('search', 'DuckDuckGo')
    await page.reload()
    await openSettingsSection(page, 'Web Search')
    await expect(searchSection().getByRole('combobox')).toHaveText('DuckDuckGo')
    await expect(fetchSection().getByRole('combobox')).toHaveText('fetch')
    await screenshot('MP-10 independently saved providers')

    // Use the configured real model and live DuckDuckGo; no canned replies or search results.
    const config = app.config.customProvider
    const created = await page.evaluate(
      async ({ providerId, config }) => {
        await window.api.preference.setMultiple({
          'chat.web_search.model_tools_preferred': false,
          'topic.naming.enabled': false
        })
        const provider = await window.api.dataApi.request({
          id: 'mp10-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-10 live chat',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: config.baseUrl } },
            apiKeys: [{ id: 'mp10-key', key: config.apiKey, isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp10-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mp10-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: config.chatModel, endpointTypes: ['openai-chat-completions'] }]
        })
        return [provider.status, enabled.status, models.status]
      },
      { providerId, config }
    )
    expect(created).toEqual([201, 200, 201])
    const assistantName = app.resourceName('Live web search')
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp10-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, config.chatModel) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topicName = app.resourceName('Search comparison')
    const topic = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({
          id: 'mp10-topic',
          method: 'POST',
          path: '/topics',
          body: { assistantId, name }
        }),
      { assistantId, name: topicName }
    )
    expect(topic.status).toBe(201)
    TopicSchema.parse(topic.data)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const row = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await row.hover()
    const expand = row.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    const composer = chat.locator('[data-ui~="chat.composer"]')
    await expect(composer.getByRole('button', { name: 'Web Search', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    await composer.getByRole('button', { name: 'Web Search', exact: true }).click()
    await expect(composer.getByRole('button', { name: 'Web Search', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const enabledMessageId = await sendChatMarker(
      page,
      `Use web search to find the latest Cherry Studio release as of ${new Date().toISOString().slice(0, 10)}. Cite at least one retrieved source. End with SEARCH_ON_DONE.`,
      'SEARCH_ON_DONE',
      false
    )
    const enabledMessage = chat.locator(`[data-message-id="${enabledMessageId}"]`)
    const readParts = async (id: string) => {
      const response = await page.evaluate(
        (id) =>
          window.api.dataApi.request({
            id: 'mp10-read-message',
            method: 'GET',
            path: `/messages/${id}`
          }),
        id
      )
      expect(response.status).toBe(200)
      return MessageSchema.parse(response.data).data?.parts ?? []
    }
    const searchResults = (await readParts(enabledMessageId)).flatMap((part) =>
      part.type === 'tool-web_search' && 'output' in part && Array.isArray(part.output)
        ? (part.output as { url: string }[])
        : []
    )
    expect(searchResults.length, 'The live search must return sources, not just a model-authored URL').toBeGreaterThan(
      0
    )
    const sources = enabledMessage.locator('a[href^="http"]')
    await expect(sources.first(), 'Search-enabled answer must expose a clickable source').toBeVisible()
    expect(new URL((await sources.first().getAttribute('href'))!).protocol).toMatch(/^https?:$/)
    const linkedUrls = await sources.evaluateAll((links) => links.map((link) => link.getAttribute('href')))
    expect(
      searchResults.some(({ url }) => linkedUrls.includes(url)),
      'At least one clickable citation must match a retrieved search result'
    ).toBe(true)
    await screenshot('MP-10 live search answer with source')
    await composer.getByRole('button', { name: 'Web Search', exact: true }).click()
    await expect(composer.getByRole('button', { name: 'Web Search', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    const disabledMessageId = await sendChatMarker(
      page,
      'Without using web search or citing earlier sources, what is the latest Cherry Studio release today? State if you cannot verify it. End with SEARCH_OFF_DONE.',
      'SEARCH_OFF_DONE',
      false
    )
    const disabledMessage = chat.locator(`[data-message-id="${disabledMessageId}"]`)
    await expect(disabledMessage.locator('a[href^="http"]')).toHaveCount(0)
    await expect(disabledMessage.getByRole('button', { name: /^\d+ citations$/ })).toHaveCount(0)
    expect((await readParts(disabledMessageId)).filter((part) => part.type === 'tool-web_search')).toEqual([])
    await expect(disabledMessage.locator('[data-ui~="chat.message-web-search-tool"]')).toHaveCount(0)
    await screenshot('MP-10 search disabled comparison')

    page = await app.restart()
    await openSettingsSection(page, 'Web Search')
    await expect(searchSection().getByRole('combobox')).toHaveText('DuckDuckGo')
    await expect(fetchSection().getByRole('combobox')).toHaveText('fetch')
    expect(
      await page.evaluate(async () => [
        await window.api.preference.get('chat.web_search.default_search_keywords_provider'),
        await window.api.preference.get('chat.web_search.default_fetch_urls_provider')
      ])
    ).toEqual(['duckduckgo', 'fetch'])
    await screenshot('MP-10 providers persisted after restart')
  } finally {
    if (page.isClosed()) page = await app.mainWindow()
    await page.evaluate(
      async ({ preferences, assistantId, providerId }) => {
        await window.api.preference.setMultiple({
          'chat.web_search.default_search_keywords_provider': preferences.search,
          'chat.web_search.default_fetch_urls_provider': preferences.fetch,
          'chat.web_search.provider_overrides': preferences.overrides,
          'chat.web_search.model_tools_preferred': preferences.preferred,
          'topic.naming.enabled': preferences.naming
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({ id: 'mp10-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { preferences, assistantId, providerId }
    )
  }
})

test(...caseDefinition('MP-27'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const errors: string[] = []
  const watchErrors = (target: Page) => {
    target.on('pageerror', (error) => errors.push(error.message))
    target.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
  }
  watchErrors(page)
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode'),
    sendShortcut: await window.api.preference.get('chat.input.send_message_shortcut')
  }))
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const providerId = `regression-mp27-${Date.now()}`
  const topicName = app.resourceName('Input interactions')
  const assistantName = app.resourceName('Input interactions assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'menu.presentation_mode': 'cherry',
        'chat.input.send_message_shortcut': ['Enter']
      })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'Clear messages mock',
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
          id: 'mp27-assistant',
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
          id: 'mp27-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    expect(TopicSchema.parse(topic.data).name).toBe(topicName)

    const referenceName = app.resourceName('Referenced topic')
    const reference = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp27-reference-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: referenceName, assistantId }
    )
    expect(reference.status).toBe(201)

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
    const composer = () => page.locator('[data-ui~="chat.composer"]:visible')
    const editor = () => composer().locator('[contenteditable="true"]').first()
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    await expect
      .poll(() => page.evaluate(() => window.api.preference.get('chat.input.send_message_shortcut')))
      .toEqual(['Enter'])

    await test.step('Shift+Enter inserts a newline; Enter sends both lines through the configured model', async () => {
      await editor().fill('MP27 first line')
      await editor().press('Shift+Enter')
      await editor().pressSequentially('MP27 second line')
      await expect(editor()).toHaveText(/MP27 first line\s*MP27 second line/)
      await expect(editor().locator('br')).toHaveCount(1)
      await expect(messages).toHaveCount(0)
      await attachScreenshot('MP-27 two-line draft before Enter')
      await editor().press('Enter')
      const request = await server.nextRequest()
      expect(request.body.model).toBe(server.modelId)
      expect(request.body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'MP27 first line\nMP27 second line' })
        ])
      )
      request.complete('MP27 multiline received')
      await expect(messages).toHaveCount(2)
      await expect(chat.getByText('MP27 multiline received', { exact: true })).toBeVisible()
      await expect(editor()).toHaveText('')
    })

    await test.step('@ lists another topic and inserts a reference chip', async () => {
      await editor().pressSequentially('@')
      const panel = page.getByTestId('quick-panel')
      await expect(panel).toBeVisible()
      const referenceRow = panel.getByRole('button').filter({ hasText: referenceName })
      await expect(referenceRow).toBeVisible()
      await attachScreenshot('MP-27 topic reference panel')
      await referenceRow.click()
      await expect(panel).toBeHidden()
      await expect(composer().locator('[data-composer-token-kind="reference"]')).toContainText(referenceName)
      await attachScreenshot('MP-27 inserted reference chip')
      await editor().fill('')
    })

    await test.step('Chat keeps slash text literal; agent slash commands stay out of Chat', async () => {
      await editor().pressSequentially('/')
      const panel = page.getByTestId('quick-panel')
      for (const command of ['/clear', '/compact', '/context', '/usage']) {
        await expect(panel.getByText(command, { exact: true }), `Chat must not offer ${command}`).toHaveCount(0)
      }
      await editor().pressSequentially('context')
      await expect(editor()).toContainText('/context')
      await expect(composer().locator('[data-composer-token-kind]')).toHaveCount(0)
      await attachScreenshot('MP-27 literal slash text in chat')
      await page.keyboard.press('Escape')
      await editor().fill('')
    })

    await test.step('Dragged input height can be restored and resets after an Electron restart', async () => {
      const handle = composer().getByRole('separator', { name: 'Resize input height', exact: true })
      await expect(handle).toBeVisible()
      const frame = () => composer().locator('[data-composer-editor-frame]')
      const originalHeight = (await frame().boundingBox())!.height
      const resize = async () => {
        const box = (await handle.boundingBox())!
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2, box.y - 140, { steps: 14 })
        await page.mouse.up()
        await expect.poll(async () => (await frame().boundingBox())!.height).toBeGreaterThan(originalHeight + 100)
      }
      await resize()
      const restore = composer().getByRole('button', { name: 'Restore', exact: true })
      await restore.focus()
      await restore.click()
      await expect.poll(async () => (await frame().boundingBox())!.height).toBeCloseTo(originalHeight, 0)
      await resize()
      await attachScreenshot('MP-27 resized input before restart')
      page = await app.restart()
      watchErrors(page)
      await selectSidebarApp(page, 'Chat')
      const restoredChat = page.locator('[data-ui~="chat.view"]:visible')
      const restoredAssistant = restoredChat
        .locator('[data-ui~="chat.group-header"]')
        .filter({ hasText: assistantName })
        .first()
      await expect(restoredAssistant).toBeVisible()
      await restoredAssistant.hover()
      const expand = restoredAssistant.getByRole('button', { name: 'Expand', exact: true })
      if (await expand.isVisible().catch(() => false)) await expand.click()
      await restoredChat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
      await expect(editor()).toBeEditable()
      await attachScreenshot('MP-27 input height after restart')
      await expect
        .poll(async () => (await frame().boundingBox())!.height, {
          message: 'Temporary input height must reset to the default after restart',
          timeout: 5000
        })
        .toBeCloseTo(originalHeight, 0)
    })
  } finally {
    expect
      .soft(errors, 'Input interactions must not produce renderer console errors or uncaught exceptions')
      .toEqual([])
    await server.close()
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode,
          'chat.input.send_message_shortcut': preferences.sendShortcut
        })
        if (assistantId) {
          const permanentlyDeletedAssistant2 = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant2.ok || !permanentlyDeletedAssistant2.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
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
})

test(...caseDefinition('MP-29'), async ({ app, mainWindow }, testInfo) => {
  await messageBranches(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-30'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(180_000)
  await manageChatContext(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-32'), async ({ app, mainWindow }, testInfo) => {
  await imageAttachments(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-35'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(420_000)
  await searchAndFetch(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-37'), async ({ app, mainWindow }, testInfo) => {
  await chatImageGeneration(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-39'), async ({ app, mainWindow }, testInfo) => {
  await messageTokenDetails(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-41'), async ({ app, mainWindow }, testInfo) => {
  test.setTimeout(3 * 60_000)
  await htmlArtifactPreview(app, mainWindow, testInfo)
})
