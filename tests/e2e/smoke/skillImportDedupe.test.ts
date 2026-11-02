import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { _electron as electron } from '@playwright/test'
import AdmZip from 'adm-zip'

import type { IpcResult } from '../../../src/shared/ipc/errors/IpcError'
import type { SkillCatalogEntry } from '../../../src/shared/types/skill'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend<{ isolatedProfile: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright requires destructured fixture arguments.
  isolatedProfile: async ({}, use, testInfo) => {
    await mkdir(testInfo.outputPath(), { recursive: true })
    const profile = await mkdtemp(testInfo.outputPath('profile-'))
    try {
      await use(profile)
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  },
  electronApp: async ({ isolatedProfile }, use) => {
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, CS_DEV_PROFILE_ROOT: isolatedProfile, NODE_ENV: 'development' },
      timeout: 60_000
    })
    try {
      await use(app)
    } finally {
      await app.close()
    }
  }
})

for (const policy of ['skip', 'update', 'keep_both'] as const) {
  test(`bulk skill import: ${policy}`, async ({ electronApp, mainWindow: page }, testInfo) => {
    test.setTimeout(240_000)
    const fixtures = testInfo.outputPath('fixtures')
    const seedA = path.join(fixtures, 'seed-a')
    const seedB = path.join(fixtures, 'seed-b')
    const renamed = path.join(fixtures, 'renamed-identical')
    const changed = path.join(fixtures, 'changed', 'seed-b')
    const zipPath = path.join(fixtures, 'root-new.zip')
    const invalid = path.join(fixtures, 'invalid.txt')
    const descriptor = (name: string, body: string) =>
      `---\nname: ${name}\ndescription: Dedupe smoke ${name}\n---\n# ${body}\n`
    const originalA = descriptor('seed-a', 'Original A')
    const originalB = descriptor('seed-b', 'Original B')
    const changedB = descriptor('seed-b', 'Changed B')
    const updatedZipB = descriptor('seed-b', 'Updated from root ZIP')
    const updateZipPath = path.join(fixtures, 'seed-b.zip')
    for (const [folder, content] of [
      [seedA, originalA],
      [seedB, originalB],
      [changed, changedB]
    ]) {
      await mkdir(folder, { recursive: true })
      await writeFile(path.join(folder, 'SKILL.md'), content)
    }
    await cp(seedA, renamed, { recursive: true })
    const archive = new AdmZip()
    archive.addFile('SKILL.md', Buffer.from(descriptor('root-new', 'New root ZIP')))
    archive.writeZip(zipPath)
    await writeFile(invalid, 'This is not a ZIP or a skill descriptor')
    const updateArchive = new AdmZip()
    updateArchive.addFile('SKILL.md', Buffer.from(updatedZipB))
    updateArchive.writeZip(updateZipPath)

    const originalDialog = await electronApp.evaluateHandle(({ dialog }) => dialog.showOpenDialog)
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Import skill', exact: true }) })
    const results = dialog.getByTestId('skill-import-results')
    const settings = page.locator('[data-ui="settings.view"]')
    const libraryRoot = await electronApp.evaluate(({ app }) => `${app.getPath('userData')}/Data/Skills`)
    const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
    const screenshot = async (name: string) => {
      const file = testInfo.outputPath(`${name}.png`)
      await page.screenshot({ path: file, timeout: 15_000 })
      await testInfo.attach(name, { path: file, contentType: 'image/png' })
    }
    const probe = async (name: string) => {
      const catalog = await page.evaluate(async () => {
        const result = (await window.api.ipcApi.request('skill.list_catalog', {})) as IpcResult<SkillCatalogEntry[]>
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      })
      const rows = catalog
        .map(({ id, folderName, source, sourceUrl, contentHash }) => ({
          id,
          folderName,
          source,
          sourceUrl,
          contentHash
        }))
        .sort((a, b) => a.folderName.localeCompare(b.folderName))
      const entries = (await readdir(libraryRoot, { withFileTypes: true })).map((entry) => entry.name).sort()
      const skillMdDigests: Record<string, string> = {}
      for (const entry of entries) {
        const descriptorPath = path.join(libraryRoot, entry, 'SKILL.md')
        skillMdDigests[entry] = digest(await readFile(descriptorPath))
      }
      const state = { rows, entries, skillMdDigests }
      const file = testInfo.outputPath(`${name}-state.json`)
      await writeFile(file, JSON.stringify(state, null, 2))
      await testInfo.attach(`${name}-state`, { path: file, contentType: 'application/json' })
      return state
    }
    const openImport = async () => {
      await settings.getByRole('button', { name: 'Add Skill', exact: true }).first().click({ timeout: 15_000 })
      await page.getByRole('menuitem', { name: 'Local import', exact: true }).first().click({ timeout: 15_000 })
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(results).toHaveCount(0, { timeout: 15_000 })
    }
    const pick = async (paths: string[], kind: 'directory' | 'zip') => {
      await electronApp.evaluate(({ dialog }, filePaths) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
      }, paths)
      await dialog
        .getByRole('button', {
          name: kind === 'directory' ? 'Install from directory' : 'Install from ZIP file',
          exact: true
        })
        .click({ timeout: 15_000 })
      await expect(dialog.getByRole('button', { name: /^Apply \(/ })).toBeEnabled({ timeout: 15_000 })
      await expect(dialog.getByRole('radio', { name: 'Skip existing', exact: true })).toBeChecked()
    }
    const choosePolicy = async () => {
      await dialog
        .getByRole('radio', {
          name: { skip: 'Skip existing', update: 'Update existing', keep_both: 'Keep both' }[policy],
          exact: true
        })
        .click({ timeout: 15_000 })
      await expect(dialog.getByRole('button', { name: /^Apply \(/ })).toBeEnabled({ timeout: 15_000 })
    }
    const apply = async (writes: number) => {
      await dialog.getByRole('button', { name: `Apply (${writes} writes)`, exact: true }).click({ timeout: 15_000 })
      await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(dialog).toBeVisible()
    }
    const close = async () => {
      await dialog.getByRole('button', { name: 'Close', exact: true }).click({ timeout: 15_000 })
      await expect(dialog).toBeHidden({ timeout: 15_000 })
    }
    try {
      const shell = page.locator('[data-ui~="app.shell"]').first()
      const onboarding = page.locator('[data-onboarding-language-select]')
      const skipOnboarding = page.getByRole('button', { name: 'Set up later', exact: true })
      const settingsButton = shell
        .getByRole('button', { name: 'Settings', exact: true })
        .filter({ visible: true })
        .first()

      // Host language decides the first screen (preference is null on a fresh profile), so pin it before
      // asserting any localized text: this reaches the main-process locale as well.
      await expect(shell.or(onboarding).filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 })
      await page.evaluate(() => window.api.preference.set('app.language', 'en-US'))
      expect(await page.evaluate(() => window.api.preference.get('app.language'))).toBe('en-US')
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
      await expect(shell.or(onboarding).filter({ visible: true }).first()).toBeVisible({ timeout: 120_000 })
      expect(await page.evaluate(() => window.api.preference.get('app.language'))).toBe('en-US')

      await expect(skipOnboarding).toBeVisible({ timeout: 30_000 })
      await expect(skipOnboarding).toBeEnabled({ timeout: 30_000 })
      await skipOnboarding.click({ timeout: 30_000 })
      await expect(onboarding).toBeHidden({ timeout: 60_000 })
      await expect(shell).toBeVisible({ timeout: 60_000 })

      await expect(settings.or(settingsButton).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
      if (!(await settings.isVisible())) await settingsButton.click({ timeout: 30_000 })
      await expect(settings).toBeVisible({ timeout: 30_000 })
      await settings
        .locator('[data-ui="settings.navigation"] [data-slot="menu-item"]')
        .filter({ hasText: /^Skills$/ })
        .first()
        .click({ timeout: 15_000 })
      await expect(settings.getByRole('button', { name: 'Add Skill', exact: true }).first()).toBeVisible({
        timeout: 15_000
      })

      // Seed through the same user-facing path under test.
      await openImport()
      await pick([seedA, seedB], 'directory')
      await apply(2)
      await expect(results.getByText('Imported', { exact: true })).toHaveCount(2)
      await close()
      const before = await probe(`${policy}-before`)
      const a = before.rows.find((row) => row.folderName === 'seed-a')!
      const b = before.rows.find((row) => row.folderName === 'seed-b')!
      expect(a.source).toBe('local')
      expect(b.source).toBe('local')
      expect(before.skillMdDigests['seed-a']).toBe(digest(originalA))
      expect(before.skillMdDigests['seed-b']).toBe(digest(originalB))

      await openImport()
      await pick([renamed, changed], 'directory')
      await choosePolicy()
      await expect(results.getByText('Already exists', { exact: true })).toHaveCount(2)
      await expect(results).toContainText('Identical content')
      await expect(results).toContainText('Same folder name')
      await screenshot(`${policy}-review`)
      expect(await probe(`${policy}-review`)).toEqual(before)
      await apply(policy === 'skip' ? 0 : 2)
      await expect(
        results.getByText({ skip: 'Skipped', update: 'Updated', keep_both: 'Imported' }[policy], { exact: true })
      ).toHaveCount(2)
      await screenshot(`${policy}-done`)
      await close()

      // Root ZIP and invalid file share a batch, proving invalid rows do not prevent valid writes.
      await openImport()
      await pick([zipPath, invalid], 'zip')
      await choosePolicy()
      await expect(results).toContainText('Not importable')
      await expect(results).toContainText('invalid.txt')
      await screenshot(`${policy}-zip-review`)
      await apply(1)
      await expect(results.getByText('Imported', { exact: true })).toHaveCount(1)
      await expect(results.getByText('Failed', { exact: true })).toHaveCount(1)
      await screenshot(`${policy}-zip-done`)
      await close()
      if (policy === 'update') {
        const directoryUpdated = await probe('update-directories')
        expect(directoryUpdated.rows.find((row) => row.id === b.id)?.sourceUrl).toBe(pathToFileURL(changed).href)
        expect(directoryUpdated.skillMdDigests['seed-b']).toBe(digest(changedB))
        await openImport()
        await pick([updateZipPath], 'zip')
        await choosePolicy()
        await expect(results).toContainText('Same folder name')
        await screenshot('update-provenance-review')
        await apply(1)
        await expect(results.getByText('Updated', { exact: true })).toHaveCount(1)
        await screenshot('update-provenance-done')
        await close()
      }
      const after = await probe(`${policy}-after`)
      expect(after.rows.find((row) => row.id === a.id)?.folderName).toBe('seed-a')
      expect(after.rows.find((row) => row.id === b.id)?.folderName).toBe('seed-b')
      const added = after.rows.filter((row) => !before.rows.some((prior) => prior.id === row.id))
      expect(added).toHaveLength(policy === 'keep_both' ? 3 : 1)
      expect(added.find((row) => row.folderName === 'root-new')?.source).toBe('zip')
      expect(added.find((row) => row.folderName === 'root-new')?.sourceUrl).toBe(pathToFileURL(zipPath).href)
      expect(after.entries).toEqual([...before.entries, ...added.map((row) => row.folderName)].sort())
      if (policy === 'update') {
        expect(after.rows.find((row) => row.id === a.id)?.sourceUrl).toBe(pathToFileURL(renamed).href)
        expect(after.rows.find((row) => row.id === b.id)?.sourceUrl).toBe(pathToFileURL(updateZipPath).href)
        expect(after.rows.find((row) => row.id === b.id)?.source).toBe('zip')
        expect(after.rows.find((row) => row.id === b.id)?.sourceUrl).not.toBe(b.sourceUrl)
        expect(after.rows.find((row) => row.id === b.id)?.contentHash).not.toBe(b.contentHash)
        expect(after.skillMdDigests['seed-a']).toBe(digest(originalA))
        expect(after.skillMdDigests['seed-b']).toBe(digest(updatedZipB))
      } else {
        for (const prior of before.rows) expect(after.rows.find((row) => row.id === prior.id)).toEqual(prior)
        for (const [folder, hash] of Object.entries(before.skillMdDigests))
          expect(after.skillMdDigests[folder]).toBe(hash)
        if (policy === 'keep_both') {
          expect(added.map((row) => row.folderName).sort()).toEqual(['renamed-identical', 'root-new', 'seed-b-2'])
          expect(after.skillMdDigests['renamed-identical']).toBe(digest(originalA))
          expect(after.skillMdDigests['seed-b-2']).toBe(digest(changedB))
          expect(new Set(after.rows.map((row) => row.folderName)).size).toBe(after.rows.length)
        }
      }
    } finally {
      try {
        await electronApp.evaluate(({ dialog }, original) => {
          dialog.showOpenDialog = original
        }, originalDialog)
      } finally {
        await originalDialog.dispose()
      }
    }
  })
}
