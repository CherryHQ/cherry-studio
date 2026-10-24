import { once } from 'node:events'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, type Page, type TestInfo } from '@playwright/test'

import { AssistantSchema } from '@shared/data/types/assistant'
import { KnowledgeBaseSchema } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { sendChatMarker } from './chat'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function knowledgeNotes(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const notesPath = testInfo.outputPath('mp63-notes')
  await mkdir(notesPath, { recursive: true })
  const preferences = await page.evaluate(async () => ({
    notesPath: await window.api.preference.get('feature.notes.path'),
    naming: await window.api.preference.get('topic.naming.enabled')
  }))
  const suffix = Date.now()
  const existingTitle = `MP63 existing ${suffix}`
  const newTitle = `MP63 new ${suffix}`
  const notes = [
    { title: existingTitle, content: 'The orchid launch password is ORCHID7319.' },
    { title: newTitle, content: 'The orchid recovery password is MARIGOLD8426.' }
  ]
  const created = (await page.evaluate(
    (name) => window.api.ipcApi.request('knowledge.create_base', { base: { name } }),
    app.resourceName(`Notes ${suffix}`)
  )) as { ok: boolean; data?: unknown }
  expect(created.ok).toBe(true)
  const base = KnowledgeBaseSchema.parse(created.data)
  const providerId = `mp63-${suffix}`
  let assistantId: string | undefined
  const requests: Array<{ messages: Array<{ role: string; content?: unknown }>; tools?: unknown[] }> = []
  // Only the model is scripted; kb_search must retrieve both real indexed note bodies.
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString()) as (typeof requests)[number]
    requests.push(body)
    const toolResult = body.messages.findLast((message) => message.role === 'tool')
    const message = toolResult
      ? { role: 'assistant', content: 'MP63 recall complete.' }
      : {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'mp63-search',
              type: 'function',
              function: {
                name: 'kb_search',
                arguments: JSON.stringify({ query: 'orchid password', baseIds: [base.id] })
              }
            }
          ]
        }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        id: `mp63-${requests.length}`,
        object: 'chat.completion',
        created: 1,
        model: 'mp63-chat',
        choices: [{ index: 0, message, finish_reason: toolResult ? 'stop' : 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
      })
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock model did not bind')

  const openNotesSource = async () => {
    await page.getByRole('button', { name: 'Add Data Source', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Note', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Add Data Source', exact: true })).toBeVisible()
  }
  try {
    await page.evaluate(async (notesPath) => {
      await window.api.preference.setMultiple({ 'feature.notes.path': notesPath, 'topic.naming.enabled': false })
    }, notesPath)
    await page.reload()
    await selectSidebarApp(page, 'Knowledge Base')
    await page.locator('[data-ui~="knowledge.navigation"]').getByText(base.name, { exact: true }).click()
    await openNotesSource()
    await screenshot('MP-63 note source dialog')
    const tree = (await page.evaluate(
      (rootPath) => window.api.ipcApi.request('file.tree.create', { rootPath }),
      notesPath
    )) as { ok: boolean; data?: { treeId: string }; error?: unknown }
    expect(tree.ok, `The real notes directory must load: ${JSON.stringify(tree)}`).toBe(true)
    if (tree.data)
      await page.evaluate((treeId) => window.api.ipcApi.request('file.tree.dispose', { treeId }), tree.data.treeId)
    const dialog = page.getByRole('dialog', { name: 'Add Data Source', exact: true })
    await expect(dialog.getByText('No notes found', { exact: true })).toBeVisible()
    await expect(
      dialog.getByText('Create notes in the Notes feature, then come back to select them here.', { exact: true })
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
    await screenshot('MP-63 no notes empty state')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    await page.evaluate(
      async ({ notesPath, note }) => {
        await window.api.file.write(`${notesPath}/${note.title}.md`, note.content)
      },
      { notesPath, note: notes[0] }
    )
    await openNotesSource()
    await dialog.getByRole('listitem').filter({ hasText: existingTitle }).getByRole('checkbox').click()
    await expect(dialog.getByText('1 notes selected', { exact: true })).toBeVisible()
    await screenshot('MP-63 existing note selected')
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog).toBeHidden()

    await openNotesSource()
    await dialog.getByRole('radio', { name: 'New note', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(newTitle)
    await dialog.getByRole('textbox', { name: 'Content', exact: true }).fill(notes[1].content)
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog).toBeHidden()

    for (const note of notes) {
      const row = page.getByRole('row', { name: `Open ${note.title}`, exact: true })
      await expect(row.getByRole('gridcell').nth(2)).toHaveText('Notes')
      await expect(row.getByText('Ready', { exact: true })).toBeVisible({ timeout: 120_000 })
      const results = await page.evaluate(
        ({ baseId, query }) => window.api.ipcApi.request('knowledge.search', { baseId, query }),
        { baseId: base.id, query: note.content }
      )
      expect(JSON.stringify(results)).toContain(note.content)
    }
    await screenshot('MP-63 both note sources indexed and ready')
    expect
      .soft(await readdir(notesPath), 'New note must create a Notes file before indexing')
      .toContain(`${newTitle}.md`)

    const seeded = await page.evaluate(
      async ({ providerId, baseUrl, baseId, assistantName }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp63-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP63 mock model',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp63-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp63-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: 'mp63-chat', endpointTypes: ['openai-chat-completions'] }]
        })
        return { provider: provider.status, enabled: enabled.status, model: model.status, baseId, assistantName }
      },
      {
        providerId,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        baseId: base.id,
        assistantName: app.resourceName('Note recall')
      }
    )
    expect([seeded.provider, seeded.enabled, seeded.model]).toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId, baseId }) =>
        window.api.dataApi.request({
          id: 'mp63-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId, knowledgeBaseIds: [baseId] }
        }),
      { name: seeded.assistantName, modelId: createUniqueModelId(providerId, 'mp63-chat'), baseId: base.id }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const settings = await page.evaluate(
      (id) =>
        window.api.dataApi.request({
          id: 'mp63-nonstream',
          method: 'PATCH',
          path: `/assistants/${id}`,
          body: { settings: { streamOutput: false } }
        }),
      assistantId
    )
    expect(settings.status).toBe(200)
    const topic = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({
          id: 'mp63-topic',
          method: 'POST',
          path: '/topics',
          body: { assistantId, name }
        }),
      { assistantId, name: app.resourceName('Note recall topic') }
    )
    expect(topic.status).toBe(201)
    const savedTopic = TopicSchema.parse(topic.data)
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const group = page.locator('[data-ui~="chat.group-header"]').filter({ hasText: seeded.assistantName })
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await page.getByTestId('topic-list-row').filter({ hasText: savedTopic.name }).click()
    await sendChatMarker(
      page,
      'Find the orchid launch and recovery passwords in my knowledge notes.',
      'MP63 recall complete.'
    )
    const toolResults = requests.flatMap(({ messages }) => messages.filter(({ role }) => role === 'tool'))
    expect(JSON.stringify(toolResults), 'Real kb_search tool result must reach the chat model').toContain('ORCHID7319')
    expect(JSON.stringify(toolResults)).toContain('MARIGOLD8426')
    await screenshot('MP-63 conversation recalled both indexed notes')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await page.evaluate(
      async ({ baseId, providerId, assistantId, preferences }) => {
        await window.api.preference.setMultiple({
          'feature.notes.path': preferences.notesPath,
          'topic.naming.enabled': preferences.naming
        })
        if (assistantId) {
          await window.api.ipcApi.request('trash.assistant.archive', { assistantId, deleteTopics: true })
          await window.api.ipcApi.request('trash.assistant.delete_permanently', { assistantId, deleteTopics: true })
        }
        await window.api.dataApi.request({
          id: 'mp63-delete-provider',
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
        await window.api.ipcApi.request('knowledge.delete_base', { baseId })
      },
      { baseId: base.id, providerId, assistantId, preferences }
    )
  }
}
