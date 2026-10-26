import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { KnowledgeItemListResponse } from '@shared/data/api/schemas/knowledges'
import { AssistantSchema } from '@shared/data/types/assistant'
import { KnowledgeBaseSchema, KnowledgeSearchResultSchema } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { sendChatMarker } from '../helpers/chat'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function noteKnowledgeExport(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  // Catch exports that toast success without indexing a recallable note, or overwrite a same-name source.
  const directory = await mkdtemp(join(process.cwd(), 'tests/e2e/regression/mp79-'))
  const noteName = `MP79 Observatory ${Date.now()}`
  const secret = `ORCHID-${Date.now()}-731`
  const content = `# Observatory access procedure\n\nThe observatory access code is ${secret}.\n`
  const baseName = app.resourceName(`Note export ${Date.now()}`)
  const providerId = `regression-mp79-${Date.now()}`
  const assistantName = app.resourceName('Note recall assistant')
  const topicName = app.resourceName('Note recall topic')
  const preferences = await page.evaluate(async () => ({
    path: await window.api.preference.get('feature.notes.path'),
    menu: await window.api.preference.get('menu.presentation_mode'),
    naming: await window.api.preference.get('topic.naming.enabled'),
    pinned: await window.api.preference.get('chat.input.toolbar.pinned_tools'),
    lastBase: await window.api.preference.get('chat.save.knowledge.last_base_id')
  }))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  testInfo.annotations.push({
    type: 'data-source',
    description: 'Real local BM25 note indexing and configured live chat provider; no mocked recall or answers.'
  })
  let baseId: string | undefined
  let assistantId: string | undefined
  try {
    await writeFile(join(directory, `${noteName}.md`), content)
    const created = await page.evaluate(
      (name) => window.api.ipcApi.request('knowledge.create_base', { base: { name } }),
      baseName
    )
    expect(created).toMatchObject({ ok: true })
    const base = KnowledgeBaseSchema.parse((created as { data: unknown }).data)
    baseId = base.id
    await page.evaluate(
      (path) =>
        window.api.preference.setMultiple({
          'feature.notes.path': path,
          'menu.presentation_mode': 'cherry',
          'topic.naming.enabled': false,
          'chat.input.toolbar.pinned_tools': ['knowledge-base']
        }),
      directory
    )
    await page.reload()
    const readItems = async () => {
      const response = await page.evaluate(
        (baseId) =>
          window.api.dataApi.request({
            id: 'mp79-items',
            method: 'GET',
            path: `/knowledge-bases/${baseId}/items`
          }),
        base.id
      )
      expect(response.status).toBe(200)
      return response.data as KnowledgeItemListResponse
    }
    const exportNote = async () => {
      await selectSidebarApp(page, 'Notes')
      const notes = page.locator('[data-ui~="notes.view"]:visible')
      const note = notes.getByText(noteName, { exact: true })
      await note.click()
      await expect(notes.locator('[data-ui~="notes.editor"][data-file-edit]')).toContainText(secret)
      await note.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Export notes to knowledge base', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Export notes to knowledge base', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Select Knowledge Base', exact: true }).click()
      await page.getByRole('option', { name: baseName, exact: true }).click()
      await expect(dialog).toContainText(baseName)
      await screenshot('MP-79 selected note and target knowledge base')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByText('Successfully exported to the knowledge base', { exact: true })).toBeVisible()
      await expect(dialog).toBeHidden()
      await screenshot('MP-79 successful export notification')
    }
    await selectSidebarApp(page, 'Notes')
    await screenshot('MP-79 existing note precondition')
    await page.evaluate(
      (path) => window.api.file.listDirectory(path, { recursive: false, includeFiles: true }),
      directory
    )
    await exportNote()
    await expect
      .poll(async () => (await readItems()).items.map(({ status }) => status), { timeout: 120_000 })
      .toEqual(['completed'])
    const initial = (await readItems()).items[0]
    expect(initial).toMatchObject({ type: 'note', data: { source: noteName, content } })
    await selectSidebarApp(page, 'Knowledge Base')
    await page.locator('[data-ui~="knowledge.navigation"]').getByText(baseName, { exact: true }).click()
    const panel = page.locator('[data-ui~="knowledge.content"]')
    const rows = panel
      .getByRole('grid', { name: 'Data sources', exact: true })
      .getByRole('row')
      .filter({ hasText: noteName })
    await expect(rows).toHaveCount(1)
    await expect(rows.first().getByText('Ready', { exact: true })).toBeVisible()
    await screenshot('MP-79 exported note source ready')
    const search = await page.evaluate(
      (baseId) => window.api.ipcApi.request('knowledge.search', { baseId, query: 'observatory access code' }),
      base.id
    )
    expect(search).toMatchObject({ ok: true })
    const hits = KnowledgeSearchResultSchema.array().parse((search as { data: unknown }).data)
    expect(hits.some((hit) => hit.itemId === initial.id && hit.pageContent.includes(secret))).toBe(true)

    const config = app.config.customProvider
    const statuses = await page.evaluate(
      async ({ providerId, config }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp79-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP79 live provider',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl: config.baseUrl } },
            apiKeys: [{ id: 'mp79-key', key: config.apiKey, isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp79-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp79-model',
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
          id: 'mp79-assistant',
          method: 'POST',
          path: '/assistants',
          body: {
            name,
            modelId,
            prompt:
              'Search the attached knowledge base before answering. Give the exact requested code and cite the retrieved note.'
          }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, config.chatModel) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({
          id: 'mp79-topic',
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
    const assistantRow = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await assistantRow.hover()
    const expand = assistantRow.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    const composer = chat.locator('[data-ui~="chat.composer"]')
    await composer.getByRole('button', { name: 'Knowledge Base', exact: true }).click()
    await page.getByTestId('quick-panel').getByText(baseName, { exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(composer).toContainText(baseName)
    await sendChatMarker(
      page,
      'What is the observatory access code? Search the attached knowledge base and cite the note.',
      secret,
      false
    )
    const answer = chat
      .locator('[data-ui~="chat.message"][data-message-id]')
      .filter({ has: page.locator('.message-assistant') })
      .last()
    const citation = answer.getByRole('button', { name: /^Citation source \d+$/ }).first()
    await expect(citation).toBeVisible()
    await citation.hover()
    await expect(page.getByRole('article').first()).toContainText(secret)
    await screenshot('MP-79 chat recalls exported note with source citation')
    await page.mouse.move(0, 0)

    // Export uses the documented default Keep All policy; both snapshots must survive independently.
    await exportNote()
    await expect
      .poll(async () => (await readItems()).items.map(({ status }) => status), { timeout: 120_000 })
      .toEqual(['completed', 'completed'])
    const repeated = (await readItems()).items
    expect(repeated.some(({ id }) => id === initial.id)).toBe(true)
    expect(new Set(repeated.map(({ id }) => id)).size).toBe(2)
    expect(repeated.every((item) => item.type === 'note' && item.data.content === content)).toBe(true)
    expect(new Set(repeated.map((item) => item.data.relativePath)).size).toBe(2)
    expect(repeated.every((item) => Boolean(item.data.relativePath))).toBe(true)
    await selectSidebarApp(page, 'Knowledge Base')
    await page.locator('[data-ui~="knowledge.navigation"]').getByText(baseName, { exact: true }).click()
    await expect(rows).toHaveCount(2)
    await expect(rows.getByText('Ready', { exact: true })).toHaveCount(2)
    await screenshot('MP-79 repeated export keeps both ready note sources')
  } finally {
    await page.evaluate(
      async ({ preferences, assistantId, providerId, baseId }) => {
        await window.api.preference.setMultiple({
          'feature.notes.path': preferences.path,
          'menu.presentation_mode': preferences.menu,
          'topic.naming.enabled': preferences.naming,
          'chat.input.toolbar.pinned_tools': preferences.pinned,
          'chat.save.knowledge.last_base_id': preferences.lastBase
        })
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        if (baseId) await window.api.ipcApi.request('knowledge.delete_base', { baseId })
        await window.api.dataApi.request({ id: 'mp79-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { preferences, assistantId, providerId, baseId }
    )
    await page.reload()
    await rm(directory, { recursive: true, force: true })
  }
}
