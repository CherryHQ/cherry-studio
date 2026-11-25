import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { KnowledgeItemListResponse } from '@shared/data/api/schemas/knowledges'
import { KnowledgeBaseSchema } from '@shared/data/types/knowledge'

import { captureMaskedScreenshot } from '../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from './fixtures/electron.fixture'

const EMPTY_TEXT_REASON =
  'No indexable text was extracted. Check the source, OCR, or document processing settings, then reindex.'

test('a failed knowledge item shows its failure reason in the row without hovering', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(300_000)
  const sourceDir = await mkdtemp(join(tmpdir(), 'kb-22396-'))
  const sourcePath = join(sourceDir, 'blank-scan.txt')
  await writeFile(sourcePath, ' \n\t\n   ')
  let baseId: string | undefined

  try {
    // Dismiss onboarding once, before seeding: the shell (and its sidebar) only renders after it.
    const shell = page.locator('[data-ui="app.content"]').first()
    const setUpLater = page.getByRole('button', { name: 'Set up later', exact: true })
    await expect(shell.or(setUpLater).first()).toBeVisible({ timeout: 120_000 })
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await shell.isVisible().catch(() => false)) break
      await setUpLater.click({ timeout: 60_000 }).catch(() => undefined)
      await page.waitForTimeout(1_000)
    }
    await expect(shell).toBeVisible({ timeout: 60_000 })

    const baseResponse = await page.evaluate(
      (name) =>
        window.api.ipcApi.request('knowledge.create_base', {
          base: { name, chunkSize: 128, chunkOverlap: 0 }
        }),
      `Failure reason ${Date.now()}`
    )
    expect(baseResponse).toMatchObject({ ok: true })
    const base = KnowledgeBaseSchema.parse((baseResponse as { data: unknown }).data)
    baseId = base.id

    const added = await page.evaluate(
      ({ baseId, sourcePath }) =>
        window.api.ipcApi.request('knowledge.add_items', {
          baseId,
          items: [{ type: 'file' as const, data: { path: sourcePath, source: sourcePath } }]
        }),
      { baseId, sourcePath }
    )
    expect(added, JSON.stringify(added)).toMatchObject({ ok: true })

    const readItems = async () => {
      const response = await page.evaluate(
        (baseId) =>
          window.api.dataApi.request({
            id: 'kb-22396-read-items',
            method: 'GET',
            path: `/knowledge-bases/${baseId}/items`
          }),
        baseId
      )
      expect(response.status).toBe(200)
      return response.data as KnowledgeItemListResponse
    }

    // The real index job runs against the real local reader/chunker: whitespace-only text yields
    // zero chunks, which must fail the item with the persisted error code (not a hardcoded sentence).
    await expect
      .poll(async () => (await readItems()).items.map((item) => item.status), { timeout: 120_000 })
      .toEqual(['failed'])
    const failedItem = (await readItems()).items[0]
    expect(failedItem.error).toBe('empty_indexable_text')

    // Persist the skip so the shell stays reachable if the renderer remounts.
    await page.evaluate(() => window.api.preference.set('app.onboarding.provider_setup.status', 'skipped'))
    const knowledgeNavButton = page.getByRole('button', { name: 'Knowledge Base', exact: true }).first()
    const launchpadButton = page.getByRole('button', { name: 'Launchpad', exact: true }).first()
    await expect(knowledgeNavButton.or(launchpadButton).first()).toBeVisible({ timeout: 120_000 })
    if (await knowledgeNavButton.isVisible().catch(() => false)) {
      await knowledgeNavButton.click({ noWaitAfter: true })
    } else {
      await launchpadButton.click()
      await page.getByRole('button', { name: 'Knowledge Base', exact: true }).last().click()
    }
    await page.locator('[data-ui~="knowledge.navigation"]').getByText(base.name, { exact: true }).click()
    const panel = page.locator('[data-ui~="knowledge.content"]')
    const grid = panel.getByRole('grid', { name: 'Data sources', exact: true })
    const row = grid.getByRole('row').filter({ hasText: basename(sourcePath) })
    await expect(row.getByText('Error', { exact: true })).toBeVisible()

    // The reason must be visible in the row itself, before any hover/focus, and localized.
    const reason = row.getByText(EMPTY_TEXT_REASON, { exact: true })
    await expect(reason).toBeVisible()
    const reasonBox = await reason.boundingBox()
    const rowBox = await row.boundingBox()
    expect(reasonBox).not.toBeNull()
    expect(rowBox).not.toBeNull()
    // Truncation guard: the rendered text must actually intersect the row's box (not clipped away).
    expect(reasonBox!.y).toBeGreaterThanOrEqual(rowBox!.y)
    expect(reasonBox!.y).toBeLessThan(rowBox!.y + rowBox!.height)

    const restScreenshot = testInfo.outputPath('knowledge-failed-row-resting.png')
    await writeFile(restScreenshot, await captureMaskedScreenshot(page, []))

    // The status badge keeps the complete reason as its accessible name, and the tooltip still
    // opens for the full text.
    const badge = row.getByLabel(EMPTY_TEXT_REASON)
    await expect(badge).toBeVisible()
    await badge.hover()
    await expect(page.getByRole('tooltip').filter({ hasText: EMPTY_TEXT_REASON })).toBeVisible()
    const hoverScreenshot = testInfo.outputPath('knowledge-failed-row-tooltip.png')
    await writeFile(hoverScreenshot, await captureMaskedScreenshot(page, []))

    await testInfo.attach('knowledge-failed-row-resting', { path: restScreenshot, contentType: 'image/png' })
    await testInfo.attach('knowledge-failed-row-tooltip', { path: hoverScreenshot, contentType: 'image/png' })
  } finally {
    if (baseId) {
      await page
        .evaluate((baseId) => window.api.ipcApi.request('knowledge.delete_base', { baseId }), baseId)
        .catch(() => {})
    }
    await rm(sourceDir, { recursive: true, force: true })
  }
})
