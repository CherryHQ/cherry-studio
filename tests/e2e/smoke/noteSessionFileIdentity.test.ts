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

import type { Page, TestInfo } from '@playwright/test'
import { _electron as electron } from '@playwright/test'

import { expect, test as base } from './fixtures/electron.fixture'
import { jsonEvidence, prepareStickyShell, stickyWindow, waitForStickyShell } from './utils/stickySmoke'
import { uiLocator } from './utils/uiLocator'

const ripgrepSource = process.env.E2E_RIPGREP_BIN ?? ''
const smallBodies = { A: '# A #', B: 'B' }
type Bodies = typeof smallBodies
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
      } catch {
        test.skip(true, 'Managed ripgrep unavailable; set E2E_RIPGREP_BIN to an executable rg')
      }
      const binaryDirectory = join(profile, '.cherrystudio', 'bin')
      mkdirSync(binaryDirectory, { recursive: true })
      const destination = join(binaryDirectory, 'rg')
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
      await app.close()
    }
  },
  mainWindow: async ({ electronApp }, use) => {
    await use(await stickyWindow(electronApp))
  }
})

test.skip(!ripgrepSource, 'dev builds do not ship the managed ripgrep binary; set E2E_RIPGREP_BIN=<path to rg>')

function diskEvidence(profile: NotesProfile, small: boolean) {
  return Object.fromEntries(
    ['A', 'B'].map((name) => {
      const path = join(profile.notesPath, `${name}.md`)
      const baselinePath = join(profile.baselinePath, `${name}.md`)
      const baseline = readFileSync(baselinePath)
      const actual = readFileSync(path)
      const describe = (bytes: Buffer) => ({
        bytes: bytes.length,
        characters: bytes.toString('utf8').length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(small ? { hex: bytes.toString('hex') } : {})
      })
      return [
        name,
        { path, baselinePath, baseline: describe(baseline), actual: describe(actual), equals: actual.equals(baseline) }
      ]
    })
  )
}

async function runCase(page: Page, profile: NotesProfile, info: TestInfo, bodies: Bodies, edit = false) {
  test.setTimeout(180_000)
  for (const name of ['A', 'B'] as const) {
    writeFileSync(join(profile.notesPath, `${name}.md`), bodies[name])
    writeFileSync(join(profile.baselinePath, `${name}.md`), bodies[name])
  }
  const dialogs: unknown[] = []
  const evidence: Record<string, unknown> = { profile, bodies, dialogs, edit }
  try {
    await prepareStickyShell(page)
    await page.evaluate(async (notesPath) => {
      await window.api.preference.setMultiple({
        'app.language': 'en-US',
        'feature.notes.path': notesPath,
        'feature.notes.default_view_mode': 'edit',
        'feature.notes.default_edit_mode': 'preview'
      })
    }, profile.notesPath)
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
    // Notes projection strips .md; FileTreeRow renders that name as both text and title.
    const row = (name: string) => list.getByRole('treeitem').and(list.getByTitle(name, { exact: true }))
    for (const name of ['A', 'B']) {
      await expect(row(name)).toBeVisible()
      await expect(row(name)).toHaveText(name)
    }
    // The footer also has notes.editor; only the document container carries data-note-id.
    const editor = page.locator('[data-ui~="notes.editor"][data-note-id]')
    const surface = editor.locator('[contenteditable="true"]')
    const select = async (name: string) => {
      await row(name).click()
      await expect
        .poll(
          async () => {
            const dialog = page.getByRole('dialog', { name: 'Discard unsaved note edits?', exact: true })
            if (await dialog.isVisible()) {
              dialogs.push({ leavingFor: name, text: await dialog.textContent() })
              await dialog.getByRole('button', { name: 'Discard and continue', exact: true }).click()
            }
            return await row(name).getAttribute('aria-selected')
          },
          { timeout: 15_000 }
        )
        .toBe('true')
      await expect(editor).toHaveAttribute('data-note-id', (await row(name).getAttribute('data-node-id'))!)
      await expect(surface).toBeVisible({ timeout: 30_000 })
      await expect(uiLocator(page, 'notes.editor-loading.status')).toHaveCount(0)
    }
    await select('B')
    await page.waitForTimeout(2_000)
    if (!edit) {
      await select('A')
      await page.waitForTimeout(2_000)
      await select('B')
    }
    const mountedText = await surface.textContent()
    evidence.mounted = {
      selectedName: await row('B').textContent(),
      selected: await row('B').getAttribute('aria-selected'),
      nodeId: await row('B').getAttribute('data-node-id'),
      editorNoteId: await editor.getAttribute('data-note-id'),
      loadingCount: await uiLocator(page, 'notes.editor-loading.status').count(),
      mountedText,
      expectedB: bodies.B,
      forbiddenA: 'A'
    }
    expect.soft(mountedText, 'cached B mounts its own document').toContain(bodies.B)
    expect.soft(mountedText, 'cached B must not replay A').not.toContain('A')
    if (edit) {
      await surface.click()
      await surface.press('ControlOrMeta+End')
      await surface.press('x')
      const expectedText = 'Bx'
      evidence.editExpectedText = expectedText
      await expect.soft
        .poll(
          () => {
            const actual = readFileSync(join(profile.notesPath, 'B.md'), 'utf8')
            evidence.editActualText = actual
            return actual
          },
          { timeout: 10_000 }
        )
        .toContain(expectedText)
      evidence.editedMountedText = await surface.textContent()
      expect.soft(evidence.editedMountedText).toBe(expectedText)
    } else {
      await page.waitForTimeout(2_000)
    }
    const files = diskEvidence(profile, bodies.A === smallBodies.A)
    evidence.files = files
    expect.soft(files.A.equals, 'A disk bytes equal the untouched baseline').toBe(true)
    expect
      .soft(files.B.equals, edit ? 'deliberate B edit reaches disk' : 'B disk bytes equal the untouched baseline')
      .toBe(!edit)
    await expect(row('B')).toHaveAttribute('aria-selected', 'true')
    await expect(row('B')).toBeVisible()
    await expect(surface).toBeVisible()
    const path = info.outputPath('selected-B-editor.png')
    await page.bringToFront()
    await page.waitForTimeout(500)
    await page.screenshot({ path })
    await info.attach('selected-B-editor', { path, contentType: 'image/png' })
  } finally {
    evidence.finalFiles = diskEvidence(profile, bodies.A === smallBodies.A)
    await jsonEvidence(info, 'note-session-file-identity', evidence)
  }
}

test('cached B mounts its own document and preserves both small files', async ({ mainWindow, notesProfile }, info) => {
  await runCase(mainWindow, notesProfile, info, smallBodies)
})

test('deliberate B edit autosaves without changing A', async ({ mainWindow, notesProfile }, info) => {
  await runCase(mainWindow, notesProfile, info, smallBodies, true)
})

test('cached B preserves both large files byte-for-byte', async ({ mainWindow, notesProfile }, info) => {
  const bodies = {
    A: '# A #\n\n' + 'A-note-marker '.repeat(8_000).slice(0, 100_000),
    B: 'B-note-marker '.repeat(12_000).slice(0, 150_000)
  }
  await runCase(mainWindow, notesProfile, info, bodies)
})
