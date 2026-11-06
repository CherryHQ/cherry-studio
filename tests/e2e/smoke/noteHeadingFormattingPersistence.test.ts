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

import { expect, test as base } from './fixtures/electron.fixture'
import { prepareStickyShell, stickyWindow, waitForStickyShell } from './utils/stickySmoke'
import { uiLocator } from './utils/uiLocator'

const ripgrepSource = process.env.E2E_RIPGREP_BIN ?? ''
type NotesProfile = { profile: string; notesPath: string }

const test = base.extend<{ notesProfile: NotesProfile }>({
  notesProfile: async ({}, use, info) => {
    mkdirSync(info.outputDir, { recursive: true })
    const profile = mkdtempSync(info.outputPath('note-heading-profile-'))
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
      for (const name of ['Heading', 'HeadingFocused']) {
        writeFileSync(join(notesPath, `${name}.md`), 'hello')
        writeFileSync(join(baselinePath, `${name}.md`), 'hello')
      }
      await use({ profile, notesPath })
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

test('toolbar heading persists with and without editor focus', async ({ mainWindow: page, notesProfile }, info) => {
  test.setTimeout(180_000)
  const path = info.outputPath('heading-persisted.png')
  let screenshotTaken = false
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
    const list = uiLocator(page, 'notes.navigation').locator('.dynamic-virtual-list')
    await expect(list).toBeVisible()
    const editor = page.locator('[data-ui~="notes.editor"][data-note-id]')
    const surface = editor.locator('[contenteditable="true"]')
    for (const name of ['Heading', 'HeadingFocused']) {
      const row = list.getByRole('treeitem').and(list.getByTitle(name, { exact: true }))
      await row.click()
      await expect(row).toHaveAttribute('aria-selected', 'true')
      await expect(editor).toHaveAttribute('data-note-id', (await row.getAttribute('data-node-id'))!)
      await expect(surface).toBeVisible({ timeout: 30_000 })
      await expect(uiLocator(page, 'notes.editor-loading.status')).toHaveCount(0)
      if (name === 'HeadingFocused') await surface.click()
      else expect(await surface.evaluate((el) => el === document.activeElement)).toBe(false)
      await page.getByRole('button', { name: 'Heading 1', exact: true }).first().click()
      if (name === 'Heading') {
        await page.bringToFront()
        await page.waitForTimeout(250)
        await page.screenshot({ path })
        screenshotTaken = true
      }
      await expect(editor.locator('h1')).toHaveCount(1)
      await expect
        .poll(() => readFileSync(join(notesProfile.notesPath, `${name}.md`), 'utf8').trimEnd(), { timeout: 15_000 })
        .toBe('# hello')
    }
  } finally {
    if (screenshotTaken) await info.attach('heading-persisted', { path, contentType: 'image/png' })
  }
})
