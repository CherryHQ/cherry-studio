import { rm, writeFile } from 'node:fs/promises'

import { _electron as electron, type Locator, type Page, type TestInfo } from '@playwright/test'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import { uiSelector } from '../../../src/renderer/utils/uiContract'
import type { Prompt } from '../../../src/shared/data/types/prompt'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const test = base.extend({
  electronApp: async ({}, provideApp, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
      timeout: 60000
    })
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

const part = (scope: Page | Locator, value: string) => scope.locator(uiSelector({ parts: [value] }))
const manager = (page: Page) => uiLocator(page, 'paintings.prompt-presets')
const rows = (page: Page) => part(part(manager(page), 'prompt-preset-list'), 'prompt-preset-row')
const row = (page: Page, id: string) => rows(page).and(page.locator(`[data-prompt-id="${id}"]`))
const entry = (view: Locator) => uiLocator(view, 'paintings.prompt-presets.action.open')
const form = (page: Page, edit = false) =>
  page.getByRole('dialog', {
    name: en[edit ? 'settings.prompts.edit' : 'settings.prompts.add'],
    exact: true
  })

async function prepare(page: Page) {
  await expect(
    uiLocator(page, 'app.shell').or(page.locator('[data-onboarding-language-select]')).filter({ visible: true }).first()
  ).toBeVisible({ timeout: 60000 })
  await page.evaluate(async (privacyVersion) => {
    await window.api.preference.set('app.language', 'en-US')
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.privacy.policy_version', privacyVersion)
  }, LATEST_PRIVACY_POLICY_VERSION)
  const seeded = await page.evaluate(async () => {
    const result: Array<{ id: string; title: string; content: string }> = []
    for (const [title, content, visibility] of [
      ['Preset One', 'cinematic light', 'global'],
      ['Preset Two', 'watercolor texture', 'global'],
      ['Restricted Preset', 'private content', 'restricted']
    ]) {
      const response = await window.api.dataApi.request({
        id: crypto.randomUUID(),
        method: 'POST',
        path: '/prompts',
        body: { title, content, visibility }
      })
      const entity = response.data as { id?: string } | undefined
      if (
        response.status !== 201 ||
        !entity?.id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entity.id)
      ) {
        throw new Error(`Seed failed: ${JSON.stringify(response)}`)
      }
      result.push({ id: entity.id, title, content })
    }
    return result
  })
  await page.reload()
  await expect(uiLocator(page, 'app.shell').first()).toBeVisible({ timeout: 60000 })
  await selectSidebarApp(page, 'Paintings')
  const view = uiLocator(page, 'paintings.view').filter({ visible: true })
  await expect(view).toBeVisible()
  await expect(entry(view)).toBeVisible()
  return { view, seeded }
}

async function list(page: Page): Promise<Prompt[]> {
  return page.evaluate(async () => {
    const response = await window.api.dataApi.request({
      id: crypto.randomUUID(),
      method: 'GET',
      path: '/prompts',
      params: { visibility: 'global' }
    })
    if (response.status !== 200 || !Array.isArray(response.data)) throw new Error(JSON.stringify(response))
    return response.data as Prompt[]
  })
}

function input(view: Locator) {
  const boundary = part(view, 'composer-input').filter({ visible: true })
  return boundary
    .and(view.locator('textarea'))
    .or(boundary.locator('[contenteditable="true"]'))
    .filter({ visible: true })
    .first()
}

async function draft(view: Locator) {
  return input(view).evaluate((element) =>
    element instanceof HTMLTextAreaElement ? element.value : (element.textContent ?? '')
  )
}

async function fillDraft(page: Page, view: Locator, text: string) {
  await input(view).fill(text)
  // A cold textarea may mount the rich editor after its first change.
  await expect.poll(() => draft(view)).toBe(text)
  await input(view).click()
  await page.keyboard.press('End')
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function probe(page: Page, view: Locator, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name)
  const data = {
    prompts: await list(page),
    domOrder: await rows(page).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-prompt-id'))
    ),
    draft: await draft(view),
    managerOpen: await manager(page).isVisible(),
    entryBox: await entry(view).boundingBox(),
    generationPauseControls: await uiLocator(view, 'chat.composer.action.pause').count()
  }
  await writeFile(path, JSON.stringify(data, null, 2))
  await testInfo.attach(name, { path, contentType: 'application/json' })
}

async function expectDraft(view: Locator, text: string) {
  await expect.poll(() => draft(view)).toBe(text)
  await expect(uiLocator(view, 'chat.composer.action.pause')).toHaveCount(0)
}

test('discovers the labelled entry and inserts a global preset without generating', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120000)
  const { view, seeded } = await prepare(page)
  const label = part(entry(view), 'prompt-presets-label')
  await expect(label).toBeVisible()
  const labelBox = await label.boundingBox()
  expect(labelBox).not.toBeNull()
  expect(labelBox!.width).toBeGreaterThan(10)
  expect(labelBox!.height).toBeGreaterThan(8)
  await expect(label).toHaveText(en['settings.prompts.title'])
  await expect(entry(view)).toHaveAttribute('aria-haspopup', 'dialog')
  await screenshot(page, testInfo, 'entry.png')
  await probe(page, view, testInfo, 'entry.json')
  await fillDraft(page, view, 'Existing draft ')
  await entry(view).click()
  await expect(manager(page)).toBeVisible()
  await expect(rows(page)).toHaveCount(2)
  await expect(row(page, seeded[2].id)).toHaveCount(0)
  await expect(row(page, seeded[0].id)).toBeVisible()
  await expect(row(page, seeded[1].id)).toBeVisible()
  await screenshot(page, testInfo, 'manager.png')
  await probe(page, view, testInfo, 'manager.json')
  await part(row(page, seeded[0].id), 'prompt-preset-apply').click()
  await expect(manager(page)).not.toBeVisible()
  await expectDraft(view, `Existing draft ${seeded[0].content}`)
  await expect(input(view)).toBeFocused()
  await screenshot(page, testInfo, 'applied.png')
  await probe(page, view, testInfo, 'applied.json')
})

test('manages and persists global presets in the painting page while preserving its draft', async ({
  mainWindow: page
}, testInfo) => {
  test.setTimeout(120000)
  const { view } = await prepare(page)
  const originalDraft = 'Keep this painting draft'
  await fillDraft(page, view, originalDraft)
  await entry(view).click()
  await expect(rows(page)).toHaveCount(2)
  await part(manager(page), 'prompt-preset-add').click()
  await form(page)
    .getByRole('textbox', { name: en['settings.prompts.titleLabel'], exact: true })
    .fill('Created in painting')
  await form(page).getByRole('textbox').and(form(page).locator('[contenteditable="true"]')).fill('New preset content')
  await form(page).getByRole('button', { name: en['common.confirm'], exact: true }).click()
  await expect(form(page)).not.toBeVisible()
  await expect
    .poll(async () => (await list(page)).find((item) => item.title === 'Created in painting')?.content)
    .toBe('New preset content')
  const created = (await list(page)).find((item) => item.title === 'Created in painting')!
  await expectDraft(view, originalDraft)
  await part(row(page, created.id), 'prompt-preset-edit').click()
  await form(page, true)
    .getByRole('textbox', { name: en['settings.prompts.titleLabel'], exact: true })
    .fill('Edited in painting')
  await form(page, true).getByRole('button', { name: en['common.confirm'], exact: true }).click()
  await expect(form(page, true)).not.toBeVisible()
  await expect
    .poll(async () => (await list(page)).find((item) => item.id === created.id)?.title)
    .toBe('Edited in painting')
  await expectDraft(view, originalDraft)

  const confirmation = page.getByRole('dialog', { name: en['settings.prompts.delete'], exact: true })
  await part(row(page, created.id), 'prompt-preset-delete').click()
  await confirmation.getByRole('button', { name: en['common.cancel'], exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  expect((await list(page)).some((item) => item.id === created.id)).toBe(true)
  await expectDraft(view, originalDraft)
  await part(row(page, created.id), 'prompt-preset-delete').click()
  await confirmation.getByRole('button', { name: en['common.delete'], exact: true }).click()
  await expect(confirmation).not.toBeVisible()
  await expect.poll(async () => (await list(page)).some((item) => item.id === created.id)).toBe(false)
  await expectDraft(view, originalDraft)
  await screenshot(page, testInfo, 'managed.png')
  await probe(page, view, testInfo, 'managed.json')

  const before = (await list(page)).map((item) => item.id)
  const source = await part(row(page, before[0]), 'prompt-preset-drag').boundingBox()
  const target = await row(page, before.at(-1)!).boundingBox()
  if (!source || !target) throw new Error('Drag source and target must have visible bounding boxes')
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const end = { x: start.x, y: target.y + target.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  try {
    await page.mouse.move(start.x + 10, start.y)
    for (let step = 1; step <= 15; step++) {
      await page.mouse.move(
        start.x + 10 + ((end.x - start.x - 10) * step) / 15,
        start.y + ((end.y - start.y) * step) / 15
      )
      await page.waitForTimeout(20)
    }
    await screenshot(page, testInfo, 'reordering.png')
    await probe(page, view, testInfo, 'reordering.json')
  } finally {
    await page.mouse.up()
  }
  const expected = [...before.slice(1), before[0]]
  await expect.poll(async () => (await list(page)).map((item) => item.id)).toEqual(expected)
  const domIds = () =>
    rows(page).evaluateAll((elements) => elements.map((element) => element.getAttribute('data-prompt-id')))
  await expect.poll(domIds).toEqual(expected)
  await expectDraft(view, originalDraft)
  await expect(part(row(page, expected[0]), 'prompt-preset-edit')).toBeEnabled()
  // The shared Sortable keeps its DragOverlay portal over the page for the drop
  // animation, so the first click that lands during it is swallowed.
  await expect(async () => {
    await manager(page).getByRole('button', { name: en['common.close'], exact: true }).click()
    await expect(manager(page)).not.toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 15000 })
  await entry(view).click()
  await expect.poll(domIds).toEqual(expected)
  expect((await list(page)).map((item) => item.id)).toEqual(expected)
  await expectDraft(view, originalDraft)
  await screenshot(page, testInfo, 'reordered.png')
  await probe(page, view, testInfo, 'reordered.json')
})
