import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'

import type { TranslateHistoryListResponse } from '../../../src/shared/data/api/schemas/translate'
import type { TranslateHistory } from '../../../src/shared/data/types/translate'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, provideApp, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const env: Record<string, string> = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile }
    delete env.ELECTRON_RENDERER_URL
    const app = await electron.launch({ args: ['.'], env, timeout: 60_000 })
    try {
      await provideApp(app)
    } finally {
      try {
        await app.close()
      } finally {
        await rm(profile, { recursive: true, force: true })
      }
    }
  }
})

test('translation history delete, archive, restore and clear persist across the UI and DataApi', async ({
  mainWindow: page
}, testInfo) => {
  const evidence = {
    profile: testInfo.outputPath('profile'),
    locale: 'en-US',
    seeded: [] as TranslateHistory[],
    api: [] as Array<{
      step: string
      archived: boolean
      status: number
      total: number
      items: Array<Pick<TranslateHistory, 'id' | 'sourceText' | 'star' | 'archived' | 'createdAt'>>
    }>
  }
  const confirmDialog = page.locator('[data-slot="dialog-content"]')
  const row = (source: string) => page.locator('[role="button"]').filter({ hasText: source }).first()
  const screenshot = async (name: string) => {
    await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
  }
  const list = async (step: string, archived = false) => {
    const result = await page.evaluate(async (isArchived) => {
      const response = await window.api.dataApi.request({
        id: crypto.randomUUID(),
        method: 'GET',
        path: '/translate/histories',
        params: { limit: 100, archived: isArchived }
      })
      const data = response.data as TranslateHistoryListResponse | undefined
      if (!data || !Array.isArray(data.items)) throw new Error(`List failed: ${JSON.stringify(response)}`)
      return {
        status: response.status,
        total: data.total,
        items: data.items.map(({ id, sourceText, star, archived, createdAt }) => ({
          id,
          sourceText,
          star,
          archived,
          createdAt
        }))
      }
    }, archived)
    evidence.api.push({ step, archived, ...result })
    expect(result.status).toBe(200)
    return result
  }
  const expectTotal = async (step: string, total: number, archived = false) => {
    await expect.poll(async () => (await list(step, archived)).total).toBe(total)
    return evidence.api[evidence.api.length - 1]
  }

  try {
    const later = page.getByRole('button', { name: /^(稍后设置|Set up later)$/ })
    if (await later.isVisible()) await later.click()
    await page.evaluate(async (version) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      await window.api.preference.set('app.privacy.policy_version', version)
    }, LATEST_PRIVACY_POLICY_VERSION)
    evidence.seeded = await page.evaluate(async () => {
      const created: TranslateHistory[] = []
      for (const suffix of ['alpha', 'beta', 'gamma', 'delta']) {
        const response = await window.api.dataApi.request({
          id: crypto.randomUUID(),
          method: 'POST',
          path: '/translate/histories',
          body: {
            sourceText: `probe source ${suffix}`,
            targetText: `probe target ${suffix}`,
            sourceLanguage: 'en-us',
            targetLanguage: 'zh-cn'
          }
        })
        const entity = response.data as TranslateHistory | undefined
        if (response.status !== 201 || !entity?.id) throw new Error(`Seed failed: ${JSON.stringify(response)}`)
        created.push(entity)
      }
      return created
    })
    const [alpha, beta, gamma, delta] = evidence.seeded
    await page.reload()
    const accept = page.getByRole('button', { name: /^(Accept and Continue|同意并继续)$/ })
    if (await accept.isVisible()) await accept.click()
    await selectSidebarApp(page, 'Translation')
    await page.getByRole('button', { name: 'Translation History' }).click()
    const archiveToggle = page.getByRole('button', { name: 'Show archived history' })
    await expect(archiveToggle).toHaveAttribute('aria-pressed', 'false')
    await expectTotal('initialActive', 4)
    await expectTotal('initialArchived', 0, true)

    await row(alpha.sourceText).hover()
    await expect(row(alpha.sourceText).getByRole('button')).toHaveCount(3)
    for (const name of ['Favorite', 'Archive', 'Delete translation history']) {
      await expect(row(alpha.sourceText).getByRole('button', { name, exact: true })).toBeVisible()
    }
    await screenshot('01-row-actions.png')

    await row(alpha.sourceText).getByRole('button', { name: 'Delete translation history', exact: true }).click()
    await expect(confirmDialog).toHaveAttribute('data-state', 'open')
    await confirmDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirmDialog).toHaveCount(0)
    const afterCancel = await expectTotal('afterDeleteCancel', 4)
    expect(afterCancel.items.map((item) => item.id).sort()).toEqual(evidence.seeded.map((item) => item.id).sort())
    await expect(row(alpha.sourceText)).toBeVisible()
    await screenshot('02-row-delete-cancel.png')

    await row(alpha.sourceText).hover()
    await row(alpha.sourceText).getByRole('button', { name: 'Delete translation history', exact: true }).click()
    await expect(confirmDialog).toHaveAttribute('data-state', 'open')
    await confirmDialog.getByRole('button', { name: 'Delete translation history', exact: true }).click()
    await expect(confirmDialog).toHaveCount(0)
    const afterDelete = await expectTotal('afterDelete', 3)
    expect(afterDelete.items.map((item) => item.id)).toEqual([delta.id, gamma.id, beta.id])
    await expect(row(alpha.sourceText)).toBeHidden()
    for (const item of [beta, gamma, delta]) await expect(row(item.sourceText)).toBeVisible()
    // The list controls disappear in the detail view, so visibility also guards event propagation.
    await expect(archiveToggle).toBeVisible()
    await screenshot('03-after-row-delete.png')

    await row(beta.sourceText).hover()
    await row(beta.sourceText).getByRole('button', { name: 'Archive', exact: true }).click()
    await expectTotal('afterArchiveActive', 2)
    const afterArchive = await expectTotal('afterArchiveArchived', 1, true)
    expect(afterArchive.items).toEqual([
      { id: beta.id, sourceText: beta.sourceText, star: false, archived: true, createdAt: beta.createdAt }
    ])
    await expect(confirmDialog).toHaveCount(0)
    await expect(row(beta.sourceText)).toBeHidden()
    await screenshot('04-after-archive.png')

    await archiveToggle.click()
    await expect(archiveToggle).toHaveAttribute('aria-pressed', 'true')
    await row(beta.sourceText).hover()
    await expect(row(beta.sourceText).getByRole('button')).toHaveCount(3)
    for (const name of ['Favorite', 'Restore', 'Delete translation history']) {
      await expect(row(beta.sourceText).getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(row(beta.sourceText).getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0)
    await screenshot('05-archived-view.png')

    await row(beta.sourceText).getByRole('button', { name: 'Restore', exact: true }).click()
    const afterRestore = await expectTotal('afterRestoreActive', 3)
    expect(afterRestore.items).toEqual(afterDelete.items)
    await expectTotal('afterRestoreArchived', 0, true)
    await expect(confirmDialog).toHaveCount(0)
    await expect(row(beta.sourceText)).toBeHidden()
    await archiveToggle.click()
    await expect(archiveToggle).toHaveAttribute('aria-pressed', 'false')
    for (const item of [delta, gamma, beta]) await expect(row(item.sourceText)).toBeVisible()
    await expect
      .poll(async () => {
        const [d, g, b] = await Promise.all([delta, gamma, beta].map((item) => row(item.sourceText).boundingBox()))
        return Boolean(d && g && b && d.y < g.y && g.y < b.y)
      })
      .toBe(true)
    await screenshot('06-after-restore.png')

    for (const item of [beta, gamma, delta]) {
      await row(item.sourceText).hover()
      await row(item.sourceText).getByRole('button', { name: 'Archive', exact: true }).click()
      await expect(row(item.sourceText)).toBeHidden()
    }
    await expectTotal('allArchivedActive', 0)
    const allArchived = await expectTotal('allArchivedArchived', 3, true)
    expect(allArchived.items).toEqual(afterDelete.items.map((item) => ({ ...item, archived: true })))
    await expect(archiveToggle).toBeVisible()
    await expect(archiveToggle).toHaveAttribute('aria-pressed', 'false')
    await screenshot('07-empty-active-archive-access.png')

    await archiveToggle.click()
    await expect(archiveToggle).toHaveAttribute('aria-pressed', 'true')
    for (const item of [beta, gamma, delta]) await expect(row(item.sourceText)).toBeVisible()
    await page.getByRole('button', { name: 'Clear History', exact: true }).click()
    await expect(confirmDialog).toHaveAttribute('data-state', 'open')
    const confirmClear = confirmDialog.getByRole('button', { name: 'Clear History', exact: true })
    await expect(confirmClear).toBeVisible()
    await screenshot('08-clear-all-confirm.png')
    await confirmClear.click()
    await expect(confirmDialog).toHaveCount(0)
    const clearedArchived = await expectTotal('afterClearArchived', 0, true)
    expect(clearedArchived.items).toEqual([])
    for (const item of [beta, gamma, delta]) await expect(row(item.sourceText)).toBeHidden()
    await archiveToggle.click()
    await expect(archiveToggle).toHaveAttribute('aria-pressed', 'false')
    const clearedActive = await expectTotal('afterClearActive', 0)
    expect(clearedActive.items).toEqual([])
    for (const item of evidence.seeded) await expect(row(item.sourceText)).toBeHidden()
    await screenshot('09-clear-all-both-empty.png')
  } finally {
    await testInfo.attach('translate-history-archive-evidence.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json'
    })
  }
})
