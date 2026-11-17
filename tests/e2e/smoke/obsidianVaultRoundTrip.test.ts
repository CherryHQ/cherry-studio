import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

import { _electron as electron } from '@playwright/test'
import { diffLines } from 'diff'

import { closeElectronApp, expect, test as base } from './fixtures/electron.fixture'
import { prepareStickyShell, stickyWindow, waitForStickyShell } from './utils/stickySmoke'
import { uiLocator } from './utils/uiLocator'

const ripgrepSource = process.env.E2E_RIPGREP_BIN ?? ''
type NotesProfile = { profile: string; notesPath: string; baselinePath: string }

const test = base.extend<{ notesProfile: NotesProfile }>({
  // oxlint-disable-next-line no-empty-pattern
  notesProfile: async ({}, use, info) => {
    mkdirSync(info.outputDir, { recursive: true })
    const profile = mkdtempSync(info.outputPath('note-session-profile-'))
    const previous = process.env.CS_DEV_PROFILE_ROOT
    process.env.CS_DEV_PROFILE_ROOT = profile
    try {
      try {
        accessSync(ripgrepSource, constants.R_OK | constants.X_OK)
      } catch (cause) {
        throw new Error('Set E2E_RIPGREP_BIN to an executable rg before running Notes smoke tests', { cause })
      }
      const binaryDirectory = join(profile, '.cherrystudio', 'bin')
      mkdirSync(binaryDirectory, { recursive: true })
      const destination = join(binaryDirectory, process.platform === 'win32' ? 'rg.exe' : 'rg')
      copyFileSync(ripgrepSource, destination)
      chmodSync(destination, 0o755)
      const notesPath = join(profile, 'userData', 'Data', 'Notes')
      const baselinePath = join(profile, 'baseline')
      mkdirSync(notesPath, { recursive: true })
      mkdirSync(baselinePath)
      await use({ profile, notesPath, baselinePath })
    } finally {
      if (previous === undefined) delete process.env.CS_DEV_PROFILE_ROOT
      else process.env.CS_DEV_PROFILE_ROOT = previous
      rmSync(profile, { recursive: true, force: true })
    }
  },
  electronApp: async ({ notesProfile }, use) => {
    const env = { ...process.env, CS_DEV_PROFILE_ROOT: notesProfile.profile, NODE_ENV: 'development' }
    Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
    const app = await electron.launch({ args: ['.'], env, timeout: 60_000 })
    try {
      await use(app)
    } finally {
      await closeElectronApp(app)
    }
  },
  mainWindow: async ({ electronApp }, use) => {
    await use(await stickyWindow(electronApp))
  }
})

/** Set CHERRY_E2E_KEEP_VAULT to keep the notes for the Obsidian manual check. */
test('Obsidian vault note survives navigation and an unrelated edit with pre-existing Markdown reflow', async ({
  mainWindow: page,
  notesProfile
}, testInfo) => {
  test.setTimeout(180_000)
  const bodies = {
    'Alpha.md':
      String.raw`---
tags: [project, alpha]
aliases: [Alpha One]
---

# Alpha

Plain link [[Beta]] and aliased [[Beta|the beta note]].
Chinese target [[中文 笔记]] and a directory target [[sub/Beta.md|nested]].

| Link | Note |
| --- | --- |
| [[Beta\|the beta]] | escaped pipe |

**Bold with [[Beta]] inside** and *italic [[sub/Beta.md|nested]] span*, plus ~~struck [[Beta]]~~.

Embed ![[Beta]] and a heading target [[Beta#Section]].

Inline code ` +
      '`[[Beta]]`' +
      String.raw` stays literal and an escaped literal \[\[Beta\]\] stays literal.

An ordinary link [docs](https://example.com "Docs") keeps its title.

Other paragraph.
`,
    'Beta.md': 'Beta body\n\n## Section\n\nSection text.\n',
    '中文 笔记.md': '中文 笔记 body\n',
    'sub/Beta.md': 'nested Beta body\n'
  }
  mkdirSync(join(notesProfile.notesPath, 'sub'), { recursive: true })
  mkdirSync(join(notesProfile.baselinePath, 'sub'), { recursive: true })
  for (const [name, body] of Object.entries(bodies)) {
    writeFileSync(join(notesProfile.notesPath, name), body)
    writeFileSync(join(notesProfile.baselinePath, name), body)
  }
  const alphaPath = join(notesProfile.notesPath, 'Alpha.md')
  const baseline = readFileSync(join(notesProfile.baselinePath, 'Alpha.md'))
  const tokens = (content: Buffer) =>
    [...content.toString('utf8').matchAll(/\[\[(?:\\\||[^\]])*\]\]/g)].map((match) => match[0]).sort()

  await prepareStickyShell(page)
  await page.evaluate(async (notesPath) => {
    await window.api.preference.setMultiple({
      'app.language': 'en-US',
      'feature.notes.path': notesPath,
      'feature.notes.default_view_mode': 'edit',
      'feature.notes.default_edit_mode': 'preview'
    })
  }, notesProfile.notesPath)
  await page.reload()
  await waitForStickyShell(page)
  await page.getByRole('button', { name: 'Launchpad', exact: true }).last().click()
  await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Notes', exact: true }).last().click()
  await expect(uiLocator(page, 'notes.view')).toBeVisible()
  const navigation = uiLocator(page, 'notes.navigation')
  await expect(navigation).toBeVisible()
  const list = navigation.locator('.dynamic-virtual-list')
  const row = (name: string) => list.getByRole('treeitem').and(list.getByTitle(name, { exact: true }))
  const editor = page.locator('[data-ui~="notes.editor"][data-note-id]')
  const surface = editor.locator('[contenteditable="true"]')
  const selectNote = async (name: string) => {
    await row(name).click()
    await expect(row(name)).toHaveAttribute('aria-selected', 'true')
    await expect(editor).toHaveAttribute('data-note-id', (await row(name).getAttribute('data-node-id'))!)
    await expect(surface).toBeVisible({ timeout: 30_000 })
    await expect(uiLocator(page, 'notes.editor-loading.status')).toHaveCount(0)
  }
  const expectAlphaVisible = async () => {
    await expect(editor).toContainText('Plain link')
    await expect(editor).toContainText('Bold with')
    await expect(editor).toContainText('the beta note')
    await expect(editor).toContainText('中文 笔记')
  }

  await selectNote('Alpha')
  await expectAlphaVisible()
  await selectNote('Beta')
  await selectNote('Alpha')
  await expectAlphaVisible()
  await page.waitForTimeout(1500)
  const unchanged = readFileSync(alphaPath)
  expect(unchanged, 'navigation must preserve every byte').toEqual(baseline)
  expect(tokens(unchanged), 'navigation must preserve the wiki-link multiset').toEqual(tokens(baseline))

  await surface.locator('p').last().click()
  await surface.press('End')
  await surface.press('Backspace')
  await surface.press('Space')
  await page.keyboard.type('edited.')
  const edited = Buffer.from(baseline.toString('utf8').replace('Other paragraph.', 'Other paragraph edited.'))
  // The existing Markdown serializer reflows block boundaries and omits the trailing newline.
  const normalizeReflow = (content: Buffer) =>
    content
      .toString('utf8')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n*$/, '\n')
  await expect.poll(() => normalizeReflow(readFileSync(alphaPath)), { timeout: 10_000 }).toBe(normalizeReflow(edited))
  const saved = readFileSync(alphaPath)
  expect(tokens(saved), 'editing must preserve the wiki-link multiset').toEqual(tokens(baseline))
  expect(normalizeReflow(saved), 'editing must preserve all bytes except newline reflow').toBe(normalizeReflow(edited))
  const changes = diffLines(edited.toString('utf8'), saved.toString('utf8'), { newlineIsToken: true })
  expect(
    changes.filter((change) => (change.added || change.removed) && change.value.replace(/\n/g, '') !== ''),
    'the raw diff must contain only empty lines'
  ).toEqual([])
  await selectNote('Beta')
  await selectNote('Alpha')
  await expectAlphaVisible()
  await expect(editor).toContainText('Other paragraph edited.')
  await page.waitForTimeout(1500)
  expect(readFileSync(alphaPath), 'reopening must leave the saved bytes unchanged').toEqual(saved)
  const keepDir = process.env.CHERRY_E2E_KEEP_VAULT
  if (keepDir) {
    mkdirSync(keepDir, { recursive: true })
    copyFileSync(alphaPath, join(keepDir, 'Alpha.md'))
    copyFileSync(join(notesProfile.notesPath, 'Beta.md'), join(keepDir, 'Beta.md'))
    copyFileSync(join(notesProfile.baselinePath, 'Alpha.md'), join(keepDir, 'Alpha.baseline.md'))
  }
  await surface.locator('p').filter({ hasText: 'Plain link' }).scrollIntoViewIfNeeded()
  await page.bringToFront()
  const screenshot = await page.screenshot()
  await testInfo.attach('obsidian-vault', { body: screenshot, contentType: 'image/png' })
})
