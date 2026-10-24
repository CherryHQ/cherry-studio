import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

import { AssistantSchema } from '@shared/data/types/assistant'
import { KnowledgeBaseSchema } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function knowledgeAttachmentExclusion(app: RegressionApp, page: Page, testInfo: TestInfo) {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const preferences = await page.evaluate(async () => ({
    naming: await window.api.preference.get('topic.naming.enabled'),
    pinned: await window.api.preference.get('chat.input.toolbar.pinned_tools')
  }))
  const sourceText =
    '# Cherry Studio 更新日志\n\n## 2.1.7\n\n2.1.7 版本新增了知识库引用来源预览和 PDF 附件上传功能，修复了聊天消息滚动定位问题。\n\n## 2.1.6\n\n2.1.6 版本新增了主题颜色设置。\n'
  const sourcePath = join(app.paths.fixtures, 'sample-chinese.md')
  const pdfPath = join(app.paths.fixtures, 'sample.pdf')
  await writeFile(sourcePath, sourceText)
  const pdf = await PDFDocument.create()
  pdf.addPage().drawText('MP-34 PDF attachment')
  await writeFile(pdfPath, await pdf.save())
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Real configured chat provider; production BM25 indexing of case-owned sample-chinese.md, no mocked recall or answers.'
  })
  const providerId = `regression-mp34-${Date.now()}`
  const baseName = app.resourceName('MP34 sample Chinese')
  const assistantName = app.resourceName('Knowledge attachment assistant')
  const topicName = app.resourceName('Knowledge attachment topic')
  let baseId: string | undefined
  let assistantId: string | undefined
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'chat.input.toolbar.pinned_tools': ['knowledge-base', 'attachment']
      })
    )
    const base = await page.evaluate(
      (name) => window.api.ipcApi.request('knowledge.create_base', { base: { name } }),
      baseName
    )
    expect(base).toMatchObject({ ok: true })
    baseId = KnowledgeBaseSchema.parse((base as { data: unknown }).data).id
    const added = await page.evaluate(
      ({ baseId, sourcePath }) =>
        window.api.ipcApi.request('knowledge.add_items', {
          baseId,
          items: [{ type: 'file', data: { source: 'sample-chinese.md', path: sourcePath } }]
        }),
      { baseId, sourcePath }
    )
    expect(added).toMatchObject({ ok: true })
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(
            (baseId) =>
              window.api.dataApi.request({
                id: 'mp34-ready',
                method: 'GET',
                path: `/knowledge-bases/${baseId}/items`
              }),
            baseId!
          )
          expect(result.status).toBe(200)
          return (result.data as { items: { status: string }[] }).items.map((item) => item.status)
        },
        { timeout: 120_000 }
      )
      .toEqual(['completed'])
    const config = app.config.customProvider
    const statuses = await page.evaluate(
      async ({ providerId, config }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp34-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP34 live provider',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: config.baseUrl } },
            apiKeys: [{ id: 'mp34-key', key: config.apiKey, isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp34-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp34-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: config.chatModel, endpointTypes: ['openai-chat-completions'] }]
        })
        return [provider.status, enabled.status, model.status]
      },
      { providerId, config }
    )
    expect(statuses).toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp34-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId, prompt: '根据检索到的知识库文档准确回答，保留来源引用。不得混淆不同版本。' }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, config.chatModel) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp34-topic',
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
    const row = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await row.hover()
    const expand = row.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    const composer = chat.locator('[data-ui~="chat.composer"]')
    const knowledge = composer.getByRole('button', { name: 'Knowledge Base', exact: true })
    await composer.locator('[contenteditable="true"]').first().fill('2.1.7 版本加了什么')
    await knowledge.click()
    await page.getByTestId('quick-panel').getByText(baseName, { exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(composer).toContainText(baseName)
    await composer.getByRole('button', { name: 'Send', exact: true }).click()
    const answer = chat
      .locator('[data-ui~="chat.message"][data-message-id]')
      .filter({ has: page.locator('.message-assistant') })
      .last()
    await expect(answer).toContainText('2.1.7', { timeout: 120_000 })
    const messageId = await answer.getAttribute('data-message-id')
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(
            (id) => window.api.dataApi.request({ id: 'mp34-answer', method: 'GET', path: `/messages/${id}` }),
            messageId
          )
          return (result.data as { status: string }).status
        },
        { timeout: 120_000 }
      )
      .toBe('success')
    await expect(answer).toContainText('知识库')
    await expect(answer).toContainText(/来源|引用/)
    await expect(answer).toContainText(/PDF/i)
    await expect(answer).toContainText(/滚动|定位/)
    const citation = answer.getByRole('button', { name: /^Citation source \d+$/ }).first()
    await expect(citation).toBeVisible()
    await screenshot('MP-34 knowledge answer with citation marker')
    await citation.hover()
    await expect(page.getByRole('heading', { name: 'sample-chinese.md', exact: true }).first()).toBeVisible()
    await expect(page.getByRole('article').first()).toContainText(
      '2.1.7 版本新增了知识库引用来源预览和 PDF 附件上传功能'
    )
    await screenshot('MP-34 cited answer and original passage')
    await answer.getByRole('button', { name: /^\d+ citations$/ }).click()
    await expect(page.getByText('References', { exact: true })).toBeVisible()
    await expect(page.getByText('sample-chinese.md', { exact: true }).last()).toBeVisible()
    await expect(page.getByText(sourceText.split('\n')[4], { exact: false }).last()).toBeVisible()
    await screenshot('MP-34 opened citation source')
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()
    await composer.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(composer).not.toContainText(baseName)
    await composer.getByRole('button', { name: 'Upload attachment', exact: true }).click()
    chooseNativeFile(app.record.platform, app.paths, pdfPath)
    await expect(composer).toContainText('sample.pdf')
    await expect(knowledge).toBeDisabled()
    await knowledge.hover({ force: true })
    await expect(page.getByRole('tooltip')).toContainText('Remove attached files to use Knowledge Base')
    await screenshot('MP-34 attachment disables knowledge base')
    await composer.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(composer).not.toContainText('sample.pdf')
    await expect(knowledge).toBeEnabled()
    await knowledge.click()
    await page.getByTestId('quick-panel').getByText(baseName, { exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(composer).toContainText(baseName)
    await screenshot('MP-34 knowledge base selectable after attachment removal')
  } finally {
    await page.evaluate(
      async ({ preferences, assistantId, providerId, baseId }) => {
        await window.api.preference.setMultiple({
          'topic.naming.enabled': preferences.naming,
          'chat.input.toolbar.pinned_tools': preferences.pinned
        })
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        if (baseId) await window.api.ipcApi.request('knowledge.delete_base', { baseId })
        await window.api.dataApi.request({ id: 'mp34-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { preferences, assistantId, providerId, baseId }
    )
  }
}
