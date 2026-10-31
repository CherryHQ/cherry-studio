import { accessSync, chmodSync, constants, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { _electron as electron } from '@playwright/test'

import { expect, test as base } from './fixtures/electron.fixture'
import {
  failureEvidence,
  findRow,
  frames,
  hit,
  jsonEvidence,
  namedRow,
  naturalStart,
  prepareStickyShell,
  rowState,
  screenshot,
  scroll,
  stickyWindow,
  waitForStickyShell
} from './utils/stickySmoke'
import { uiLocator } from './utils/uiLocator'

const ripgrepSource = process.env.E2E_RIPGREP_BIN ?? ''

const test = base.extend<{ stickyProfile: { profile: string; notesPath: string } }>({
  stickyProfile: async ({}, use, info) => {
    mkdirSync(info.outputDir, { recursive: true })
    const profile = mkdtempSync(info.outputPath('notes-profile-'))
    const notesPath = join(profile, 'userData', 'Data', 'Notes')
    const previous = process.env.CS_DEV_PROFILE_ROOT
    process.env.CS_DEV_PROFILE_ROOT = profile
    try {
      const binaryDirectory = join(profile, '.cherrystudio', 'bin')
      const ripgrepDestination = join(binaryDirectory, 'rg')
      try {
        accessSync(ripgrepSource, constants.R_OK | constants.X_OK)
        mkdirSync(binaryDirectory, { recursive: true })
        copyFileSync(ripgrepSource, ripgrepDestination)
        chmodSync(ripgrepDestination, 0o755)
      } catch (cause) {
        throw new Error(`Failed to inject E2E_RIPGREP_BIN="${ripgrepSource}" into "${ripgrepDestination}"`, { cause })
      }
      for (const [folder, prefix] of [
        ['P/C', 'f'],
        ['P/D', 'g'],
        ['Q/E', 'h']
      ]) {
        const directory = join(notesPath, folder)
        mkdirSync(directory, { recursive: true })
        for (let i = 1; i <= 30; i++) {
          writeFileSync(join(directory, `${prefix}${String(i).padStart(2, '0')}.md`), `# Sticky smoke ${prefix}${i}\n`)
        }
      }
      await use({ profile, notesPath })
    } finally {
      if (previous === undefined) delete process.env.CS_DEV_PROFILE_ROOT
      else process.env.CS_DEV_PROFILE_ROOT = previous
      rmSync(profile, { recursive: true, force: true })
    }
  },
  electronApp: async ({ stickyProfile }, use) => {
    const env = { ...process.env, CS_DEV_PROFILE_ROOT: stickyProfile.profile, NODE_ENV: 'development' }
    Reflect.deleteProperty(env, 'ELECTRON_RENDERER_URL')
    const app = await electron.launch({ args: ['.'], env, timeout: 60_000 })
    try {
      await use(app)
    } finally {
      await app.close()
    }
  },
  mainWindow: async ({ electronApp }, use, info) => {
    const page = await stickyWindow(electronApp)
    try {
      await use(page)
    } finally {
      await failureEvidence(page, info)
    }
  }
})

test.skip(!ripgrepSource, 'dev builds do not ship the managed ripgrep binary; set E2E_RIPGREP_BIN=<path to rg>')

// #22368: actual Notes folders must occupy ancestor slots and yield to later siblings/roots.
test('Notes FileTree sticky folders hand off across parent child sibling and root', async ({
  mainWindow: page,
  stickyProfile: { notesPath }
}, info) => {
  test.setTimeout(180_000)
  const positions: unknown[] = []
  const evidence: Record<string, unknown> = { profile: process.env.CS_DEV_PROFILE_ROOT, positions }
  try {
    await prepareStickyShell(page)
    await page.evaluate(
      async ({ notesPath }) => {
        await window.api.preference.setMultiple({ 'feature.notes.path': notesPath })
      },
      { notesPath }
    )
    await page.reload()
    await waitForStickyShell(page)
    await page.getByRole('button', { name: 'Launchpad', exact: true }).last().click()
    await expect(page.getByRole('heading', { name: 'Apps', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Notes', exact: true }).last().click()
    await expect(uiLocator(page, 'notes.view')).toBeVisible()
    const navigation = uiLocator(page, 'notes.navigation')
    await expect(navigation).toBeVisible()
    const list = navigation.locator('.dynamic-virtual-list')
    await expect(list).toBeVisible()
    await expect(namedRow(list, 'P')).toBeVisible()
    await expect(namedRow(list, 'Q')).toBeVisible()
    const expand = async (name: string) => {
      await scroll(list, 0)
      const row = await findRow(list, name)
      const item = row.getByRole('treeitem')
      if ((await item.getAttribute('aria-expanded')) !== 'true') await item.click()
      await expect(item).toHaveAttribute('aria-expanded', 'true')
      await frames(list)
    }
    // Expand before measuring: every sequence needs the full production preorder and scrollable tail.
    await expand('P')
    for (const name of ['P', 'C', 'Q']) await expect(namedRow(list, name)).toBeAttached()
    for (const name of ['C', 'D', 'Q', 'E']) await expand(name)
    await scroll(list, 0)
    const p = namedRow(list, 'P')
    const c = namedRow(list, 'C')
    const P = await rowState(p)
    const C = await rowState(c)
    expect(P.depth).toBe(0)
    expect(C.depth).toBe(1)
    expect(C.index).toBe(P.index + 1)
    const { a: dA } = await naturalStart(list, 'D')
    const D = await rowState(namedRow(list, 'D'))
    const { a: qA } = await naturalStart(list, 'Q')
    const Q = await rowState(namedRow(list, 'Q'))
    expect(D.depth).toBe(1)
    expect(Q.depth).toBe(0)
    expect(P.index).toBeLessThan(C.index)
    expect(C.index).toBeLessThan(D.index)
    expect(D.index).toBeLessThan(Q.index)
    Object.assign(evidence, { P, C, D, Q, dA, qA })

    await scroll(list, 0)
    await frames(list)
    expect((await rowState(p)).top, 'first row sits at the list top when scrolled to 0').toBeCloseTo(0, 0)
    const pA = 0
    await scroll(list, pA + 1)
    const adjacent = {
      scrollTop: await list.evaluate((el) => el.scrollTop),
      name: 'parent-child',
      p: await rowState(p),
      c: await rowState(c),
      top: await hit(list, 2)
    }
    positions.push(adjacent)
    await screenshot(page, info, 'parent-child')
    expect.soft(Math.abs(adjacent.p.top)).toBeLessThanOrEqual(1)
    expect.soft(Math.abs(adjacent.c.top - adjacent.p.height)).toBeLessThanOrEqual(1)
    expect.soft(adjacent.top.index).toBe(P.index)
    expect.soft(adjacent.p.z).toBeGreaterThan(adjacent.c.z)

    // D enters C's measured ancestor slot; sample both sides of their geometric handoff.
    for (const delta of [-2, 0, 2]) {
      await scroll(list, dA - P.height + delta)
      const d = namedRow(list, 'D')
      const state = {
        name: 'siblings',
        scrollTop: await list.evaluate((el) => el.scrollTop),
        delta,
        p: await rowState(p),
        c: await rowState(c),
        d: await rowState(d),
        slot: await hit(list, P.height + 2),
        top: await hit(list, 2)
      }
      positions.push(state)
      if (delta === 0) await screenshot(page, info, 'siblings')
      expect.soft(Math.abs(state.p.top)).toBeLessThanOrEqual(1)
      expect.soft(state.d.top).toBeGreaterThanOrEqual(P.height - 1)
      expect.soft(state.top.index).toBe(P.index)
      if (delta >= 0) {
        expect.soft(Math.abs(state.c.top - state.d.top), 'Sibling heads share a slot').toBeLessThanOrEqual(1)
        expect.soft(state.slot.index, 'Later sibling wins the hit in its slot').toBe(D.index)
        expect.soft(state.c.z).toBe(state.d.z)
      }
    }

    await scroll(list, qA)
    const q = namedRow(list, 'Q')
    const exited: { name: string; mounted: number; state: Awaited<ReturnType<typeof rowState>> | null }[] = []
    for (const name of ['C', 'D']) {
      const row = namedRow(list, name)
      exited.push({ name, mounted: await row.count(), state: (await row.count()) ? await rowState(row) : null })
    }
    const cross = {
      name: 'cross-parent',
      scrollTop: await list.evaluate((el) => el.scrollTop),
      q: await rowState(q),
      exited,
      top: await hit(list, 2),
      childSlot: await hit(list, Q.height + 2)
    }
    positions.push(cross)
    await screenshot(page, info, 'cross-parent')
    expect.soft(Math.abs(cross.q.top)).toBeLessThanOrEqual(1)
    expect.soft(cross.top.index).toBe(Q.index)
    expect.soft([C.index, D.index]).not.toContain(cross.childSlot.index)
    for (const old of exited) {
      if (old.state)
        expect.soft(old.state.top + old.state.height, `${old.name} exited above the viewport`).toBeLessThanOrEqual(1)
    }
  } finally {
    await jsonEvidence(info, 'notes-sticky', evidence)
  }
})
