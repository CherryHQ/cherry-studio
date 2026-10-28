import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { KnowledgeBase, KnowledgeItem, KnowledgeSearchResult } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import type { IpcResult } from '@shared/ipc/errors/IpcError'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { dismissOnboarding, selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function renameMoveDeleteKnowledge(
  app: RegressionApp,
  initialPage: Page,
  testInfo: TestInfo
): Promise<void> {
  let page = initialPage
  const suffix = Date.now()
  const providerId = `mp67-${suffix}`
  const originalName = app.resourceName(`Lifecycle ${suffix}`)
  const renamedName = `${originalName} renamed`
  const groupNames = [app.resourceName(`Source ${suffix}`), app.resourceName(`Destination ${suffix}`)]
  const groupIds: string[] = []
  let baseId: string | undefined
  const marker = `MP67 vector cleanup orchid ${suffix}`
  const menuMode = await page.evaluate(() => window.api.preference.get('menu.presentation_mode'))
  // Deterministic vectors exercise the real index lifecycle; this case makes no semantic-recall claim.
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock embedding vectors; real Electron UI, IPC and knowledge index lifecycle. Does not validate embedding quality.'
  })
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/embeddings') {
      response.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const inputs = Array.isArray(body.input) ? body.input : [body.input]
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        object: 'list',
        model: 'mp67-embedding',
        data: inputs.map((_: unknown, index: number) => ({ object: 'embedding', index, embedding: [1, 0, 0] })),
        usage: { prompt_tokens: inputs.length, total_tokens: inputs.length }
      })
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Embedding fixture has no port')
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const readBase = () =>
    page.evaluate(
      (baseId) =>
        window.api.dataApi.request({
          id: 'mp67-read-base',
          method: 'GET',
          path: `/knowledge-bases/${baseId}`
        }),
      baseId!
    )
  const readItems = () =>
    page.evaluate(
      (baseId) =>
        window.api.dataApi.request({
          id: 'mp67-read-items',
          method: 'GET',
          path: `/knowledge-bases/${baseId}/items`
        }),
      baseId!
    )
  const navigation = () => page.locator('[data-ui~="knowledge.navigation"]')
  const baseButton = (name = renamedName) => navigation().getByRole('button', { name, exact: true })
  const expandGroup = async (name: string) => {
    const button = navigation().getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    if ((await button.getAttribute('aria-expanded')) === 'false') await button.click()
  }
  const search = async () =>
    page.evaluate(({ baseId, marker }) => window.api.ipcApi.request('knowledge.search', { baseId, query: marker }), {
      baseId: baseId!,
      marker
    }) as Promise<IpcResult<KnowledgeSearchResult[]>>

  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    const seeded = await page.evaluate(
      async ({ providerId, baseUrl }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp67-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP67 embedding fixture',
            endpointConfigs: { 'openai-embeddings': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp67-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const models = await window.api.dataApi.request({
          id: 'mp67-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId: 'mp67-embedding', endpointTypes: ['openai-embeddings'] }]
        })
        return [provider.status, enabled.status, models.status]
      },
      { providerId, baseUrl: `http://127.0.0.1:${address.port}/v1` }
    )
    expect(seeded).toEqual([201, 200, 201])
    for (const name of groupNames) {
      const group = await page.evaluate(
        (name) =>
          window.api.dataApi.request({
            id: 'mp67-create-group',
            method: 'POST',
            path: '/groups',
            body: { name, entityType: 'knowledge' }
          }),
        name
      )
      expect(group.status).toBe(201)
      groupIds.push((group.data as { id: string }).id)
    }
    const created = (await page.evaluate(
      ({ name, groupId, embeddingModelId }) =>
        window.api.ipcApi.request('knowledge.create_base', {
          base: { name, groupId, embeddingModelId, dimensions: 3, threshold: 0 }
        }),
      { name: originalName, groupId: groupIds[0], embeddingModelId: createUniqueModelId(providerId, 'mp67-embedding') }
    )) as IpcResult<KnowledgeBase>
    expect(created.ok, JSON.stringify(created)).toBe(true)
    if (!created.ok) throw new Error('Knowledge base creation failed')
    baseId = created.data.id
    const added = await page.evaluate(
      ({ baseId, marker }) =>
        window.api.ipcApi.request('knowledge.add_items', {
          baseId,
          items: [{ type: 'note', data: { source: 'MP67 cleanup fixture', content: marker } }]
        }),
      { baseId, marker }
    )
    expect((added as IpcResult<unknown>).ok).toBe(true)
    await expect
      .poll(
        async () => {
          const result = await readItems()
          expect(result.status).toBe(200)
          return (result.data as { items: KnowledgeItem[] }).items.map((item) => item.status)
        },
        { timeout: 120_000 }
      )
      .toEqual(['completed'])
    const items = (await readItems()).data as { items: KnowledgeItem[] }
    const itemId = items.items[0].id
    const indexed = await search()
    expect(indexed.ok, JSON.stringify(indexed)).toBe(true)
    if (!indexed.ok) throw new Error('Indexed fixture cannot be retrieved')
    expect(indexed.data).toEqual(expect.arrayContaining([expect.objectContaining({ pageContent: marker, itemId })]))

    await page.reload()
    await selectSidebarApp(page, 'Knowledge Base')
    await expandGroup(groupNames[0])
    await baseButton(originalName).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const rename = page.getByRole('dialog', { name: 'Rename Knowledge Base', exact: true })
    await rename.getByRole('textbox', { name: 'Name', exact: true }).fill(renamedName)
    await rename.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(rename).toBeHidden()
    await expect(baseButton()).toBeVisible()
    await expect(baseButton(originalName)).toHaveCount(0)
    await expect.poll(async () => (await readBase()).data).toMatchObject({ name: renamedName, groupId: groupIds[0] })

    await baseButton().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move to', exact: true }).hover()
    await page.getByRole('menuitem', { name: groupNames[1], exact: true }).click()
    await expandGroup(groupNames[1])
    await expect(
      navigation()
        .getByRole('region', { name: groupNames[1], exact: true })
        .getByRole('button', { name: renamedName, exact: true })
    ).toBeVisible()
    await expect.poll(async () => (await readBase()).data).toMatchObject({ name: renamedName, groupId: groupIds[1] })
    await attachScreenshot('MP-67 renamed and moved')

    page = await app.restart()
    await dismissOnboarding(page)
    await selectSidebarApp(page, 'Knowledge Base')
    await expandGroup(groupNames[1])
    await expect(
      navigation()
        .getByRole('region', { name: groupNames[1], exact: true })
        .getByRole('button', { name: renamedName, exact: true })
    ).toBeVisible()
    expect((await readBase()).data).toMatchObject({ name: renamedName, groupId: groupIds[1] })
    await expect(baseButton(originalName)).toHaveCount(0)
    await attachScreenshot('MP-67 rename and move survive restart')

    await navigation().getByRole('button', { name: groupNames[1], exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete Group', exact: true }).click()
    const deleteGroup = page.getByRole('dialog', { name: 'Delete Group?', exact: true })
    await expect(deleteGroup).toContainText(
      'Knowledge bases in this group will be moved to the default group after deletion.'
    )
    expect((await readBase()).data).toMatchObject({ groupId: groupIds[1] })
    await attachScreenshot('MP-67 group deletion warning')
    await deleteGroup.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(deleteGroup).toBeHidden()
    await expect(navigation().getByRole('button', { name: groupNames[1], exact: true })).toHaveCount(0)
    await expandGroup('Default')
    await expect(
      navigation()
        .getByRole('region', { name: 'Default', exact: true })
        .getByRole('button', { name: renamedName, exact: true })
    ).toBeVisible()
    await expect.poll(async () => (await readBase()).data).toMatchObject({ name: renamedName, groupId: null })
    await expect(navigation().getByRole('button', { name: groupNames[0], exact: true })).toBeVisible()
    const retained = await search()
    expect(retained.ok).toBe(true)
    if (!retained.ok) throw new Error('Group deletion made the base unsearchable')
    expect(retained.data).toEqual(expect.arrayContaining([expect.objectContaining({ pageContent: marker, itemId })]))

    const requestDeletion = async () => {
      await baseButton().click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Delete Knowledge Base', exact: true }).click()
    }
    await requestDeletion()
    const deleteBase = page.getByRole('dialog', { name: 'Delete Knowledge Base?', exact: true })
    await expect(deleteBase).toContainText('This knowledge base cannot be recovered after deletion.')
    expect((await readBase()).status).toBe(200)
    await deleteBase.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(deleteBase).toBeHidden()
    await expect(baseButton()).toBeVisible()
    expect((await readBase()).status).toBe(200)
    await requestDeletion()
    await expect(deleteBase).toBeVisible()
    await attachScreenshot('MP-67 knowledge deletion confirmation')
    await deleteBase.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(deleteBase).toBeHidden()
    await expect(baseButton()).toHaveCount(0)
    await expect.poll(async () => (await readBase()).status).toBe(404)
    const removedItem = await page.evaluate(
      (itemId) =>
        window.api.dataApi.request({ id: 'mp67-removed-item', method: 'GET', path: `/knowledge-items/${itemId}` }),
      itemId
    )
    expect(removedItem.status).toBe(404)
    const deletedSearch = await search()
    expect(deletedSearch.ok, 'Deleted vector data must no longer be searchable through the old base ID').toBe(false)
    if (!deletedSearch.ok) expect(JSON.stringify(deletedSearch.error)).toMatch(/NOT_FOUND|not found|does not exist/i)
    const chunksAfterDelete = await page.evaluate(
      ({ baseId, itemId }) => window.api.ipcApi.request('knowledge.list_item_chunks', { baseId, itemId }),
      { baseId, itemId }
    )
    expect((chunksAfterDelete as IpcResult<unknown>).ok).toBe(false)
    await attachScreenshot('MP-67 base removed from list and index inaccessible')
  } finally {
    page = await app.mainWindow()
    await page.evaluate(
      async ({ baseId, providerId, groupIds, menuMode }) => {
        await window.api.preference.set('menu.presentation_mode', menuMode)
        if (baseId) await window.api.ipcApi.request('knowledge.delete_base', { baseId })
        for (const id of groupIds)
          await window.api.dataApi.request({ id: 'mp67-clean-group', method: 'DELETE', path: `/groups/${id}` })
        await window.api.dataApi.request({
          id: 'mp67-clean-provider',
          method: 'DELETE',
          path: `/providers/${providerId}`
        })
      },
      { baseId, providerId, groupIds, menuMode }
    )
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}
