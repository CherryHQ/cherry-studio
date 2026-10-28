import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Locator, Page, TestInfo } from '@playwright/test'
import type { TiptapEditorHTMLElement } from '@tiptap/core'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import { uiSelector } from '../../../src/renderer/utils/uiContract'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { formatShortcutDisplay } from '../../../src/shared/utils/shortcut'
import { selectSidebarApp } from '../regression/navigation'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend<{
  historySession: { app: ElectronApplication; relaunch: () => Promise<ElectronApplication> }
}>({
  historySession: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const launch = () =>
      electron.launch({
        args: ['.'],
        env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
        timeout: 60000
      })
    let app = await launch()
    try {
      await use({
        app,
        relaunch: async () => {
          await app.close()
          app = await launch()
          return app
        }
      })
    } finally {
      try {
        await app.close()
      } finally {
        await rm(profile, { recursive: true, force: true })
      }
    }
  }
})

async function mainPage(app: ElectronApplication): Promise<Page> {
  await expect
    .poll(
      async () => {
        const titles = await Promise.all(app.windows().map((page) => page.title()))
        return titles.includes('Cherry Studio')
      },
      { timeout: 60000 }
    )
    .toBe(true)
  for (const page of app.windows()) {
    if ((await page.title()) === 'Cherry Studio') {
      await page.waitForSelector('#root', { state: 'attached' })
      return page
    }
  }
  throw new Error('Main window disappeared')
}

async function chatEditor(page: Page) {
  await selectSidebarApp(page, 'Chat')
  const input = page
    .locator(uiSelector({ parts: ['composer-input'] }))
    .filter({ visible: true })
    .first()
  await input.click()
  const editor = input.locator('[contenteditable="true"]')
  await expect(editor).toBeVisible()
  await expect(editor).toBeEditable()
  await editor.click()
  await expect(editor).toBeFocused()
  return editor
}

async function placeCaretAtEnd(editor: Locator) {
  await editor.click()
  await editor.evaluate((element) => {
    const instance = (element as TiptapEditorHTMLElement).editor!
    instance.commands.focus('end')
  })
  await expect
    .poll(() =>
      editor.evaluate((element) => {
        const instance = (element as TiptapEditorHTMLElement).editor!
        const { from, to, empty } = instance.state.selection
        return empty && to === from && from === Math.max(1, instance.state.doc.content.size - 1)
      })
    )
    .toBe(true)
}

async function attachScreenshot(page: Page, name: string, testInfo: TestInfo) {
  await page.bringToFront()
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  const screenshot = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshot })
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' })
}

async function chooseRecall(page: Page, label: string, value: 'ctrl_arrow' | 'off', testInfo: TestInfo) {
  const sidebar = page.locator('[data-ui~="app.sidebar"]').filter({ visible: true })
  await sidebar.getByRole('button', { name: en['settings.title'], exact: true }).click()
  const settings = page.locator('[data-ui~="settings.view"]').filter({ visible: true })
  const navigation = settings.locator('[data-ui~="settings.navigation"]')
  await navigation.getByRole('button', { name: en['settings.appearance.title'], exact: true }).click()
  await navigation.getByRole('button', { name: en['settings.search.placeholder'], exact: true }).click()
  const search = navigation.getByRole('combobox', { name: en['settings.search.placeholder'], exact: true })
  await search.fill('Input history recall')
  await settings
    .getByRole('option')
    .filter({ has: page.getByText('Input history recall', { exact: true }) })
    .click()
  const row = page.locator('#setting-appearance-history-recall').filter({ visible: true })
  await expect(row).toBeVisible()
  await row.getByRole('combobox').click()
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.api.preference.get('chat.input.history_recall'))).toBe(value)
  if (value === 'ctrl_arrow') {
    await attachScreenshot(page, 'history-recall-setting', testInfo)
  }
}

test('composer history recall policy, draft protection, live changes and profile persistence', async ({
  historySession
}, testInfo) => {
  test.setTimeout(180000)
  let page = await mainPage(historySession.app)
  await page.evaluate(async (version) => {
    await window.api.preference.set('app.language', 'en-US')
    await window.api.preference.set('app.privacy.policy_version', version)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
  }, LATEST_PRIVACY_POLICY_VERSION)
  await page.reload()
  let editor = await chatEditor(page)
  await expect(editor).toHaveText('')
  // The app flushes its in-memory persist cache from `beforeunload` when a write is still
  // pending; seeding while such a write is in flight loses the seed. Let it settle first.
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const cache = JSON.parse(localStorage.getItem('cs_cache_persist') ?? '{}')
    cache['ui.composer.input_history'] = ['history newest 22781', 'history older 22781']
    localStorage.setItem('cs_cache_persist', JSON.stringify(cache))
  })
  await page.reload()
  editor = await chatEditor(page)
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('cs_cache_persist') ?? '{}')['ui.composer.input_history'])
    )
    .toEqual(['history newest 22781', 'history older 22781'])
  for (const [key, text] of [
    ['ArrowUp', 'history newest 22781'],
    ['ArrowUp', 'history older 22781'],
    ['ArrowDown', 'history newest 22781'],
    ['ArrowDown', '']
  ]) {
    await editor.press(key)
    await expect(editor).toHaveText(text)
  }
  const primary = process.platform === 'darwin' ? 'Meta' : 'Control'
  const primaryLabel = `${formatShortcutDisplay(['CommandOrControl', 'Up'], process.platform === 'darwin')} / ${formatShortcutDisplay(['CommandOrControl', 'Down'], process.platform === 'darwin')}`
  await chooseRecall(page, primaryLabel, 'ctrl_arrow', testInfo)
  editor = await chatEditor(page)
  await editor.press('ArrowUp')
  await expect(editor).toHaveText('')
  await editor.press(`${primary}+ArrowUp`)
  await expect(editor).toHaveText('history newest 22781')
  await attachScreenshot(page, 'history-recall-recalled', testInfo)
  await editor.press(`${primary}+ArrowDown`)
  await expect(editor).toHaveText('')
  const draft = 'interior draft 22781'
  await editor.fill(draft)
  await editor.evaluate((element) => {
    const instance = (element as TiptapEditorHTMLElement).editor!
    instance.commands.setTextSelection(5)
  })
  await expect
    .poll(() =>
      editor.evaluate((element) => {
        const { from, to, empty } = (element as TiptapEditorHTMLElement).editor!.state.selection
        return { from, to, empty }
      })
    )
    .toEqual({ from: 5, to: 5, empty: true })
  await editor.press(`${primary}+ArrowUp`)
  await expect(editor).toHaveText(draft)
  await editor.evaluate((element) => (element as TiptapEditorHTMLElement).editor!.commands.selectAll())
  await expect
    .poll(() =>
      editor.evaluate((element) => {
        const instance = (element as TiptapEditorHTMLElement).editor!
        return (
          !instance.state.selection.empty &&
          instance.state.selection.from <= 1 &&
          instance.state.selection.to >= instance.state.doc.content.size - 1
        )
      })
    )
    .toBe(true)
  await editor.press(`${primary}+ArrowUp`)
  await expect(editor).toHaveText('history newest 22781')
  await editor.press(`${primary}+ArrowDown`)
  await expect(editor).toHaveText(draft)
  await editor.fill('')
  await chooseRecall(page, en['settings.messages.input.history_recall_off'], 'off', testInfo)
  editor = await chatEditor(page)
  const originalNode = await editor.elementHandle()
  for (const key of ['ArrowUp', `${primary}+ArrowUp`]) {
    await editor.press(key)
    await expect(editor).toHaveText('')
  }
  const setMode = async (value: 'ctrl_arrow' | 'off') => {
    await page.evaluate((mode) => window.api.preference.set('chat.input.history_recall', mode), value)
    await expect.poll(() => page.evaluate(() => window.api.preference.get('chat.input.history_recall'))).toBe(value)
    await expect
      .poll(() =>
        originalNode!.evaluate(
          (element) =>
            element.isConnected &&
            element === document.querySelector('[data-ui~="part:composer-input"] [contenteditable="true"]')
        )
      )
      .toBe(true)
    // Let the preference subscription commit before delivering a key to the retained handler.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    )
  }
  await setMode('ctrl_arrow')
  await editor.press(`${primary}+ArrowUp`)
  await expect(editor).toHaveText('history newest 22781')
  await setMode('off')
  for (const key of ['ArrowDown', 'ArrowUp', `${primary}+ArrowDown`, `${primary}+ArrowUp`]) {
    await editor.press(key)
    await expect(editor).toHaveText('history newest 22781')
  }
  await setMode('ctrl_arrow')
  await placeCaretAtEnd(editor)
  await editor.press(`${primary}+ArrowDown`)
  await expect(editor).toHaveText('')
  await attachScreenshot(page, 'history-recall-live', testInfo)
  page = await mainPage(await historySession.relaunch())
  await expect
    .poll(() => page.evaluate(() => window.api.preference.get('chat.input.history_recall')))
    .toBe('ctrl_arrow')
  editor = await chatEditor(page)
  await expect(editor).toHaveText('')
  await editor.press('ArrowUp')
  await expect(editor).toHaveText('')
  await editor.press(`${primary}+ArrowUp`)
  await expect(editor).toHaveText('history newest 22781')
  await editor.press(`${primary}+ArrowDown`)
  await expect(editor).toHaveText('')
})
