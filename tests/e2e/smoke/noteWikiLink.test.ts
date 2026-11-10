import { createHash } from 'node:crypto'
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

import { closeElectronApp, expect, test as base } from './fixtures/electron.fixture'
import { jsonEvidence, prepareStickyShell, stickyWindow, waitForStickyShell } from './utils/stickySmoke'
import { uiLocator } from './utils/uiLocator'

const ripgrepSource = process.env.E2E_RIPGREP_BIN ?? ''
type NotesProfile = { profile: string; notesPath: string; baselinePath: string }

const test = base.extend<{ notesProfile: NotesProfile }>({
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

test('wiki links navigate and preserve note content on edit', async ({ mainWindow: page, notesProfile }, info) => {
  test.setTimeout(180_000)
  const bodies = {
    'A.md':
      '# A\n\nPlain [[B]] link, aliased [[sub/B.md|nested B]], code `[[B]]`, embed ![[B]], escaped \\[\\[B\\]\\].\n\nOther paragraph.\n',
    'B.md': 'B body',
    'sub/B.md': 'nested B body'
  }
  mkdirSync(join(notesProfile.notesPath, 'sub'), { recursive: true })
  mkdirSync(join(notesProfile.baselinePath, 'sub'), { recursive: true })
  for (const [name, body] of Object.entries(bodies)) {
    writeFileSync(join(notesProfile.notesPath, name), body)
    writeFileSync(join(notesProfile.baselinePath, name), body)
  }
  const evidence: Record<string, unknown> = {}
  const files = () =>
    Object.fromEntries(
      Object.keys(bodies).map((name) => {
        const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
        return [
          name,
          {
            baseline: hash(join(notesProfile.baselinePath, name)),
            actual: hash(join(notesProfile.notesPath, name))
          }
        ]
      })
    )
  try {
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
    const view = uiLocator(page, 'notes.view')
    await expect(view).toBeVisible()
    const navigation = uiLocator(page, 'notes.navigation')
    await expect(navigation).toBeVisible()
    const list = navigation.locator('.dynamic-virtual-list')
    await expect(list).toBeVisible()
    const row = (name: string) => list.getByRole('treeitem').and(list.getByTitle(name, { exact: true }))
    await expect(row('A')).toBeVisible()
    await expect(row('B')).toBeVisible()
    const editor = page.locator('[data-ui~="notes.editor"][data-note-id]')
    const surface = editor.locator('[contenteditable="true"]')
    const selectA = async () => {
      await row('A').click()
      await expect(row('A')).toHaveAttribute('aria-selected', 'true')
      await expect(editor).toHaveAttribute('data-note-id', (await row('A').getAttribute('data-node-id'))!)
      await expect(surface).toBeVisible({ timeout: 30_000 })
      await expect(uiLocator(page, 'notes.editor-loading.status')).toHaveCount(0)
    }
    await selectA()
    const wikiLinks = editor.locator('[data-wiki-link]')
    const wikiTargets = editor.locator('[data-wiki-target]')
    evidence.renderingCount = await wikiLinks.count()
    evidence.wikiTargetCount = await wikiTargets.count()
    await expect(wikiLinks).toHaveCount(2)
    await expect(editor).toContainText('![[B]]')
    await expect(editor.locator('[data-wiki-target="B"]')).toHaveText('B')
    await expect(editor.locator('[data-wiki-target="sub/B.md"]')).toHaveText('nested B')
    await expect(wikiTargets).toHaveCount(2)
    const linkStyle = await editor.locator('[data-wiki-target="B"]').evaluate((el) => {
      const style = getComputedStyle(el)
      return { decoration: style.textDecorationLine, cursor: style.cursor }
    })
    evidence.linkStyle = linkStyle
    expect(linkStyle.decoration, 'navigable wiki links must look like links').toContain('underline')
    expect(linkStyle.cursor).toBe('pointer')
    evidence.beforeClick = { row: 'A', selected: await row('A').getAttribute('aria-selected') }
    await editor.locator('[data-wiki-target="B"]').click({ modifiers: ['ControlOrMeta'] })
    await page.waitForTimeout(1500)
    const selectedNoteId = await editor.getAttribute('data-note-id')
    expect(selectedNoteId?.replaceAll('\\', '/')).toBe(join(notesProfile.notesPath, 'A.md').replaceAll('\\', '/'))
    evidence.ambiguousClick = { selectedNoteId, stillA: true }
    await editor.locator('[data-wiki-target="sub/B.md"]').click({ modifiers: ['ControlOrMeta'] })
    await expect
      .poll(async () => (await editor.getAttribute('data-note-id'))?.replaceAll('\\', '/'), { timeout: 15_000 })
      .toBe(join(notesProfile.notesPath, 'sub', 'B.md').replaceAll('\\', '/'))
    evidence.qualifiedClick = await editor.getAttribute('data-note-id')
    await selectA()
    await surface.locator('p').last().click()
    await surface.press('End')
    await surface.press('X')
    const aPath = join(notesProfile.notesPath, 'A.md')
    await expect.poll(() => readFileSync(aPath, 'utf8'), { timeout: 10_000 }).toContain('X')
    const actualA = readFileSync(aPath, 'utf8')
    evidence.finalA = actualA.slice(0, 400)
    const baselineA = readFileSync(join(notesProfile.baselinePath, 'A.md'), 'utf8')
    const expectedA = baselineA.replace('Other paragraph.', 'Other paragraph.X').replace(/\n$/, '')
    evidence.expectedA = expectedA
    // The whole point: a normal edit must only add the typed character. Any re-serialization of the
    // existing tokens (escaping, alias rewriting, normalization) shows up as a byte diff here.
    expect(actualA, 'editing another paragraph must not rewrite the wiki tokens').toBe(expectedA)
    expect(actualA).toContain('[[B]]')
    expect(actualA).toContain('[[sub/B.md|nested B]]')
    expect(actualA).toContain('escaped \\[\\[B\\]\\].')
    await surface.press('Enter')
    await expect.poll(() => readFileSync(aPath, 'utf8'), { timeout: 10_000 }).toBe(`${expectedA}\n\n`)
    await surface.press('Backspace')
    await surface.press('Home')
    await surface.press('Shift+End')
    await surface.press('Backspace')
    await surface.press('Backspace')
    await expect
      .poll(() => readFileSync(aPath, 'utf8'), { timeout: 10_000 })
      .toBe(expectedA.replace(/\n\nOther paragraph\.X$/, ''))
    const disk = files()
    evidence.files = disk
    for (const name of ['B.md', 'sub/B.md']) {
      expect.soft(disk[name].actual, `${name} must not be written during navigation`).toBe(disk[name].baseline)
    }
    const path = info.outputPath('wiki-links-and-edited-A.png')
    await page.bringToFront()
    await page.waitForTimeout(500)
    await page.screenshot({ path })
    await info.attach('wiki-links-and-edited-A', { path, contentType: 'image/png' })
  } finally {
    evidence.files = files()
    evidence.finalA = readFileSync(join(notesProfile.notesPath, 'A.md'), 'utf8').slice(0, 400)
    await jsonEvidence(info, 'note-wiki-link', evidence)
  }
})
