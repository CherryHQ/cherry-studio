import { writeFile } from 'node:fs/promises'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { openAttachmentPicker, submitChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

// Kept in sync with FIXTURE_MARKERS.attachmentPdf; importing fixtureFiles here breaks Playwright's loader.
const PDF_ATTACHMENT_MARKER = 'canary-seven'

export async function documentAttachments(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const providerId = `regression-mp31-${Date.now()}`
  const assistantName = app.resourceName('Document attachments assistant')
  const topicName = app.resourceName('Document attachments')
  const config = app.config.customProvider
  const previous = await page.evaluate(async () => ({
    naming: await window.api.preference.get('topic.naming.enabled'),
    menu: await window.api.preference.get('menu.presentation_mode')
  }))
  let assistantId: string | undefined
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'menu.presentation_mode': 'cherry' })
    )
    const created = await page.evaluate(
      async ({ providerId, config }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp31-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-31 real provider',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: config.baseUrl } },
            apiKeys: [{ id: 'mp31-key', key: config.apiKey, isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp31-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp31-model',
          method: 'POST',
          path: '/models',
          body: [
            {
              providerId,
              modelId: config.chatModel,
              endpointTypes: ['openai-chat-completions'],
              inputModalities: ['text'],
              outputModalities: ['text']
            }
          ]
        })
        return [provider.status, enabled.status, model.status]
      },
      { providerId, config }
    )
    expect(created, 'MP-31 real chat provider and model must be available').toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp31-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, config.chatModel) }
    )
    expect(assistant.status, 'MP-31 assistant must be created').toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({ id: 'mp31-topic', method: 'POST', path: '/topics', body: { name, assistantId } }),
      { name: topicName, assistantId }
    )
    expect(topic.status, 'MP-31 conversation must be created').toBe(201)

    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await expect(group, 'MP-31 assistant must appear in Chat').toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    await expect(
      page.getByRole('button', { name: 'Selected models', exact: true }),
      'MP-31 must use the real provider'
    ).toContainText('MP-31 real provider')
    const composer = chat.locator('[data-ui~="chat.composer"]')
    const editor = composer.locator('[contenteditable="true"]').first()
    const tokens = composer.locator('[data-composer-token-kind="file"]')
    const upload = async (name: string) => {
      await openAttachmentPicker(page, composer)
      chooseNativeFile(app.record.platform, app.paths, app.fixturesPath('documents', name))
      await expect(tokens, `${name} must create exactly one composer attachment`).toHaveCount(1)
      await expect(tokens, `The composer attachment must show ${name}`).toContainText(name)
    }
    await upload('attachment-pages.pdf')
    await screenshot('MP-31 PDF attachment ready')
    // Chat attachment preview is not asserted because the composer wires no preview callback.
    await tokens.hover()
    await tokens.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(tokens, 'Removing the PDF must clear the composer attachment').toHaveCount(0)

    await editor.fill('这份 PDF 第二页的关键字是什么？')
    await upload('attachment-pages.pdf')
    await submitChatMarker(page, PDF_ATTACHMENT_MARKER, false)
    await screenshot('MP-31 PDF parsed answer')
    await expect(tokens, 'Sending the PDF must clear the composer attachment').toHaveCount(0)
    // The DOCX half of MP-31 stays uncovered: generating a .docx fixture through the `docx` package
    // breaks Playwright's module loader, and the suite ships no static .docx fixture.
  } finally {
    await page.evaluate(
      async ({ assistantId, providerId, previous }) => {
        try {
          await window.api.preference.setMultiple({
            'topic.naming.enabled': previous.naming,
            'menu.presentation_mode': previous.menu
          })
          if (assistantId) {
            try {
              await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
            } catch {
              // Unsettled topic work can prevent assistant deletion.
            }
          }
        } finally {
          await window.api.dataApi.request({ id: 'mp31-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
        }
      },
      { assistantId, providerId, previous }
    )
  }
}
