// Send-path serialization is covered by composerDraft unit tests and the clipboard assertion below.
// This spec does not fake a provider.
import { rm, writeFile } from 'node:fs/promises'

import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { _electron as electron } from '@playwright/test'

import enUs from '../../../src/renderer/i18n/locales/en-us.json'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test as base } from './fixtures/electron.fixture'
import { uiLocator } from './utils/uiLocator'

const SOURCE = '$e^{i\\pi}+1=0$'
const LATEX = 'e^{i\\pi}+1=0'
const EDITED_LATEX = 'e^{i\\pi}+2=0'

const test = base.extend<{ electronApp: ElectronApplication; mainWindow: Page }>({
  electronApp: async ({}, use, testInfo) => {
    const profileRoot = testInfo.outputPath('profile')
    const env = { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profileRoot } as Record<string, string>
    delete env.ELECTRON_RENDERER_URL
    try {
      const app = await electron.launch({ args: ['.'], env, timeout: 60_000 })
      try {
        await use(app)
      } finally {
        await app.close()
      }
    } finally {
      await rm(profileRoot, { recursive: true, force: true, maxRetries: 3 })
    }
  },
  mainWindow: async ({ electronApp }, use) => {
    const page = await electronApp.waitForEvent('window', {
      predicate: async (window) => (await window.title()) === 'Cherry Studio',
      timeout: 60_000
    })
    const shell = uiLocator(page, 'app.shell').first()
    const onboarding = page.locator('[data-onboarding-language-select]')
    await expect(shell.or(onboarding).first()).toBeVisible({ timeout: 60_000 })
    const language = await page.evaluate(async (privacyPolicyVersion) => {
      await window.api.preference.set('app.language', 'en-US')
      await window.api.preference.set('app.privacy.policy_version', privacyPolicyVersion)
      await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
      return await window.api.preference.get('app.language')
    }, LATEST_PRIVACY_POLICY_VERSION)
    expect(language).toBe('en-US')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(shell).toBeVisible({ timeout: 60_000 })
    await use(page)
  }
})

test.setTimeout(180_000)

async function openChat(page: Page) {
  await page.getByRole('button', { name: enUs['common.chat'], exact: true }).first().click()
  const composer = uiLocator(page, 'chat.composer').first()
  await expect(composer).toBeVisible({ timeout: 60_000 })
  return composer.locator('[contenteditable="true"]').first()
}

async function openAppearance(page: Page) {
  await page.getByRole('button', { name: enUs['settings.title'], exact: true }).first().click()
  const navigation = uiLocator(page, 'settings.navigation').first()
  await expect(navigation).toBeVisible({ timeout: 60_000 })
  await navigation
    .locator('[data-slot="menu-item"]')
    .filter({ hasText: enUs['settings.appearance.title'] })
    .first()
    .click()
  await expect(uiLocator(page, 'settings.content').first()).toBeVisible({ timeout: 60_000 })
  return page.getByRole('switch', { name: enUs['settings.messages.input.rich_text_math_enabled'], exact: true })
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function attachText(testInfo: TestInfo, name: string, text: string) {
  const path = testInfo.outputPath(`${name}.txt`)
  await writeFile(path, text)
  await testInfo.attach(name, { path, contentType: 'text/plain' })
}

test('keeps raw LaTeX until the composer math preview is enabled', async ({ mainWindow: page }, testInfo) => {
  const mathSwitch = await openAppearance(page)
  await expect(mathSwitch).toBeVisible({ timeout: 60_000 })
  await expect(mathSwitch).toHaveAttribute('aria-checked', 'false')
  await mathSwitch.scrollIntoViewIfNeeded()
  await attachScreenshot(page, testInfo, 'setting-off')

  await page.getByRole('button', { name: enUs['common.back'], exact: true }).first().click()
  const editor = await openChat(page)
  await editor.click()
  await editor.pressSequentially(SOURCE)
  await expect(editor.getByTestId('composer-inline-math')).toHaveCount(0)
  await expect(editor).toContainText(SOURCE)
  await attachText(testInfo, 'raw-source', await editor.innerText())
  await attachScreenshot(page, testInfo, 'raw-source')
})

test('renders an inline formula and edits its source', async ({ electronApp, mainWindow: page }, testInfo) => {
  const mathSwitch = await openAppearance(page)
  await expect(mathSwitch).toBeVisible({ timeout: 60_000 })
  await expect(mathSwitch).toHaveAttribute('aria-checked', 'false')
  await mathSwitch.click()
  await expect(mathSwitch).toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => window.api.preference.get('chat.input.rich_text_math_enabled'))).toBe(true)
  await attachScreenshot(page, testInfo, 'setting-on')

  await page.getByRole('button', { name: enUs['common.back'], exact: true }).first().click()
  const editor = await openChat(page)
  await editor.click()
  await editor.pressSequentially(SOURCE)
  const mathNode = editor.getByTestId('composer-inline-math')
  await expect(mathNode).toBeVisible({ timeout: 30_000 })
  // KaTeX's rendering marker distinguishes the preview from the raw-source fallback.
  await expect(mathNode.locator('.katex').first()).toBeVisible({ timeout: 30_000 })
  await expect(mathNode).toHaveAttribute('data-latex', LATEX)

  await editor.press('Home')
  await editor.pressSequentially('Euler: ')
  await expect(editor).toContainText('Euler: ')
  await expect(mathNode).toBeVisible()
  await attachText(testInfo, 'editor-innertext', await editor.innerText())
  await attachScreenshot(page, testInfo, 'math-rendered')

  await editor.press('ControlOrMeta+a')
  await editor.press('ControlOrMeta+c')
  const clipboardText = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(clipboardText).toContain(`Euler: ${SOURCE}`)
  await attachText(testInfo, 'clipboard', clipboardText)

  await mathNode.click()
  const dialog = page.getByRole('dialog', { name: enUs['chat.input.math.edit'], exact: true })
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  const sourceInput = dialog.getByRole('textbox', { name: enUs['chat.input.math.source'], exact: true })
  await expect(sourceInput).toHaveValue(LATEX)
  await attachScreenshot(page, testInfo, 'source-panel')

  await sourceInput.fill(EDITED_LATEX)
  await dialog.getByRole('button', { name: enUs['common.confirm'], exact: true }).click()
  await expect(mathNode).toHaveAttribute('data-latex', EDITED_LATEX, { timeout: 30_000 })
  await expect(dialog).toBeHidden()
  await attachScreenshot(page, testInfo, 'edited')

  await mathNode.click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  const box = await mathNode.boundingBox()
  if (!box) throw new Error('Math node lost its box')
  await page.mouse.click(box.x + box.width + 2, box.y + box.height / 2)
  await page.keyboard.press('Backspace')
  await expect(mathNode).toHaveCount(0, { timeout: 15_000 })
  await attachScreenshot(page, testInfo, 'after-backspace')

  await editor.click()
  await editor.press('ControlOrMeta+a')
  await editor.press('Backspace')
  await editor.pressSequentially('off test $x^2$ end')
  await expect(mathNode).toBeVisible({ timeout: 30_000 })
  const offSwitch = await openAppearance(page)
  await offSwitch.click()
  await expect(offSwitch).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: enUs['common.back'], exact: true }).first().click()
  await expect(uiLocator(page, 'chat.composer').first()).toBeVisible({ timeout: 60_000 })
  await expect(mathNode).toHaveCount(0, { timeout: 30_000 })
  await expect(editor).toHaveText('off test $x^2$ end')
  await attachText(testInfo, 'off-state-text', await editor.innerText())
  await attachScreenshot(page, testInfo, 'setting-off-collapsed')
})
