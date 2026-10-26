import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { KnowledgeItemListResponse } from '@shared/data/api/schemas/knowledges'
import { KnowledgeBaseSchema, KnowledgeItemChunkSchema } from '@shared/data/types/knowledge'

import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { selectSidebarApp } from '../helpers/navigation'
import type { RegressionApp } from '../RegressionApp'

export async function knowledgeSourceOperations(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const paths = [testInfo.outputPath('MP-65-source-a.txt'), testInfo.outputPath('MP-65-source-b.txt')]
  const firstMarker = 'MP65_SOURCE_A_BEGIN'
  const lastMarker = 'MP65_SOURCE_A_END'
  const content = [
    firstMarker,
    ...Array.from({ length: 1500 }, (_, index) =>
      `MP65 section ${index}: Cherry Studio knowledge source operations preserve document provenance. `.repeat(6)
    ),
    lastMarker
  ].join('\n\n')
  await writeFile(paths[0], content)
  await writeFile(paths[1], 'MP65_SOURCE_B_BODY: The second ready source is selected for bulk deletion.')
  const menuMode = await page.evaluate(() => window.api.preference.get('menu.presentation_mode'))
  let baseId: string | undefined

  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    // BM25 uses the real local reader, chunker and index; no provider responses or status are mocked.
    const baseResponse = await page.evaluate(
      (name) =>
        window.api.ipcApi.request('knowledge.create_base', {
          base: { name, chunkSize: 128, chunkOverlap: 0 }
        }),
      app.resourceName(`Source operations ${Date.now()}`)
    )
    expect(baseResponse).toMatchObject({ ok: true })
    const base = KnowledgeBaseSchema.parse((baseResponse as { data: unknown }).data)
    baseId = base.id
    const added = await page.evaluate(
      ({ baseId, paths }) =>
        window.api.ipcApi.request('knowledge.add_items', {
          baseId,
          items: paths.map((path) => ({ type: 'file' as const, data: { path, source: path } }))
        }),
      { baseId, paths }
    )
    expect(added, JSON.stringify(added)).toMatchObject({ ok: true })
    const readItems = async () => {
      const response = await page.evaluate(
        (baseId) =>
          window.api.dataApi.request({
            id: 'MP-65-read-items',
            method: 'GET',
            path: `/knowledge-bases/${baseId}/items`
          }),
        base.id
      )
      expect(response.status).toBe(200)
      return response.data as KnowledgeItemListResponse
    }
    await expect
      .poll(async () => (await readItems()).items.map(({ status }) => status), {
        timeout: 120_000
      })
      .toEqual(['completed', 'completed'])
    await selectSidebarApp(page, 'Knowledge Base')
    await page.locator('[data-ui~="knowledge.navigation"]').getByText(base.name, { exact: true }).click()
    const panel = page.locator('[data-ui~="knowledge.content"]')
    const grid = panel.getByRole('grid', { name: 'Data sources', exact: true })
    const firstRow = grid.getByRole('row').filter({ hasText: basename(paths[0]) })
    const secondRow = grid.getByRole('row').filter({ hasText: basename(paths[1]) })
    await expect(firstRow.getByText('Ready', { exact: true })).toBeVisible()
    await expect(secondRow.getByText('Ready', { exact: true })).toBeVisible()
    const firstItem = (await readItems()).items.find((item) => item.data.source?.endsWith(basename(paths[0])))
    expect(firstItem).toBeDefined()

    const action = async (name: string) => {
      await firstRow.hover()
      await firstRow.getByRole('button', { name: 'More', exact: true }).click()
      await page.getByRole('menuitem', { name, exact: true }).click()
    }
    await action('View Chunks')
    await expect(panel.getByText(basename(paths[0]), { exact: true })).toBeVisible()
    await expect(panel.getByText(firstMarker, { exact: false })).toBeVisible()
    const chunksResponse = await page.evaluate(
      ({ baseId, itemId }) => window.api.ipcApi.request('knowledge.list_item_chunks', { baseId, itemId }),
      { baseId, itemId: firstItem!.id }
    )
    expect(chunksResponse).toMatchObject({ ok: true })
    const chunks = KnowledgeItemChunkSchema.array().parse((chunksResponse as { data: unknown }).data)
    expect(chunks.length).toBeGreaterThan(10)
    expect(
      chunks.every((chunk) => chunk.itemId === firstItem!.id && chunk.metadata.source.endsWith(basename(paths[0])))
    ).toBe(true)
    await expect(panel.getByText(`${chunks.length} chunks`, { exact: true })).toBeVisible()
    const scroller = panel.locator('.dynamic-virtual-list')
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeGreaterThan(0)
    await scroller.hover()
    await page.mouse.wheel(0, 1000000)
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect(panel.getByText(lastMarker, { exact: false })).toBeVisible()
    await screenshot('MP-65 chunks scrolled with source filename')
    await panel.getByRole('button', { name: 'Back', exact: true }).click()

    await action('Preview Source')
    const preview = panel.getByRole('region', { name: basename(paths[0]), exact: true })
    await expect(preview).toContainText(firstMarker)
    await expect(preview).toContainText('Cherry Studio knowledge source operations preserve document provenance.')
    await expect(preview).toContainText(lastMarker)
    await screenshot('MP-65 original document preview')
    await panel.getByRole('button', { name: 'Back', exact: true }).click()

    const previousUpdatedAt = firstItem!.updatedAt
    await action('Reindex')
    await expect(firstRow).toContainText(/Waiting|Reading|Processing|Chunking|Embedding/, { timeout: 15_000 })
    await screenshot('MP-65 reindex processing')
    await expect(firstRow.getByText('Ready', { exact: true })).toBeVisible({ timeout: 120_000 })
    const reindexed = (await readItems()).items.find(({ id }) => id === firstItem!.id)
    expect(reindexed?.status).toBe('completed')
    expect(reindexed?.updatedAt).not.toBe(previousUpdatedAt)
    await screenshot('MP-65 reindex ready')

    await firstRow.getByRole('checkbox', { name: 'Select row', exact: true }).check()
    await expect(panel.getByText('1 selected', { exact: true })).toBeVisible()
    await secondRow.getByRole('checkbox', { name: 'Select row', exact: true }).check()
    await expect(panel.getByText('2 selected', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Delete', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Delete Selected Data Sources?', exact: true })
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('Delete 2 selected data sources? This cannot be undone.')
    expect((await readItems()).total).toBe(2)
    await screenshot('MP-65 bulk delete confirmation and selection count')
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(panel.getByText('2 selected', { exact: true })).toBeVisible()
    await expect(firstRow).toBeVisible()
    await expect(secondRow).toBeVisible()
    await panel.getByRole('button', { name: 'Delete', exact: true }).click()
    await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(confirmation).toBeHidden()
    await expect(firstRow).toHaveCount(0)
    await expect(secondRow).toHaveCount(0)
    await expect(panel.getByText(/^[12] selected$/)).toHaveCount(0)
    await expect(panel.getByText('No data sources yet', { exact: true })).toBeVisible()
    await expect.poll(readItems).toMatchObject({ items: [], total: 0 })
    await screenshot('MP-65 deleted sources and cleared selection')
  } finally {
    await page.evaluate(
      async ({ baseId, menuMode }) => {
        if (baseId) await window.api.ipcApi.request('knowledge.delete_base', { baseId })
        await window.api.preference.set('menu.presentation_mode', menuMode)
      },
      { baseId, menuMode }
    )
  }
}
