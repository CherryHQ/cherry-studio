import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { expect, type Page, type TestInfo } from '@playwright/test'

import type { KnowledgeItemListResponse } from '@shared/data/api/schemas/knowledges'
import { KnowledgeBaseSchema, KnowledgeItemChunkSchema } from '@shared/data/types/knowledge'

import { getSensitiveConfigValues } from '../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { chooseNativeFile } from '../../../scripts/e2e/regression/systemAutomation'
import { selectSidebarApp } from './navigation'
import type { RegressionApp } from './RegressionApp'

export async function knowledgeSourceConflicts(app: RegressionApp, page: Page, testInfo: TestInfo): Promise<void> {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const filename = 'sample-chinese.md'
  const path = testInfo.outputPath('documents', filename)
  const original = '# 中文知识库样例\n\nMP64ORIGINAL：这是首次导入的中文数据源，保留全部时两份文件都应能打开。'
  const replacement = '# 中文知识库样例\n\nMP64REPLACEMENT：这是替换后的中文数据源，旧索引应被清除。'
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, original)
  const menuMode = await page.evaluate(() => window.api.preference.get('menu.presentation_mode'))
  let baseId: string | undefined

  try {
    await page.evaluate(() => window.api.preference.set('menu.presentation_mode', 'cherry'))
    // Exercise the real local reader and BM25 index without an external embedding provider.
    const created = await page.evaluate(
      (name) => window.api.ipcApi.request('knowledge.create_base', { base: { name } }),
      app.resourceName(`Source conflicts ${Date.now()}`)
    )
    expect(created).toMatchObject({ ok: true })
    const base = KnowledgeBaseSchema.parse((created as { data: unknown }).data)
    baseId = base.id
    const added = await page.evaluate(
      ({ baseId, path }) =>
        window.api.ipcApi.request('knowledge.add_items', {
          baseId,
          items: [{ type: 'file', data: { path, source: path } }]
        }),
      { baseId, path }
    )
    expect(added).toMatchObject({ ok: true })
    const readItems = async () => {
      const response = await page.evaluate(
        (baseId) =>
          window.api.dataApi.request({ id: 'MP-64-read', method: 'GET', path: `/knowledge-bases/${baseId}/items` }),
        base.id
      )
      expect(response.status).toBe(200)
      return response.data as KnowledgeItemListResponse
    }
    const ready = async (count: number) => {
      await expect
        .poll(async () => (await readItems()).items.map(({ status }) => status), { timeout: 120_000 })
        .toEqual(Array.from({ length: count }, () => 'completed'))
    }
    const chunks = async (itemId: string) => {
      const response = await page.evaluate(
        ({ baseId, itemId }) => window.api.ipcApi.request('knowledge.list_item_chunks', { baseId, itemId }),
        { baseId: base.id, itemId }
      )
      expect(response).toMatchObject({ ok: true })
      return KnowledgeItemChunkSchema.array().parse((response as { data: unknown }).data)
    }
    await ready(1)
    const initial = (await readItems()).items[0]
    expect(JSON.stringify(await chunks(initial.id))).toContain('MP64ORIGINAL')
    await page.reload()
    await selectSidebarApp(page, 'Knowledge Base')
    await page.locator('[data-ui~="knowledge.navigation"]').getByText(base.name, { exact: true }).click()
    const panel = page.locator('[data-ui~="knowledge.content"]')
    const grid = panel.getByRole('grid', { name: 'Data sources', exact: true })
    const rows = grid.getByRole('row').filter({ hasText: /sample-chinese/ })
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Ready')

    const conflict = page.getByRole('dialog', { name: 'Sources already exist', exact: true })
    const addDuplicate = async () => {
      await panel.getByRole('button', { name: 'Add Data Source', exact: true }).click()
      await page.getByRole('menuitem', { name: 'File', exact: true }).click()
      chooseNativeFile(app.record.platform, app.paths, path)
      await expect(conflict).toBeVisible()
      await expect(conflict).toContainText('1 of the sources you are adding have the same name as existing items.')
      await expect(conflict.getByText(filename, { exact: true })).toBeVisible()
    }

    await addDuplicate()
    expect((await readItems()).total).toBe(1)
    await screenshot('MP-64 same-name conflict and source count')
    await conflict.getByRole('button', { name: 'Keep All', exact: true }).click()
    await expect(conflict).toBeHidden()
    await ready(2)
    await expect(rows).toHaveCount(2)
    await screenshot('MP-64 both retained sources')
    expect
      .soft(await rows.getByText(filename, { exact: true }).count(), 'Keep All must show two same-name entries')
      .toBe(2)
    const retained = (await readItems()).items
    expect(retained.some(({ id }) => id === initial.id)).toBe(true)
    expect(new Set(retained.map(({ id }) => id)).size).toBe(2)
    for (let index = 0; index < 2; index += 1) {
      await rows.nth(index).click()
      await expect(panel.getByRole('region')).toContainText('MP64ORIGINAL')
      await screenshot(`MP-64 retained source ${index + 1} opens`)
      await panel.getByRole('button', { name: 'Back', exact: true }).click()
    }
    for (const item of retained) expect(JSON.stringify(await chunks(item.id))).toContain('MP64ORIGINAL')
    await writeFile(path, replacement)
    await addDuplicate()
    expect((await readItems()).total).toBe(2)
    await conflict.getByRole('button', { name: 'Replace', exact: true }).click()
    await expect(conflict).toBeHidden()
    await expect
      .poll(
        async () => {
          const items = (await readItems()).items
          return items.some((item) => !retained.some(({ id }) => id === item.id) && item.status === 'completed')
        },
        { timeout: 120_000 }
      )
      .toBe(true)
    await expect(rows.getByText('Ready', { exact: true })).toHaveCount((await readItems()).total)
    await screenshot('MP-64 sources after replacement')
    const after = await readItems()
    expect.soft(after.total, 'Replace must leave one source').toBe(1)
    await expect.soft(rows, 'Replace must leave one visible row').toHaveCount(1, { timeout: 2_000 })
    const current = after.items.find((item) => !retained.some(({ id }) => id === item.id))!
    expect(Date.parse(current.updatedAt)).toBeGreaterThan(
      Math.max(...retained.map((item) => Date.parse(item.updatedAt)))
    )
    expect(JSON.stringify(await chunks(current.id))).toContain('MP64REPLACEMENT')
    for (const item of retained) {
      expect
        .soft(
          after.items.some(({ id }) => id === item.id),
          'Old source must be replaced'
        )
        .toBe(false)
      expect.soft(await chunks(item.id), 'Old source index must be removed').toEqual([])
    }
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
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
