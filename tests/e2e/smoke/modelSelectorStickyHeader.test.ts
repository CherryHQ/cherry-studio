import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'

import { _electron as electron } from '@playwright/test'

import { expect, test as base } from './fixtures/electron.fixture'
import {
  failureEvidence,
  findRow,
  frames,
  hit,
  jsonEvidence,
  mountedRange,
  namedRow,
  naturalStart,
  prepareStickyShell,
  rowState,
  screenshot,
  scroll,
  stickyWindow
} from './utils/stickySmoke'
import { uiLocator } from './utils/uiLocator'

const test = base.extend<{ stickyProfile: string }>({
  stickyProfile: async ({}, use, info) => {
    mkdirSync(info.outputDir, { recursive: true })
    const profile = mkdtempSync(info.outputPath('model-profile-'))
    const previous = process.env.CS_DEV_PROFILE_ROOT
    process.env.CS_DEV_PROFILE_ROOT = profile
    try {
      await use(profile)
    } finally {
      if (previous === undefined) delete process.env.CS_DEV_PROFILE_ROOT
      else process.env.CS_DEV_PROFILE_ROOT = previous
      rmSync(profile, { recursive: true, force: true })
    }
  },
  electronApp: async ({ stickyProfile }, use) => {
    const env = { ...process.env, CS_DEV_PROFILE_ROOT: stickyProfile, NODE_ENV: 'development' }
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

// #22368: old headers must not cover incoming headers or leave them scrolling past their slot.
test('ModelSelector sticky header hands off between two provider groups', async ({ mainWindow: page }, info) => {
  test.setTimeout(180_000)
  const positions: unknown[] = []
  const evidence: Record<string, unknown> = { profile: process.env.CS_DEV_PROFILE_ROOT, positions, transitions: [] }
  try {
    await prepareStickyShell(page)
    await page.evaluate(async () => {
      const request = async (method: 'POST' | 'PATCH', path: string, body: unknown) => {
        const response = await window.api.dataApi.request({ id: crypto.randomUUID(), method, path, body })
        if (response.error || response.status >= 400) throw new Error(JSON.stringify({ path, response }))
      }
      const run = Date.now()
      for (const group of ['A', 'B']) {
        const providerId = `sticky-smoke-${group.toLowerCase()}-${run}`
        const name = `Sticky Provider ${group}`
        await request('POST', '/providers', { providerId, name, defaultChatEndpoint: 'openai-chat-completions' })
        await request('PATCH', `/providers/${providerId}`, { isEnabled: true })
        await request('POST', `/providers/${providerId}/api-keys`, { key: 'sk-e2e-placeholder', label: 'e2e' })
        await request(
          'POST',
          '/models',
          Array.from({ length: 20 }, (_, i) => ({
            providerId,
            modelId: `model-${String(i + 1).padStart(2, '0')}`,
            name: `${name} model ${String(i + 1).padStart(2, '0')}`,
            endpointTypes: ['openai-chat-completions']
          }))
        )
      }
    })
    await prepareStickyShell(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(uiLocator(page, 'settings.view')).toBeVisible()
    await uiLocator(page, 'settings.navigation').getByText('Default Model', { exact: true }).click()
    await expect(uiLocator(page, 'settings.content')).toBeVisible()
    const trigger = page.locator('#setting-model-default-assistant-model').getByRole('button')
    await trigger.click()
    const list = page.locator('[data-testid="model-selector-content"] .dynamic-virtual-list')
    await expect(list).toBeVisible()
    await scroll(list, 0)
    await frames(list)
    const firstHeader = list
      .locator('[data-index]')
      .filter({ hasText: /^Sticky Provider [AB]$/ })
      .first()
    await expect(firstHeader, '列表里可能是默认 provider，先确认 reload 后重新查询').toBeVisible()
    const first = await firstHeader.innerText()
    const oldName = first.trim()
    expect(['Sticky Provider A', 'Sticky Provider B']).toContain(oldName)
    const newName = oldName === 'Sticky Provider A' ? 'Sticky Provider B' : 'Sticky Provider A'
    const { row: head, a: A } = await naturalStart(list, newName)
    const H = (await rowState(head)).index
    const oldIndex = (await rowState(namedRow(list, oldName))).index
    const model = list.locator(`[data-index="${H + 1}"]`)
    const maxScroll = await list.evaluate((el) => el.scrollHeight - el.clientHeight)
    Object.assign(evidence, { H, A, oldIndex, oldName, newName, maxScroll })
    expect(maxScroll, 'The second provider needs a scrollable tail beyond A+8').toBeGreaterThanOrEqual(A + 8)

    const tops: number[] = []
    for (const [name, delta, expectedTop] of [
      ['before', -12, 12],
      ['at', 0, 0],
      ['after', 8, 0]
    ] as const) {
      await scroll(list, A + delta)
      await expect(model).toContainText(`${newName} model 01`)
      const state = await rowState(head)
      const old = await rowState(namedRow(list, oldName))
      const below = await hit(list, state.top + state.height + 4)
      const top = await hit(list, 4)
      const overlap = await hit(list, 16)
      const sample = {
        name,
        scrollTop: await list.evaluate((el) => el.scrollTop),
        state,
        old,
        model: await rowState(model),
        top,
        overlap,
        below,
        range: await mountedRange(list)
      }
      positions.push(sample)
      await screenshot(page, info, name)
      expect.soft(Math.abs(state.top - expectedTop), `${name}: incoming header top`).toBeLessThanOrEqual(1)
      expect.soft(top.index, `${name}: top hit`).toBe(delta < 0 ? oldIndex : H)
      expect.soft(overlap.index, `${name}: overlap hit`).toBe(H)
      expect.soft(below.index, `${name}: first model below incoming header`).toBe(H + 1)
      expect.soft(below.text).toContain(`${newName} model`)
      // Same-depth stacking and transform clamping are the layout contract under test.
      expect.soft(state.z).toBe(old.z)
      expect.soft(state.z).toBeGreaterThan(sample.model.z)
      expect.soft(state.transform).toMatch(/^matrix/)
      expect.soft(state.background).not.toBe('rgba(0, 0, 0, 0)')
      tops.push(state.top)
    }
    expect.soft(tops[1]).toBeLessThanOrEqual(tops[0] + 1)
    expect.soft(Math.abs(tops[2] - tops[1])).toBeLessThanOrEqual(1)

    const transitions: {
      delta: number
      state: Awaited<ReturnType<typeof rowState>>
    }[] = []
    for (const delta of [-2, -1, 0]) {
      await scroll(list, A + delta)
      transitions.push({ delta, state: await rowState(head) })
    }
    evidence.transitions = transitions
    expect.soft(transitions[0].state.top).toBeCloseTo(2, 0)
    expect.soft(transitions[1].state.top).toBeCloseTo(1, 0)
    expect.soft(transitions[2].state.top).toBeCloseTo(0, 0)
    for (let i = 1; i < transitions.length; i++) {
      expect
        .soft(Math.abs(transitions[i].state.top - transitions[i - 1].state.top), 'No jump within handoff')
        .toBeLessThanOrEqual(2)
      expect.soft(transitions[i].state.top).toBeLessThanOrEqual(transitions[i - 1].state.top + 1)
    }

    const selectedName = `${newName} model 18`
    await scroll(list, 0)
    const selected = await findRow(list, selectedName)
    await selected.getByText(selectedName, { exact: true }).click()
    await expect(list).toBeHidden()
    await expect(trigger).toContainText(selectedName)
  } finally {
    await jsonEvidence(info, 'model-selector-sticky', evidence)
  }
})
