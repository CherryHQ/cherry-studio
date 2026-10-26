import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId, type Model } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import type { OutputFor } from '@shared/ipc/types'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { selectChatModel } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function imageAttachments(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    namingEnabled: await window.api.preference.get('topic.naming.enabled'),
    menuMode: await window.api.preference.get('menu.presentation_mode'),
    language: await window.api.preference.get('app.language')
  }))
  const config = app.config.customProvider
  const providerId = `regression-mp32-${Date.now()}`
  const topicName = app.resourceName('Image attachments')
  const assistantName = app.resourceName('Image attachments assistant')
  let assistantId: string | undefined

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'menu.presentation_mode': 'cherry' })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl, apiKey }) =>
        window.api.dataApi.request({
          id: `${providerId}-create`,
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP32 real vision provider',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'real-provider-key', key: apiKey, isEnabled: true }]
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
    const listing = (await page.evaluate(
      (providerId) => window.api.ipcApi.request('ai.provider.model.list', { providerId, throwOnError: true }),
      providerId
    )) as IpcResult<OutputFor<'ai.provider.model.list'>>
    await attachScreenshot('MP-32 application ready for vision model selection')
    if (!listing.ok) throw new Error(`Vision model discovery failed: ${listing.error.code}`)
    const resolved = await page.evaluate(
      ({ providerId, ids }) =>
        window.api.dataApi.request({
          id: 'mp32-resolve-models',
          method: 'GET',
          path: `/providers/${providerId}/models:resolve`,
          params: { ids }
        }),
      { providerId, ids: listing.data.models.map((model) => model.apiModelId!) }
    )
    expect(resolved.status).toBe(200)
    const visionModels = (resolved.data as Model[]).filter((model) => model.inputModalities?.includes('image'))
    await testInfo.attach('MP-32 available vision models', {
      body: JSON.stringify(visionModels.map(({ id, name, inputModalities }) => ({ id, name, inputModalities }))),
      contentType: 'application/json'
    })
    const vision =
      visionModels.find((model) => model.id?.endsWith(`::${config.chatModel}`)) ??
      visionModels.find((model) => /flash|mini/i.test(model.id)) ??
      visionModels[0]
    if (!vision?.id) throw new Error('UNCOVERED: configured account exposes no vision model')
    const textModels = (resolved.data as Model[]).filter(
      (model) =>
        model.inputModalities?.includes('text') &&
        !model.inputModalities.includes('image') &&
        !model.capabilities.includes('embedding')
    )
    const textModel = textModels.find((model) => model.id.endsWith(`::${config.chatModel}`)) ?? textModels[0]
    if (!textModel) throw new Error('UNCOVERED: configured account exposes no non-vision chat model')
    const visionModelId = vision.id.split('::').slice(1).join('::')
    const textModelId = textModel.id.split('::').slice(1).join('::')
    const models = await page.evaluate(
      ({ providerId, modelId, textModelId }) =>
        window.api.dataApi.request({
          id: `${providerId}-model`,
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId,
              name: 'MP32 Vision',
              endpointTypes: ['openai-chat-completions'],
              inputModalities: ['text', 'image']
            },
            {
              providerId,
              modelId: textModelId,
              name: 'MP32 Text Only',
              endpointTypes: ['openai-chat-completions'],
              inputModalities: ['text'],
              capabilities: []
            }
          ]
        }),
      { providerId, modelId: visionModelId, textModelId }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp32-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, visionModelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp32-topic',
          method: 'POST',
          path: '/topics',
          body: { name, assistantId }
        }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    TopicSchema.parse(topic.data)

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
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText('MP32 Vision')
    const composer = chat.locator('[data-ui~="chat.composer"] [contenteditable="true"]').first()
    // Real PNG bytes and real provider inference; the prompt contains neither the OCR answer nor the scene.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 900
      canvas.height = 500
      const context = canvas.getContext('2d')!
      context.fillStyle = 'white'
      context.fillRect(0, 0, 900, 500)
      context.fillStyle = 'black'
      context.font = 'bold 72px Arial'
      context.fillText('canary-seven', 100, 130)
      context.fillStyle = 'red'
      context.fillRect(140, 220, 180, 180)
      context.fillStyle = 'blue'
      context.beginPath()
      context.arc(600, 310, 90, 0, Math.PI * 2)
      context.fill()
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await testInfo.attach('images/sample.png', { body: Buffer.from(png, 'base64'), contentType: 'image/png' })
    const uploadImage = async (name: string) => {
      await composer.evaluate(
        (element, { png, name }) => {
          const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0))
          const clipboardData = new DataTransfer()
          clipboardData.items.add(new File([bytes], name, { type: 'image/png' }))
          element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
        },
        { png, name }
      )
    }
    await composer.fill('图片里写的 OCR 关键字是什么？请同时描述画面中的颜色和形状。')
    await uploadImage('sample.png')
    await expect(chat.locator('[data-ui~="chat.composer"] [data-composer-token-kind="file"]')).toHaveCount(1)
    await attachScreenshot('MP-32 uploaded image attachment')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const answer = chat
      .locator('[data-ui~="chat.message"][data-message-id]')
      .filter({ has: page.locator('.message-assistant') })
      .last()
    await expect(answer).toContainText('canary-seven', { timeout: 120_000 })
    const answerId = await answer.getAttribute('data-message-id')
    expect(answerId).toBeTruthy()
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(
            (id) => window.api.dataApi.request({ id: 'mp32-answer', method: 'GET', path: `/messages/${id}` }),
            answerId
          )
          expect(result.status).toBe(200)
          return (result.data as { status: string }).status
        },
        { timeout: 120_000 }
      )
      .toBe('success')
    await expect(answer).toContainText(/红色|red/i)
    await expect(answer).toContainText(/正方形|方块|square/i)
    await expect(answer).toContainText(/蓝色|blue/i)
    await expect(answer).toContainText(/圆|circle/i)
    await attachScreenshot('MP-32 real model OCR and scene description')

    const thumbnail = chat
      .locator('[data-ui~="chat.message"]')
      .filter({ has: page.locator('.message-user') })
      .last()
      .locator('[data-ui~="chat.image-block"] img')
      .last()
    await expect(thumbnail).toBeVisible()
    const thumbnailBox = await thumbnail.boundingBox()
    await thumbnail.click()
    const preview = page.getByTestId('image-preview-dialog')
    await expect(preview).toBeVisible()
    const previewImage = preview.locator('img').last()
    await expect(previewImage).toBeVisible()
    const previewBox = await previewImage.boundingBox()
    expect(previewBox!.width).toBeGreaterThan(thumbnailBox!.width)
    await attachScreenshot('MP-32 enlarged image preview')
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    await selectChatModel(page, textModelId)
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText('MP32 Text Only')
    await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
    await uploadImage('second.png')
    await attachScreenshot('MP-32 non-vision image upload outcome')
    await expect(page.getByText('当前模型不支持图片上传，仅可上传文档', { exact: true })).toBeVisible()
    await expect(chat.locator('[data-ui~="chat.composer"] [data-composer-token-kind="file"]')).toHaveCount(0)
    await attachScreenshot('MP-32 non-vision upload explicitly rejected')
  } finally {
    await page.evaluate(
      async ({ assistantId, providerId, preferences }) => {
        await window.api.preference.setMultiple({
          'app.language': preferences.language,
          'topic.naming.enabled': preferences.namingEnabled,
          'menu.presentation_mode': preferences.menuMode
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
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
}
