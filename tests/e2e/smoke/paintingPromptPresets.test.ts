import { writeFile } from 'node:fs/promises'

import type { Locator, Page, TestInfo } from '@playwright/test'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import { uiSelector } from '../../../src/renderer/utils/uiContract'
import type { Prompt } from '../../../src/shared/data/types/prompt'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const part = (scope: Page | Locator, value: string) => scope.locator(uiSelector({ parts: [value] }))
const manager = (page: Page) => uiLocator(page, 'paintings.prompt-presets')
const rows = (page: Page) => part(part(manager(page), 'prompt-preset-list'), 'prompt-preset-row')
const row = (page: Page, id: string) => rows(page).and(page.locator(`[data-prompt-id="${id}"]`))
const entry = (view: Locator) => uiLocator(view, 'paintings.prompt-presets.action.open')

async function prepare(page: Page) {
  await expect(
    uiLocator(page, 'app.content')
      .or(page.locator('[data-onboarding-language-select]'))
      .filter({ visible: true })
      .first()
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
  await expect(uiLocator(page, 'app.content').first()).toBeVisible({ timeout: 60000 })
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
  await expect(async () => {
    const labelBox = await label.boundingBox()
    expect(labelBox).not.toBeNull()
    expect(labelBox!.width).toBeGreaterThan(10)
    expect(labelBox!.height).toBeGreaterThan(8)
  }).toPass({ timeout: 10_000 })
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
