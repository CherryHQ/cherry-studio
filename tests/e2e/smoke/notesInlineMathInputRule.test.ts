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
import { jsonEvidence, prepareStickyShell, stickyWindow, waitForStickyShell } from './utils/stickySmoke'
import { uiLocator } from './utils/uiLocator'

const ripgrepSource = process.env.E2E_RIPGREP_BIN ?? ''
const noteName = 'Inline math input'
type NotesProfile = { profile: string; notesPath: string; notePath: string }

const test = base.extend<{ notesProfile: NotesProfile }>({
  notesProfile: async ({}, use, info) => {
    mkdirSync(info.outputDir, { recursive: true })
    const profile = mkdtempSync(info.outputPath('notes-inline-math-profile-'))
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
      mkdirSync(notesPath, { recursive: true })
      const notePath = join(notesPath, `${noteName}.md`)
      writeFileSync(notePath, '')
      await use({ profile, notesPath, notePath })
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

test('inline math completion preserves adjacent edits and autosaves them', async ({
  mainWindow: page,
  notesProfile
}, info) => {
  test.setTimeout(180_000)
  const evidence: Record<string, unknown> = { notePath: notesProfile.notePath }
  const screenshots: { name: string; path: string }[] = []
  const editor = page.locator('[data-ui~="notes.editor"][data-note-id]')
  const surface = editor.locator('[contenteditable="true"]')
  const atomSelector = '.tiptap-mathematics-render[data-type="inline-math"]'
  const observe = () =>
    surface.evaluate((element, selector) => {
      const structure: ({ type: 'text'; text: string } | { type: 'inlineMath'; latex: string | null })[] = []
      const visit = (node: Node) => {
        if (node instanceof Element && node.matches(selector)) {
          structure.push({ type: 'inlineMath', latex: node.getAttribute('data-latex') })
          return
        }
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ''
          if (!text) return
          const previous = structure.at(-1)
          if (previous?.type === 'text') previous.text += text
          else structure.push({ type: 'text', text })
          return
        }
        node.childNodes.forEach(visit)
      }
      visit(element)
      const atoms = [...element.querySelectorAll(selector)]
      const selection = window.getSelection()
      let caretPosition: number | null = null
      if (selection?.isCollapsed && selection.focusNode && element.contains(selection.focusNode)) {
        const prefix = document.createRange()
        prefix.selectNodeContents(element)
        prefix.setEnd(selection.focusNode, selection.focusOffset)
        const fragment = prefix.cloneContents()
        fragment.querySelectorAll(selector).forEach((atom) => atom.replaceWith('\uFFFC'))
        caretPosition = 1 + (fragment.textContent?.length ?? 0)
      }
      return {
        structure,
        observedText: structure
          .filter((node) => node.type === 'text')
          .map((node) => node.text)
          .join(''),
        atomCount: atoms.length,
        latexValues: atoms.map((atom) => atom.getAttribute('data-latex')),
        caretPosition
      }
    }, atomSelector)
  const capture = async (name: string) => {
    evidence[name] = await observe()
    const path = info.outputPath(`${name}.png`)
    await page.screenshot({ path })
    screenshots.push({ name, path })
  }

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
    await expect(uiLocator(page, 'notes.view')).toBeVisible()
    const navigation = uiLocator(page, 'notes.navigation')
    const list = navigation.locator('.dynamic-virtual-list')
    const row = list.getByRole('treeitem').and(list.getByTitle(noteName, { exact: true }))
    await expect(row).toBeVisible()
    await row.click()
    await expect(row).toHaveAttribute('aria-selected', 'true')
    await expect(editor).toHaveAttribute('data-note-id', (await row.getAttribute('data-node-id'))!)
    await expect(surface).toBeVisible({ timeout: 30_000 })
    await expect(uiLocator(page, 'notes.editor-loading.status')).toHaveCount(0)
    await expect(surface).toHaveText('')
    await surface.click()
    await surface.pressSequentially('1234$a1234')
    for (let step = 0; step < 4; step++) await surface.press('ArrowLeft')
    await capture('before-closure')

    await surface.pressSequentially('$')
    await capture('after-closure')
    expect.soft(await observe()).toEqual({
      structure: [
        { type: 'text', text: '1234' },
        { type: 'inlineMath', latex: 'a' },
        { type: 'text', text: '1234' }
      ],
      observedText: '12341234',
      atomCount: 1,
      latexValues: ['a'],
      caretPosition: 6
    })

    await surface.pressSequentially('9')
    await surface.pressSequentially('8')
    await surface.press('ArrowRight')
    await surface.press('ArrowRight')
    await surface.pressSequentially('7')
    await capture('after-trailing-edits')
    expect.soft(await observe()).toEqual({
      structure: [
        { type: 'text', text: '1234' },
        { type: 'inlineMath', latex: 'a' },
        { type: 'text', text: '9812734' }
      ],
      observedText: '12349812734',
      atomCount: 1,
      latexValues: ['a'],
      caretPosition: 11
    })
    await expect.soft(surface.locator(atomSelector)).toHaveCount(1)
    await expect.soft(surface.locator(atomSelector).first()).toHaveAttribute('data-latex', 'a')
    await expect.soft
      .poll(
        () => {
          const saved = readFileSync(notesProfile.notePath, 'utf8')
          evidence.savedContent = saved
          return saved.trim()
        },
        { timeout: 10_000 }
      )
      .toBe('1234$a$9812734')
  } finally {
    try {
      evidence.final = await observe()
      evidence.finalSavedContent = readFileSync(notesProfile.notePath, 'utf8')
    } finally {
      for (const screenshot of screenshots) {
        await info.attach(screenshot.name, { path: screenshot.path, contentType: 'image/png' })
      }
      await jsonEvidence(info, 'notes-inline-math-input-rule', evidence)
    }
  }
})
