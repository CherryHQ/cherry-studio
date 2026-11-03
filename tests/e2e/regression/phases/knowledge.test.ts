import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import type { KnowledgeBaseListResponse } from '@shared/data/api/schemas/knowledges'
import { GroupSchema } from '@shared/data/types/group'
import { createUniqueModelId } from '@shared/data/types/model'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from '../fixture'
import { selectVisibleModel } from '../helpers/models'
import { dismissOnboarding, selectSidebarApp } from '../helpers/navigation'
import { renameMoveDeleteKnowledge } from '../scenarios/renameMoveDeleteKnowledge'

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
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock embedding vectors; real Electron UI, IPC and persisted knowledge data. Does not validate embedding quality.'
  })
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
      await selectVisibleModel(page, modelId, providerId)
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
      const deleted = await page.evaluate(
        (baseId) => window.api.ipcApi.request('knowledge.delete_base', { baseId }),
        base.id
      )
      expect(deleted).toMatchObject({ ok: true })
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

test(...caseDefinition('MP-67'), async ({ app, mainWindow }, testInfo) => {
  await renameMoveDeleteKnowledge(app, mainWindow, testInfo)
})
