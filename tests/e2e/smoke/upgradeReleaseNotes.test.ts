import { rm, writeFile } from 'node:fs/promises'

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { inc } from 'semver'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import zh from '../../../src/renderer/i18n/locales/zh-cn.json'
import { ThemeMode } from '../../../src/shared/data/preference/preferenceTypes'
import { IpcChannel } from '../../../src/shared/IpcChannel'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import type { ReleaseNotesEntry } from '../../../src/shared/utils/releaseNotes'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const app = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
      timeout: 60000
    })
    try {
      await use(app)
    } finally {
      await app.close()
      await rm(profile, { recursive: true, force: true })
    }
  }
})

async function serveHistory(app: ElectronApplication, releases: ReleaseNotesEntry[] | null) {
  await app.evaluate(({ net }, entries) => {
    const fetch = net.fetch.bind(net)
    net.fetch = async (input, options) => {
      if (String(input) === 'https://releases.cherry-ai.com/release-history.json') {
        if (entries === null) throw new Error('History unavailable for test')
        return new Response(JSON.stringify(entries), { headers: { 'content-type': 'application/json' } })
      }
      return fetch(input, options)
    }
  }, releases)
}

const bilingual = (english: string, chinese: string) =>
  `<!--LANG:en-->${english}<!--LANG:zh-CN-->${chinese}<!--LANG:END-->`

async function saveWindowScreenshot(app: ElectronApplication, page: Page, filename: string) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {}))
    )
  })
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Cherry Studio')!
    return (await window.webContents.capturePage()).toPNG().toString('base64')
  })
  await writeFile(filename, Buffer.from(png, 'base64'))
}

test('shows a collapsed version timeline for the upgrade range in About and the install dialog, including failure and retry', async ({
  electronApp,
  mainWindow
}, testInfo) => {
  test.setTimeout(120000)
  const installed = await electronApp.evaluate(({ app }) => app.getVersion())
  const intermediate = inc(installed, 'patch')!
  const target = inc(intermediate, 'patch')!
  const newer = inc(target, 'patch')!
  const releases = [
    { version: installed, releaseNotes: bilingual('Already installed', '已安装的内容') },
    {
      version: intermediate,
      releaseNotes: bilingual('New Features\n- Intermediate feature', '新功能\n- 中间版本功能')
    },
    {
      version: target,
      releaseNotes: bilingual(
        'Important\n- Restart required\n\nNew Features\n- First[^1]\n- Second\n- Third\n- Fourth\n\n[^1]: Feature details',
        '重要提示\n- 需要重启\n\n新功能\n- 第一项[^1]\n- 第二项\n- 第三项\n- 第四项\n\n[^1]: 功能说明'
      )
    },
    { version: newer, releaseNotes: bilingual('Beyond target', '目标之后的内容') }
  ]
  await serveHistory(electronApp, releases)
  await mainWindow.evaluate(async (policy) => {
    await window.api.preference.set('app.privacy.policy_version', policy)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
  }, LATEST_PRIVACY_POLICY_VERSION)
  await mainWindow.reload()
  const sidebar = mainWindow.locator('[data-ui~="app.sidebar"]').filter({ visible: true })
  await sidebar.getByRole('button', { name: en['settings.title'], exact: true }).click()
  const settings = mainWindow.locator('[data-ui~="settings.view"]').filter({ visible: true })
  await settings
    .locator('[data-ui~="settings.navigation"]')
    .getByRole('button', { name: en['settings.about.label'], exact: true })
    .click()
  const info = {
    version: target,
    releaseDate: '2026-10-31',
    files: [],
    path: '',
    sha512: '',
    releaseNotes: '- Old fix'
  }
  await electronApp.evaluate(
    ({ BrowserWindow }, { channel, info }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Cherry Studio')!
      window.webContents.send(channel, 'app.updater.available', info)
      window.webContents.send(channel, 'app.updater.downloaded', info)
    },
    { channel: IpcChannel.IpcApi_Event, info }
  )
  await expect(settings.getByText(`${installed} → ${target}`)).toHaveCount(0)
  await expect(settings.getByRole('button', { name: `v${intermediate}`, exact: true })).toBeVisible()
  await expect(settings.getByText(/Versions loaded/)).toHaveCount(0)
  const targetRow = settings.getByRole('button', { name: `v${target}`, exact: true })
  const intermediateRow = settings.getByRole('button', { name: `v${intermediate}`, exact: true })
  await expect(targetRow).toHaveAttribute('aria-expanded', 'false')
  await expect(intermediateRow).toHaveAttribute('aria-expanded', 'false')
  await expect(settings.getByText('Restart required')).toHaveCount(0)
  await mainWindow.screenshot({ path: testInfo.outputPath('upgrade-notes-overview.png') })
  await targetRow.focus()
  await mainWindow.keyboard.press('Enter')
  await expect(targetRow).toHaveAttribute('aria-expanded', 'true')
  await expect(settings.getByText('Fourth', { exact: true })).toBeVisible()
  await intermediateRow.click()
  await expect(settings.getByText('Intermediate feature', { exact: true })).toBeVisible()
  await expect(targetRow).toHaveAttribute('aria-expanded', 'true')
  await expect(settings.getByText('Already installed', { exact: true })).toHaveCount(0)
  await expect(settings.getByText('Beyond target', { exact: true })).toHaveCount(0)
  await targetRow.click()
  await expect(settings.getByText('Fourth', { exact: true })).toHaveCount(0)
  await expect(settings.getByText('Intermediate feature', { exact: true })).toBeVisible()

  const corrected = [{ version: target, releaseNotes: bilingual('- New fix', '- 新的修复') }]
  await serveHistory(electronApp, corrected)
  await settings.getByRole('button', { name: en['settings.about.checkUpdate.available'], exact: true }).click()
  const singleDialog = mainWindow.getByRole('dialog', { name: en['update.title'], exact: true })
  await expect(singleDialog.getByText('New fix', { exact: true })).toBeVisible()
  await expect(singleDialog.getByText('Old fix', { exact: true })).toHaveCount(0)
  await expect(singleDialog.getByRole('button', { name: `v${target}`, exact: true })).toHaveCount(0)
  await expect(singleDialog.getByText(/Versions loaded|Current version/)).toHaveCount(0)
  await expect(singleDialog.getByText(`${installed} → ${target}`)).toHaveCount(0)
  await saveWindowScreenshot(electronApp, mainWindow, testInfo.outputPath('upgrade-notes-single.png'))
  await singleDialog.getByRole('button', { name: en['update.later'], exact: true }).click()
  await expect(singleDialog).toHaveCount(0)

  await serveHistory(electronApp, null)
  await settings.getByRole('button', { name: en['settings.about.checkUpdate.available'], exact: true }).click()
  const dialog = mainWindow.getByRole('dialog', { name: en['update.title'], exact: true })
  await expect(dialog.getByText(en['update.history.unavailable'])).toBeVisible()
  await expect(dialog.getByText('Old fix')).toBeVisible()
  const install = dialog.getByRole('button', { name: en['update.install'], exact: true })
  await expect(install).toBeEnabled()
  await serveHistory(electronApp, corrected)
  await dialog.getByRole('button', { name: en['common.retry'], exact: true }).click()
  await expect(dialog.getByText('New fix', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Old fix', { exact: true })).toHaveCount(0)
  await expect(install).toBeEnabled()
  await dialog.getByRole('button', { name: en['update.later'], exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await serveHistory(electronApp, releases)
  await expect(async () => {
    await settings.getByRole('button', { name: en['settings.about.checkUpdate.available'], exact: true }).click()
    await expect(dialog).toBeVisible({ timeout: 500 })
  }).toPass({ intervals: [2100], timeout: 7000 })
  await expect(dialog.getByRole('button', { name: `v${intermediate}`, exact: true })).toBeVisible()
  await expect(dialog.getByText(/Versions loaded/)).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: `v${target}`, exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await dialog.getByRole('button', { name: `v${target}`, exact: true }).click()
  await expect(dialog.getByText('Fourth', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: `v${intermediate}`, exact: true })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(install).toBeEnabled()
  const reference = dialog.locator('a[data-footnote-ref]').first()
  await reference.focus()
  await mainWindow.keyboard.press('Enter')
  const footnote = dialog.locator('[data-footnotes] li').first()
  await expect(footnote).toBeFocused()
  await footnote.locator('a[data-footnote-backref]').click()
  await expect(reference).toBeFocused()
  await mainWindow.evaluate(async () => {
    await window.api.preference.set('app.language', 'zh-CN')
  })
  await expect(mainWindow.getByRole('dialog').getByText('需要重启')).toBeVisible()
  await expect(mainWindow.getByRole('dialog').getByText('功能说明', { exact: false })).toBeVisible()
  await expect(mainWindow.getByRole('dialog').getByText('Feature details', { exact: false })).toHaveCount(0)
  await saveWindowScreenshot(electronApp, mainWindow, testInfo.outputPath('upgrade-notes-expanded.png'))
  await mainWindow
    .getByRole('dialog')
    .getByRole('button', { name: `v${target}`, exact: true })
    .click()
  await expect(mainWindow.getByRole('dialog').getByText('需要重启')).toHaveCount(0)
  await saveWindowScreenshot(electronApp, mainWindow, testInfo.outputPath('upgrade-notes-dialog.png'))
  await mainWindow
    .getByRole('dialog')
    .getByRole('button', { name: `v${target}`, exact: true })
    .click()
  await mainWindow
    .getByRole('dialog')
    .getByRole('button', { name: `v${intermediate}`, exact: true })
    .click()
  await expect(mainWindow.getByRole('dialog').getByText('中间版本功能')).toBeVisible()

  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Cherry Studio')!
    window.setSize(1000, 900)
    window.webContents.setZoomFactor(2)
  })
  await expect.poll(() => mainWindow.evaluate(() => innerWidth)).toBeLessThanOrEqual(500)
  for (const theme of [ThemeMode.light, ThemeMode.dark]) {
    await mainWindow.evaluate(async (value) => window.api.preference.set('ui.theme_mode', value), theme)
    await expect
      .poll(() => mainWindow.evaluate(() => document.body.classList.contains('dark')))
      .toBe(theme === ThemeMode.dark)
    const button = mainWindow.getByRole('dialog').getByRole('button', { name: zh['update.install'], exact: true })
    await expect(button).toBeInViewport()
    await button.focus()
    await mainWindow.keyboard.press('Tab')
    await mainWindow.keyboard.press('Shift+Tab')
    await expect(button).toBeFocused()
    expect(await button.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
    await expect(button).toBeEnabled()
    expect(
      await button.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
      })
    ).toBe(true)
    expect(
      await mainWindow.getByRole('dialog').evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth
      })
    ).toBe(true)
    const screenshot = testInfo.outputPath(`upgrade-notes-${theme}-200.png`)
    await saveWindowScreenshot(electronApp, mainWindow, screenshot)
    await testInfo.attach(`${theme}-200-percent`, { path: screenshot, contentType: 'image/png' })
  }
})
