import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { createUniqueModelId, type Model } from '@shared/data/types/model'
import { isVisionModel } from '@shared/utils/model'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import type { BranchMessagesResponse } from '../../../../src/shared/data/types/message'
import { ensureCustomAssistant } from '../helpers/assistants'
import { sendChatMarker, submitChatMarker } from '../helpers/chat'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import type { RegressionApp } from '../RegressionApp'

// Real ExaMCP, configured chat provider and native OCR; no provider responses are mocked.
export async function toolSettings(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const original = await page.evaluate(async () => ({
    provider: await window.api.preference.get('chat.web_search.default_search_keywords_provider'),
    count: await window.api.preference.get('chat.web_search.max_results'),
    modelTools: await window.api.preference.get('chat.web_search.model_tools_preferred'),
    ocr: await window.api.preference.get('feature.file_processing.default_image_to_text')
  }))
  const ocrProviderId = `mp139-ocr-${Date.now()}`
  try {
    await ensureCustomAssistant(app, page)
    await expect(page.locator('[data-ui~="settings.view"]:visible')).toHaveCount(0)
    await expect(page.locator('[data-ui~="chat.composer"]:visible')).toBeVisible()
    await openSettingsSection(page, 'Web Search')
    const searchSection = page.getByRole('region', { name: 'Search service provider', exact: true })
    await searchSection.getByRole('combobox', { name: 'Search service provider', exact: true }).click()
    await page.getByRole('option', { name: 'ExaMCP', exact: true }).click()
    await searchSection.getByRole('button', { name: 'Check', exact: true }).click()
    const verification = page.getByText(/^Verification (successful|failed: .+)/).last()
    await expect(verification).toBeVisible({ timeout: 90_000 })
    await screenshot('MP-139 search provider verification')
    await testInfo.attach('Search provider check result', {
      body: await verification.innerText(),
      contentType: 'text/plain'
    })
    await searchSection.getByRole('button', { name: 'Advanced Settings', exact: true }).click()
    const count = searchSection.getByRole('spinbutton', { name: 'Number of search results', exact: true })
    await count.fill('1')
    await count.press('Tab')
    await expect.poll(() => page.evaluate(() => window.api.preference.get('chat.web_search.max_results'))).toBe(1)
    await page.evaluate(() => window.api.preference.set('chat.web_search.model_tools_preferred', false))

    await openSettingsSection(page, 'OCR')
    const processor = page.getByRole('combobox', { name: 'OCR', exact: true })
    await processor.click()
    await page.getByRole('option', { name: 'Mistral', exact: true }).click()
    await processor.click()
    await page.getByRole('option', { name: 'System OCR', exact: true }).click()
    await expect(
      page.getByText('Detected available macOS Live Text / Windows OCR engine.', { exact: true })
    ).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => window.api.preference.get('feature.file_processing.default_image_to_text')))
      .toBe('system')
    await screenshot('MP-139 available file processor')
    await closeSettings(page)
    await expect(page.locator('[data-ui~="settings.view"]:visible')).toHaveCount(0)
    const webSearch = page
      .locator('[data-ui~="chat.composer"]:visible')
      .getByRole('button')
      .filter({ has: page.locator('[data-slot="web-search-provider-icon"]') })
    await expect(webSearch).toBeVisible()
    if ((await webSearch.getAttribute('aria-pressed')) !== 'true') await webSearch.click()
    await expect(webSearch).toHaveAttribute('aria-pressed', 'true')

    const assertSearchCount = async (expected: number) => {
      const id = await sendChatMarker(
        page,
        'Call web_search exactly once with the query "Cherry Studio Electron GitHub". Do not call web_fetch. After the tool returns, include SEARCH_COMPLETE in your answer.',
        'SEARCH_COMPLETE',
        false
      )
      const response = await page.evaluate(
        (id) => window.api.dataApi.request({ id: 'MP-139-search-message', method: 'GET', path: `/messages/${id}` }),
        id
      )
      expect(response.status).toBe(200)
      const message = response.data as BranchMessagesResponse['items'][number]['message']
      const tools = message.data.parts?.filter((part) => part.type === 'tool-web_search') ?? []
      expect(tools, 'Conversation must execute a real web search').toHaveLength(1)
      expect(tools[0]).toMatchObject({ state: 'output-available', output: expect.any(Array) })
      expect((tools[0] as { output: unknown[] }).output).toHaveLength(expected)
    }
    await assertSearchCount(1)
    await openSettingsSection(page, 'Web Search')
    await searchSection.getByRole('button', { name: 'Advanced Settings', exact: true }).click()
    await count.fill('2')
    await count.press('Tab')
    await expect.poll(() => page.evaluate(() => window.api.preference.get('chat.web_search.max_results'))).toBe(2)
    await closeSettings(page)
    await assertSearchCount(2)
    await screenshot('MP-139 conversation search result count')

    const ocrModelId = createUniqueModelId(ocrProviderId, app.config.customProvider.chatModel)
    const seeded = await page.evaluate(
      async ({ providerId, config }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp139-ocr-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP139 OCR routing',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: config.baseUrl } },
            apiKeys: [{ id: 'configured-key', key: config.apiKey, isEnabled: true }]
          }
        })
        if (provider.status !== 201) throw new Error('Could not create the case OCR provider')
        const enabled = await window.api.dataApi.request({
          id: 'mp139-ocr-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        if (enabled.status !== 200) throw new Error('Could not enable the case OCR provider')
        return window.api.dataApi.request({
          id: 'mp139-ocr-model',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId: config.chatModel,
              name: 'MP139 System OCR',
              endpointTypes: ['openai-chat-completions'],
              inputModalities: ['text'],
              capabilities: []
            }
          ]
        })
      },
      { providerId: ocrProviderId, config: app.config.customProvider }
    )
    expect(seeded.status).toBe(201)
    await page.reload()
    await page.getByRole('button', { name: 'Selected models', exact: true }).click()
    const selector = page.getByTestId('model-selector-content')
    await selector.getByTestId('model-selector-search').fill('MP139 System OCR')
    await selector.getByTestId(`model-selector-item-${ocrModelId}`).click()
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText('MP139 System OCR')
    const effective = await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp139-effective-model', method: 'GET', path: `/models/${id}` }),
      ocrModelId
    )
    expect(effective.status).toBe(200)
    expect(isVisionModel(effective.data as Model), 'System OCR must run before the model request').toBe(false)

    const composer = page.locator('[data-ui~="chat.composer"]:visible [contenteditable="true"]').first()
    await composer.fill(
      'Read the attached image using its extracted text. Quote the full label and numeric code. Do not search the web.'
    )
    // Pasting a real image exercises Chat's non-vision attachment → configured OCR pipeline.
    await composer.evaluate(async (element) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1000
      canvas.height = 180
      const context = canvas.getContext('2d')!
      context.fillStyle = 'white'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = 'black'
      context.font = 'bold 60px Arial'
      context.fillText('FILE PROCESSING 58597', 25, 110)
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'))
      const clipboardData = new DataTransfer()
      clipboardData.items.add(new File([blob], 'MP-139-ocr.png', { type: 'image/png' }))
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
    })
    await expect(page.locator('[data-ui~="chat.composer"]:visible [data-composer-token-kind="file"]')).toHaveCount(1)
    const messageId = await submitChatMarker(page, '58597', false)
    const answer = page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)
    await expect(answer).toContainText('FILE PROCESSING')
    await expect
      .poll(async () => {
        const response = await page.evaluate(
          (id) =>
            window.api.dataApi.request({
              id: 'MP-139-file-message',
              method: 'GET',
              path: `/messages/${id}`
            }),
          messageId
        )
        expect(response.status).toBe(200)
        return (response.data as { status: string }).status
      })
      .toBe('success')
    await screenshot('MP-139 processed file used in conversation')

    page = await app.restart()
    await openSettingsSection(page, 'Web Search')
    await expect(page.getByRole('combobox', { name: 'Search service provider', exact: true })).toContainText('ExaMCP')
    await page
      .getByRole('region', { name: 'Search service provider', exact: true })
      .getByRole('button', { name: 'Advanced Settings', exact: true })
      .click()
    await expect(page.getByRole('spinbutton', { name: 'Number of search results', exact: true })).toHaveValue('2')
    await openSettingsSection(page, 'OCR')
    await expect(page.getByRole('combobox', { name: 'OCR', exact: true })).toContainText('System OCR')
    await expect(
      page.getByText('Detected available macOS Live Text / Windows OCR engine.', { exact: true })
    ).toBeVisible()
    await screenshot('MP-139 tool settings retained after restart')
  } finally {
    await page.evaluate(
      async ({ original, ocrProviderId }) => {
        await window.api.preference.setMultiple({
          'chat.web_search.default_search_keywords_provider': original.provider,
          'chat.web_search.max_results': original.count,
          'chat.web_search.model_tools_preferred': original.modelTools,
          'feature.file_processing.default_image_to_text': original.ocr
        })
        const removed = await window.api.dataApi.request({
          id: 'mp139-delete-ocr-provider',
          method: 'DELETE',
          path: `/providers/${ocrProviderId}`
        })
        if (removed.status !== 204 && removed.status !== 404) throw new Error('Case OCR provider cleanup failed')
      },
      { original, ocrProviderId }
    )
  }
}
