import { once } from 'node:events'
import { constants } from 'node:fs'
import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, dirname, extname, join, resolve } from 'node:path'

import type { KnowledgeBaseListResponse, KnowledgeItemListResponse } from '@shared/data/api/schemas/knowledges'
import { GroupSchema } from '@shared/data/types/group'
import {
  type KnowledgeBase,
  type KnowledgeItem,
  type KnowledgeItemChunk,
  KnowledgeBaseSchema,
  KnowledgeItemChunkSchema,
  type KnowledgeSearchResult
} from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { customAssistantName, ensureCustomAssistant } from './assistants'
import { sendChatMarker } from './chat'
import { expect, test } from './fixture'
import { EMBEDDING_PROVIDER, ensureEmbeddingProvider, ensureKnowledgeBase, knowledgeName } from './knowledge'
import { knowledgeNotes } from './knowledgeNotes'
import { knowledgeSourceConflicts } from './knowledgeSourceConflicts'
import { knowledgeSourceOperations } from './knowledgeSourceOperations'
import { selectVisibleModel } from './models'
import { dismissOnboarding, selectSidebarApp } from './navigation'
import { renameMoveDeleteKnowledge } from './renameMoveDeleteKnowledge'
import { closeSettings } from './settings'

test(...caseDefinition('K-01'), async ({ app, mainWindow }) => {
  let page = mainWindow
  await test.step('Create and index a knowledge base, then verify recall', async () => {
    await ensureEmbeddingProvider(app, page)
    await expect(page.getByRole('heading', { name: EMBEDDING_PROVIDER, exact: true, level: 1 })).toBeVisible()
    await expect(page.getByText(app.config.customEmbeddingProvider.model, { exact: true })).toBeVisible()
    await closeSettings(page)
    await ensureKnowledgeBase(app, page)

    await page.getByRole('button', { name: 'Recall Test', exact: true }).click()
    await page.getByRole('textbox').last().fill('What is the regression knowledge answer?')
    await page
      .getByRole('button', { name: /Search|Test|Send/ })
      .last()
      .click()
    await expect(page.getByRole('dialog').last()).toContainText('CHERRY_KNOWLEDGE_58597', { timeout: 2 * 60_000 })
  })

  await test.step('Restart and verify the knowledge base persists', async () => {
    page = await app.restart('authenticated')
    await dismissOnboarding(page)
    await selectSidebarApp(page, 'Knowledge Base')
    await expect(
      page.locator('[data-ui="knowledge.navigation"]').getByText(knowledgeName(app), { exact: true })
    ).toBeVisible()
  })

  await test.step('Query the persisted knowledge base and verify the answer and citations', async () => {
    await ensureCustomAssistant(app, page)
    await page.getByRole('button', { name: `Edit Assistant: ${customAssistantName(app)}`, exact: true }).click()
    await page.getByRole('tab', { name: 'Knowledge', exact: true }).click()
    if (
      !(await page
        .getByText(knowledgeName(app), { exact: true })
        .isVisible()
        .catch(() => false))
    ) {
      await page.getByRole('button', { name: 'Add knowledge base', exact: true }).click()
      await page.getByText(knowledgeName(app), { exact: true }).click()
    }
    const assistantDialog = page.getByRole('dialog').last()
    await expect(assistantDialog.getByText(knowledgeName(app), { exact: true })).toBeVisible()
    await assistantDialog.getByRole('button', { name: 'Close', exact: true }).click()

    const sendQuestion = async () => {
      const composer = page.locator('[data-ui="chat.composer"] [contenteditable="true"]').first()
      await composer.fill('What is the regression knowledge answer? Include the exact marker and cite the source file.')
      await page.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
      const quickPanel = page.getByTestId('quick-panel')
      await quickPanel.getByText('Knowledge Base', { exact: true }).click()
      await quickPanel.getByText(knowledgeName(app), { exact: true }).click()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
    }
    const marker = page.getByText('CHERRY_KNOWLEDGE_58597', { exact: false }).last()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await sendQuestion()
      const visible = await marker
        .waitFor({ state: 'visible', timeout: 2 * 60_000 })
        .then(() => true)
        .catch(() => false)
      if (visible) break
    }
    await expect(marker).toBeVisible()
    await expect(page.locator('body')).toContainText('ground-truth.txt')
    await expect(page.getByText(/\d+ citations?/i)).toBeVisible()
  })
})

test(...caseDefinition('MP-59'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const stamp = `${new Date().toISOString().slice(0, 10)}-${Date.now()}`
  const name = `QA-KB-${stamp}`
  const invalidName = `${name}-no-embedding`
  const groupName = `QA-KB-group-${stamp}`
  const providerId = `mp59-${Date.now()}`
  const modelId = 'text-embedding-mp59'
  let groupId: string | undefined
  const embeddingRequests: { model: string; input: unknown }[] = []
  // Mock only the external embedding API; creation, validation and persistence use the real application.
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/embeddings' || request.method !== 'POST') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    embeddingRequests.push({ model: body.model, input: body.input })
    const inputs = Array.isArray(body.input) ? body.input : [body.input]
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        object: 'list',
        model: modelId,
        data: inputs.map((_, index) => ({ object: 'embedding', index, embedding: [0.1, 0.2, 0.3, 0.4] })),
        usage: { prompt_tokens: inputs.length, total_tokens: inputs.length }
      })
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Embedding mock did not bind a TCP port')

  const attachScreenshot = async (label: string) => {
    const path = testInfo.outputPath(`${label}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(label, { path, contentType: 'image/png' })
  }
  const readBases = async () => {
    const result = await page.evaluate(
      (search) =>
        window.api.dataApi.request({
          id: 'mp59-read',
          method: 'GET',
          path: '/knowledge-bases',
          params: { search }
        }),
      name
    )
    expect(result.status).toBe(200)
    return (result.data as KnowledgeBaseListResponse).items
  }
  const assertCreatedBase = async () => {
    const navigation = page.locator('[data-ui~="knowledge.navigation"]')
    const group = navigation.getByRole('button', { name: groupName, exact: true })
    await expect(group).toBeVisible()
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click()
    await navigation.getByRole('button', { name, exact: true }).click()
    const content = page.locator('[data-ui~="knowledge.content"]')
    await expect(content.getByText(name, { exact: true })).toBeVisible()
    await expect(content.getByText('No data sources yet', { exact: true })).toBeVisible()
    const bases = await readBases()
    expect(bases.filter((base) => base.name === name)).toEqual([
      expect.objectContaining({
        name,
        groupId,
        embeddingModelId: createUniqueModelId(providerId, modelId),
        dimensions: 4,
        itemCount: 0
      })
    ])
  }

  try {
    await test.step('Configure an embedding API and a selectable knowledge group', async () => {
      const results = await page.evaluate(
        async ({ providerId, modelId, baseUrl, groupName }) => {
          const provider = await window.api.dataApi.request({
            id: 'mp59-provider',
            method: 'POST',
            path: '/providers',
            body: {
              providerId,
              name: 'MP-59 embedding mock',
              defaultChatEndpoint: 'openai-chat-completions',
              endpointConfigs: { 'openai-embeddings': { baseUrl } },
              apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
            }
          })
          const enabled = await window.api.dataApi.request({
            id: 'mp59-enable',
            method: 'PATCH',
            path: `/providers/${providerId}`,
            body: { isEnabled: true }
          })
          const models = await window.api.dataApi.request({
            id: 'mp59-model',
            method: 'POST',
            path: '/models',
            body: [{ providerId, modelId, capabilities: ['embedding'], endpointTypes: ['openai-embeddings'] }]
          })
          const group = await window.api.dataApi.request({
            id: 'mp59-group',
            method: 'POST',
            path: '/groups',
            body: { entityType: 'knowledge', name: groupName }
          })
          return { provider, enabled, models, group }
        },
        { providerId, modelId, baseUrl: `http://127.0.0.1:${address.port}/v1`, groupName }
      )
      expect(results.provider.status).toBe(201)
      expect(results.enabled.status).toBe(200)
      expect(results.models.status).toBe(201)
      expect(results.group.status).toBe(201)
      groupId = GroupSchema.parse(results.group.data).id
      await page.reload()
    })

    await test.step('Require a name, then create a grouped knowledge base with an embedding model', async () => {
      await selectSidebarApp(page, 'Knowledge Base')
      await page
        .getByRole('button', { name: /^(Create|New) Knowledge Base$/ })
        .first()
        .click()
      const dialog = page.getByRole('dialog', { name: 'New Knowledge Base', exact: true })
      await dialog.getByRole('button', { name: 'Embedding Model', exact: true }).click()
      await selectVisibleModel(page, modelId)
      await dialog.getByRole('combobox').click()
      await page.getByRole('option', { name: groupName, exact: true }).click()
      await dialog.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(dialog.getByText('Knowledge base name is required', { exact: true })).toBeVisible()
      await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveAttribute('aria-invalid', 'true')
      expect(await readBases()).toEqual([])
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
      await attachScreenshot('MP-59 configured name embedding model and group')
      await dialog.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(dialog).toBeHidden()
      expect(embeddingRequests).toContainEqual({ model: modelId, input: ['test'] })
      await assertCreatedBase()
      await attachScreenshot('MP-59 created grouped knowledge base with zero sources')
    })

    await test.step('Restart Electron and verify the name, group, model and zero sources persist', async () => {
      page = await app.restart()
      await dismissOnboarding(page)
      await selectSidebarApp(page, 'Knowledge Base')
      await assertCreatedBase()
      await attachScreenshot('MP-59 knowledge base persisted after restart')
    })

    await test.step('Create a second knowledge base without an embedding model', async () => {
      await page.getByRole('button', { name: 'New Knowledge Base', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'New Knowledge Base', exact: true })
      await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(invalidName)
      await expect(dialog.getByRole('button', { name: 'Embedding Model', exact: true })).toContainText('Disabled')
      await dialog.getByRole('button', { name: 'Create', exact: true }).click()
      await attachScreenshot('MP-59 knowledge base saved without an embedding model')
      // Product behaviour confirmed by the owner on 2026-10-24: the embedding model is optional at
      // creation time (it can be configured later), so the base must be saved, not rejected.
      await expect(dialog).toBeHidden({ timeout: 10_000 })
      await expect
        .poll(async () => (await readBases()).filter((base) => base.name === invalidName).length, { timeout: 10_000 })
        .toBe(1)
    })
  } finally {
    const bases = await readBases()
    for (const base of bases.filter((base) => base.name === name || base.name === invalidName)) {
      await page.evaluate(
        (id) => window.api.dataApi.request({ id: 'mp59-clean-base', method: 'DELETE', path: `/knowledge-bases/${id}` }),
        base.id
      )
    }
    if (groupId)
      await page.evaluate(
        (id) => window.api.dataApi.request({ id: 'mp59-clean-group', method: 'DELETE', path: `/groups/${id}` }),
        groupId
      )
    await page.evaluate(
      (id) => window.api.dataApi.request({ id: 'mp59-clean-provider', method: 'DELETE', path: `/providers/${id}` }),
      providerId
    )
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})

test(...caseDefinition('MP-60'), async ({ app, mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const filePath = app.fixturesPath('documents/sample-chinese.md')
  await attachScreenshot('MP-60 application before file import')
  await test.step('Verify the required Chinese Markdown fixture is readable', async () => {
    await access(filePath, constants.R_OK)
  })

  await ensureEmbeddingProvider(app, page)
  await closeSettings(page)
  await selectSidebarApp(page, 'Knowledge Base')
  await page.getByRole('button', { name: /^(Create|New) Knowledge Base$/ }).click()
  const dialog = page.getByRole('dialog', { name: 'New Knowledge Base' })
  await dialog
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill(app.resourceName(`File processing ${Date.now()}`))
  await dialog.getByRole('button', { name: 'Embedding Model', exact: true }).click()
  await selectVisibleModel(page, app.config.customEmbeddingProvider.model)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 120_000 })

  const observation = await page.evaluateHandle(() => {
    const entries: Array<{ status: string; text: string; elapsedMs: number }> = []
    const started = performance.now()
    const record = () => {
      const row = Array.from(document.querySelectorAll('[role="row"]')).find((element) =>
        element.textContent?.includes('sample-chinese.md')
      )
      if (!row || !row.getBoundingClientRect().height) return
      const text = row.textContent ?? ''
      const status = text.match(/Reading|Chunking|Embedding|Ready|Error/)?.[0]
      if (status && entries.at(-1)?.text !== text)
        entries.push({ status, text, elapsedMs: performance.now() - started })
    }
    const observer = new MutationObserver(record)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return { entries, stop: () => observer.disconnect() }
  })
  const started = Date.now()
  try {
    await test.step('Import sample-chinese.md through Add Data Source → File', async () => {
      const add = page.getByRole('button', { name: 'Add Data Source', exact: true })
      if (await add.isVisible()) {
        await add.click()
        await page.getByRole('menuitem', { name: 'File', exact: true }).click()
      } else {
        await page.getByRole('button', { name: 'File', exact: true }).click()
      }
      chooseNativeFile(app.record.platform, { ...app.paths, fixtures: dirname(filePath) }, filePath)
    })
    const row = page.getByRole('row').filter({ hasText: 'sample-chinese.md' })
    await expect(row).toBeVisible()
    await expect
      .poll(() => observation.evaluate(({ entries }) => entries.at(-1)?.status), { timeout: 180_000 })
      .toMatch(/Ready|Error/)
    const processingMs = Date.now() - started
    const entries = await observation.evaluate(({ entries }) => entries)
    await attachScreenshot('MP-60 file processing result')
    if (entries.at(-1)?.status === 'Error') {
      const error = row.getByText('Error', { exact: true })
      await expect(error).toBeVisible()
      await error.hover()
      const reason = page.getByRole('tooltip')
      await expect(reason).toBeVisible()
      await expect(reason).not.toHaveText('')
      throw new Error(`File processing failed: ${await reason.innerText()}`)
    }
    const statuses = entries
      .map(({ status }) => status)
      .filter((status, index, all) => index === 0 || status !== all[index - 1])
    expect(statuses, 'Every processing stage must be visible in order').toEqual([
      'Reading',
      'Chunking',
      'Embedding',
      'Ready'
    ])
    expect(
      entries.some(({ status, text }) => status === 'Embedding' && /\d+%/.test(text)),
      'Embedding progress must be visible'
    ).toBe(true)
    await expect(row.getByText('Ready', { exact: true })).toBeVisible()

    const menuMode = await page.evaluate(() => window.api.preference.get('menu.presentation_mode'))
    try {
      await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
      await row.click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'View Chunks', exact: true }).click()
      const chunks = page.getByText(/^[1-9]\d* chunks$/)
      await expect(chunks).toBeVisible()
      await attachScreenshot('MP-60 indexed chunks')
      await testInfo.attach('MP-60 processing duration', {
        body: JSON.stringify(
          { processingMs, chunks: await chunks.innerText(), provider: 'configured embedding provider', entries },
          null,
          2
        ),
        contentType: 'application/json'
      })
    } finally {
      await page.evaluate((menuMode) => window.api.preference.set('menu.presentation_mode', menuMode), menuMode)
    }
  } finally {
    await observation.evaluate(({ stop }) => stop())
    await testInfo.attach('MP-60 processing timeline', {
      body: JSON.stringify(
        { totalMs: Date.now() - started, entries: await observation.evaluate(({ entries }) => entries) },
        null,
        2
      ),
      contentType: 'application/json'
    })
    await observation.dispose()
  }
})

test(...caseDefinition('MP-61'), async ({ app, mainWindow: page }, testInfo) => {
  const documents = app.fixturesPath('documents')
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await selectSidebarApp(page, 'Knowledge Base')
  await screenshot('MP-61 knowledge base preconditions')
  await access(documents)

  const supportedExtensions = new Set([
    '.txt',
    '.markdown',
    '.md',
    '.mdx',
    '.pdf',
    '.html',
    '.htm',
    '.xlsx',
    '.xls',
    '.docx',
    '.csv',
    '.doc',
    '.pptx',
    '.ppt',
    '.epub',
    '.draftsexport'
  ])
  const files: string[] = []
  const scan = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await scan(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await scan(documents)
  const supported = files.filter((path) => supportedExtensions.has(extname(path).toLowerCase()))
  const skippedCount = files.length - supported.length
  expect(supported.length, 'Documents must contain supported files').toBeGreaterThan(0)
  expect(skippedCount, 'Documents must include an unsupported file to verify the warning').toBeGreaterThan(0)

  // BM25 needs no external model; only the base precondition is seeded, all imports use the UI.
  const baseResult = (await page.evaluate(
    (name) => window.api.ipcApi.request('knowledge.create_base', { base: { name } }),
    app.resourceName(`Directory import ${Date.now()}`)
  )) as IpcResult<KnowledgeBase>
  if (!baseResult.ok) throw new Error(baseResult.error.message)
  const base = KnowledgeBaseSchema.parse(baseResult.data)
  const list = async (groupId: string | null): Promise<KnowledgeItem[]> => {
    const items: KnowledgeItem[] = []
    let cursor: string | undefined
    do {
      const response = await page.evaluate(
        ({ baseId, groupId, cursor }) =>
          window.api.dataApi.request({
            id: 'mp61-items',
            method: 'GET',
            path: `/knowledge-bases/${baseId}/items`,
            params: { groupId, cursor, limit: 100 }
          }),
        { baseId: base.id, groupId, cursor }
      )
      expect(response.status).toBe(200)
      const data = response.data as KnowledgeItemListResponse
      items.push(...data.items)
      cursor = data.nextCursor
    } while (cursor)
    return items
  }
  const importFolder = async (path: string) => {
    await page.getByRole('button', { name: 'Add Data Source', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Folder', exact: true }).click()
    chooseNativeFile(app.record.platform, { ...app.paths, fixtures: dirname(path) }, path)
  }
  try {
    await page.reload()
    await selectSidebarApp(page, 'Knowledge Base')
    await page.locator('[data-ui="knowledge.navigation"]').getByText(base.name, { exact: true }).click()
    await importFolder(documents)
    await expect
      .soft(page.getByText(`Skipped ${skippedCount} unsupported file(s)`, { exact: true }))
      .toBeVisible({ timeout: 5_000 })
    await expect.poll(async () => (await list(null)).length).toBe(1)
    const [directory] = await list(null)
    expect(directory.type).toBe('directory')
    expect(directory.data.source).toBe(documents)
    const row = page.getByRole('row', { name: `Open ${basename(documents)}`, exact: true })
    await expect(row.getByRole('gridcell').nth(2)).toHaveText('Folders')
    await screenshot('MP-61 imported directory and type')
    await row.click()

    const importedFiles: KnowledgeItem[] = []
    const checkChildren = async (parent: KnowledgeItem): Promise<void> => {
      await expect.poll(async () => (await list(parent.id)).length, { timeout: 60_000 }).toBeGreaterThan(0)
      for (const child of await list(parent.id)) {
        expect(child.groupId).toBe(parent.id)
        const childRow = page.getByRole('row', { name: `Open ${basename(child.data.source)}`, exact: true })
        await expect(childRow).toBeVisible()
        await expect(childRow.locator('[title]').first()).toHaveAttribute('title', child.data.source)
        if (child.type === 'directory') {
          await childRow.click()
          await checkChildren(child)
          await page.getByRole('button', { name: 'Back', exact: true }).click()
        } else {
          expect(child.type).toBe('file')
          importedFiles.push(child)
        }
      }
    }
    await checkChildren(directory)
    expect(importedFiles.map((item) => item.data.source).sort()).toEqual([...supported].sort())
    await screenshot('MP-61 supported children and paths')
    await page.getByRole('button', { name: 'Back', exact: true }).click()

    const emptyDirectory = testInfo.outputPath('mp61-empty-directory')
    await mkdir(emptyDirectory)
    await importFolder(emptyDirectory)
    const emptyRow = page.getByRole('row', { name: `Open ${basename(emptyDirectory)}`, exact: true })
    await expect(emptyRow.getByRole('gridcell').nth(2)).toHaveText('Folders')
    await expect.poll(async () => (await list(null)).length).toBe(2)
    const emptyItem = (await list(null)).find((item) => item.data.source === emptyDirectory)
    expect(emptyItem?.type).toBe('directory')
    await emptyRow.click()
    await expect(page.getByText('This folder is empty', { exact: true })).toBeVisible()
    expect(await list(emptyItem!.id)).toEqual([])
    await screenshot('MP-61 empty directory message')
  } finally {
    await page.evaluate((baseId) => window.api.ipcApi.request('knowledge.delete_base', { baseId }), base.id)
  }
})

test(...caseDefinition('MP-62'), async ({ app, mainWindow: page }, testInfo) => {
  const name = app.resourceName(`URL sources ${Date.now()}`)
  const articleUrl = 'https://www.w3.org/Provider/Style/URI'
  const unreachableUrl = 'https://mp62-unreachable.invalid/article'
  const articleText = 'There are no reasons at all in theory for people to change URIs'
  // BM25 uses real fetching, chunking and indexing without an external embedding account or mocks.
  const created = (await page.evaluate(
    (name) => window.api.ipcApi.request('knowledge.create_base', { base: { name, chunkSize: 256, chunkOverlap: 20 } }),
    name
  )) as { ok: boolean; data: unknown }
  expect(created.ok).toBe(true)
  const base = KnowledgeBaseSchema.parse(created.data)
  const attachScreenshot = async (label: string) => {
    const path = testInfo.outputPath(`${label}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(label, { path, contentType: 'image/png' })
  }
  const readItems = async () => {
    const result = await page.evaluate(
      (id) =>
        window.api.dataApi.request({
          id: 'mp62-items',
          method: 'GET',
          path: `/knowledge-bases/${id}/items`
        }),
      base.id
    )
    expect(result.status, JSON.stringify(result.error)).toBe(200)
    return (result.data as KnowledgeItemListResponse).items
  }
  const openUrlDialog = async () => {
    await page.getByRole('button', { name: 'Add Data Source', exact: true }).click()
    await page.getByRole('menuitem', { name: 'URL', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Data Source', exact: true })
    await expect(dialog).toBeVisible()
    return dialog
  }

  try {
    await page.reload()
    await selectSidebarApp(page, 'Knowledge Base')
    await page.locator('[data-ui~="knowledge.navigation"]').getByText(name, { exact: true }).click()

    await test.step('Fetch a public article and verify indexed chunks reach Ready', async () => {
      const dialog = await openUrlDialog()
      await dialog.getByPlaceholder('https://example.com', { exact: true }).fill(articleUrl)
      await attachScreenshot('MP-62 public article URL before submission')
      await dialog.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect
        .poll(async () => (await readItems()).find((item) => item.data.source === articleUrl)?.status, {
          timeout: 120_000,
          message: 'The public article must finish fetching and indexing'
        })
        .toBe('completed')
      const item = (await readItems()).find((item) => item.data.source === articleUrl)!
      expect(item.type).toBe('url')
      expect(item.error).toBeNull()
      expect(item.data).toHaveProperty('relativePath', expect.stringMatching(/\S/))
      const chunkResult = (await page.evaluate(
        ({ baseId, itemId }) => window.api.ipcApi.request('knowledge.list_item_chunks', { baseId, itemId }),
        { baseId: base.id, itemId: item.id }
      )) as { ok: boolean; data: unknown }
      expect(chunkResult.ok).toBe(true)
      const chunks = KnowledgeItemChunkSchema.array().parse(chunkResult.data)
      expect(chunks.length, 'The article must be split into multiple persisted chunks').toBeGreaterThan(1)
      expect(chunks.map((chunk) => chunk.content).join('\n')).toContain(articleText)
      await expect(page.getByRole('row').filter({ has: page.locator(`[title="${articleUrl}"]`) })).toContainText(
        'Ready'
      )
      await attachScreenshot('MP-62 fetched article ready after chunking')
    })

    await test.step('Preview the captured article body inside the application', async () => {
      const row = page.getByRole('row').filter({ has: page.locator(`[title="${articleUrl}"]`) })
      await row.getByRole('button', { name: 'More', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Preview Source', exact: true }).click()
      await expect(page.getByText(articleText, { exact: false })).toBeVisible({ timeout: 30_000 })
      await attachScreenshot('MP-62 article original body preview')
      await page.getByRole('button', { name: 'Back', exact: true }).click()
    })

    await test.step('An unreachable URL terminates with Error and an actionable failure reason', async () => {
      const dialog = await openUrlDialog()
      await dialog.getByPlaceholder('https://example.com', { exact: true }).fill(unreachableUrl)
      await dialog.getByRole('button', { name: 'Add', exact: true }).click()
      await expect(dialog).toBeHidden()
      await expect
        .poll(async () => (await readItems()).find((item) => item.data.source === unreachableUrl)?.status, {
          timeout: 90_000,
          message: 'An unreachable URL must terminate rather than stay in processing'
        })
        .toBe('failed')
      const item = (await readItems()).find((item) => item.data.source === unreachableUrl)!
      expect(item.error).toEqual(expect.stringMatching(/\S/))
      const row = page.getByRole('row').filter({ has: page.locator(`[title="${unreachableUrl}"]`) })
      await expect(row.getByText('Error', { exact: true })).toBeVisible()
      await row.getByText('Error', { exact: true }).hover()
      await expect(page.getByRole('tooltip')).toContainText(item.error!)
      await attachScreenshot('MP-62 unreachable article terminal error and reason')
    })

    await test.step('Reject malformed URL before it becomes a data source', async () => {
      const dialog = await openUrlDialog()
      await dialog.getByPlaceholder('https://example.com', { exact: true }).fill('not a valid URL')
      const submit = dialog.getByRole('button', { name: 'Add', exact: true })
      if (await submit.isEnabled()) {
        await submit.click()
        await expect.soft(dialog, 'Invalid URL must keep the input dialog open').toBeVisible({ timeout: 5_000 })
        await expect
          .soft(dialog.getByRole('alert'), 'Invalid URL must show validation feedback')
          .toBeVisible({ timeout: 5_000 })
      }
      expect
        .soft(
          (await readItems()).map((item) => item.data.source),
          'Malformed URL must never be saved'
        )
        .toEqual(expect.arrayContaining([articleUrl, unreachableUrl]))
      expect.soft((await readItems()).length, 'Only the two syntactically valid URLs may be saved').toBe(2)
      await attachScreenshot('MP-62 malformed URL validation result')
    })
  } finally {
    await page.evaluate((baseId) => window.api.ipcApi.request('knowledge.delete_base', { baseId }), base.id)
  }
})

test(...caseDefinition('MP-63'), async ({ app, mainWindow }, testInfo) => {
  await knowledgeNotes(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-64'), async ({ app, mainWindow }, testInfo) => {
  await knowledgeSourceConflicts(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-65'), async ({ app, mainWindow }, testInfo) => {
  await knowledgeSourceOperations(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-66'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const name = app.resourceName(`Retrieval ${Date.now()}`)
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await ensureEmbeddingProvider(app, page)
  await closeSettings(page)
  await selectSidebarApp(page, 'Knowledge Base')
  await page.getByRole('button', { name: /^(Create|New) Knowledge Base$/ }).click()
  const create = page.getByRole('dialog', { name: 'New Knowledge Base' })
  await create.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  await create.getByRole('button', { name: 'Embedding Model', exact: true }).click()
  await selectVisibleModel(page, app.config.customEmbeddingProvider.model)
  await create.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(create).toBeHidden({ timeout: 120_000 })
  const bases = await page.evaluate(() =>
    window.api.dataApi.request({
      id: 'mp66-bases',
      method: 'GET',
      path: '/knowledge-bases',
      params: { limit: 100 }
    })
  )
  expect(bases.status).toBe(200)
  const base = (bases.data as { items: KnowledgeBase[] }).items.find((base) => base.name === name)
  expect(base).toBeDefined()
  const baseId = base!.id
  await page.evaluate(
    ({ baseId, path }) =>
      window.api.ipcApi.request('knowledge.add_items', {
        baseId,
        items: [{ type: 'file', data: { path, source: 'mp66-ground-truth.md' } }]
      }),
    { baseId, path: resolve('tests/e2e/regression/mp66-ground-truth.md') }
  )
  const readItems = async () => {
    const result = await page.evaluate(
      (baseId) =>
        window.api.dataApi.request({
          id: 'mp66-items',
          method: 'GET',
          path: `/knowledge-bases/${baseId}/items`
        }),
      baseId
    )
    expect(result.status).toBe(200)
    return (result.data as { items: KnowledgeItem[] }).items
  }
  await expect
    .poll(async () => (await readItems()).map((item) => item.status), { timeout: 180_000 })
    .toEqual(['completed'])
  const itemId = (await readItems())[0].id
  const chunkResult = (await page.evaluate(
    ({ baseId, itemId }) => window.api.ipcApi.request('knowledge.list_item_chunks', { baseId, itemId }),
    { baseId, itemId }
  )) as IpcResult<KnowledgeItemChunk[]>
  if (!chunkResult.ok) throw new Error(JSON.stringify(chunkResult.error))
  const chunks = chunkResult.data
  expect(chunks.length, 'The Top K test needs more than three indexed chunks').toBeGreaterThan(3)
  const readBase = async () => {
    const result = await page.evaluate(
      (baseId) =>
        window.api.dataApi.request({
          id: 'mp66-base',
          method: 'GET',
          path: `/knowledge-bases/${baseId}`
        }),
      baseId
    )
    expect(result.status).toBe(200)
    return result.data as KnowledgeBase
  }
  const openSettings = async () => {
    await selectSidebarApp(page, 'Knowledge Base')
    await page.locator('[data-ui~="knowledge.navigation"]').getByText(name, { exact: true }).click()
    await page.getByRole('button', { name: 'Knowledge Base Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Advanced Settings', exact: true }).click()
  }
  // Chunk fields currently lack accessible labels; scope each input by its visible field label.
  const field = (label: string) =>
    page
      .locator('div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .filter({ has: page.getByRole('textbox') })
      .last()
      .getByRole('textbox')
  await openSettings()
  const topK = page.getByRole('slider').first()
  await topK.focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(topK).toHaveAttribute('aria-valuenow', '3')
  await field('Chunk Size').fill('500')
  await field('Overlap Size').fill('50')
  await expect(page.getByText('Chunking changes only apply to newly added content', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(readBase).toMatchObject({ documentCount: 3, chunkSize: 500, chunkOverlap: 50 })
  await attachScreenshot('MP-66 saved retrieval and chunking warning')
  await field('Overlap Size').fill('501')
  await expect(page.getByText('Chunk overlap must be smaller than chunk size', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  expect(await readBase()).toMatchObject({ documentCount: 3, chunkSize: 500, chunkOverlap: 50 })
  await attachScreenshot('MP-66 invalid overlap rejected')

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  expect(await readBase()).toMatchObject({ documentCount: 3, chunkSize: 500, chunkOverlap: 50 })
  await openSettings()
  await expect(page.getByRole('slider').first()).toHaveAttribute('aria-valuenow', '3')
  await expect(field('Chunk Size')).toHaveValue('500')
  await expect(field('Overlap Size')).toHaveValue('50')
  await page.keyboard.press('Escape')
  const hitResult = (await page.evaluate(
    (baseId) => window.api.ipcApi.request('knowledge.search', { baseId, query: '内部代号是什么' }),
    baseId
  )) as IpcResult<KnowledgeSearchResult[]>
  if (!hitResult.ok) throw new Error(JSON.stringify(hitResult.error))
  const hits = hitResult.data
  expect(hits.length).toBeGreaterThan(0)
  expect(hits.length).toBeLessThanOrEqual(3)
  expect(hits.some((hit) => hit.pageContent.includes('canary-seven'))).toBe(true)
  expect(hits.every((hit) => hit.itemId === itemId)).toBe(true)
  await testInfo.attach('MP-66 real retrieval results', {
    body: JSON.stringify(hits, null, 2),
    contentType: 'application/json'
  })
  await ensureCustomAssistant(app, page)
  await page.getByRole('button', { name: `Edit Assistant: ${customAssistantName(app)}`, exact: true }).click()
  await page.getByRole('tab', { name: 'Knowledge', exact: true }).click()
  await page.getByRole('button', { name: 'Add knowledge base', exact: true }).click()
  await page.getByText(name, { exact: true }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Input Quick Panel', exact: true }).click()
  const quickPanel = page.getByTestId('quick-panel')
  await quickPanel.getByText('Knowledge Base', { exact: true }).click()
  await quickPanel.getByText(name, { exact: true }).click()
  await page.keyboard.press('Escape')
  const messageId = await sendChatMarker(page, '内部代号是什么？请引用来源文件。', 'canary-seven', false)
  const response = page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]`)
  await expect(response.getByText(/\d+ citations?/i)).toBeVisible()
  await expect(response).toContainText('mp66-ground-truth.md')
  await response.getByRole('button', { name: /\d+ citations?/i }).click()
  const references = page.getByRole('dialog', { name: 'References', exact: true })
  await expect(references.getByText('mp66-ground-truth.md', { exact: true })).toBeVisible()
  await expect(references).toContainText('canary-seven')
  await attachScreenshot('MP-66 real model answer with source citation')
})

test(...caseDefinition('MP-67'), async ({ app, mainWindow }, testInfo) => {
  await renameMoveDeleteKnowledge(app, mainWindow, testInfo)
})
