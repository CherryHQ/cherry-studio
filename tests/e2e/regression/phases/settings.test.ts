import { writeFile } from 'node:fs/promises'

import { languageNativeNameMap } from '@shared/utils/languages'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { expect, test } from '../fixture'
import { selectSidebarApp } from '../helpers/navigation'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import { fontsAndZoom } from '../scenarios/fontsAndZoom'
import { networkProxySettings } from '../scenarios/networkProxySettings'

test(...caseDefinition('MP-06'), async ({ app }, testInfo) => {
  let page = await app.mainWindow()
  const readSettings = () =>
    page.evaluate(async () => ({
      theme: await window.api.preference.get('ui.theme_mode'),
      language: await window.api.preference.get('app.language'),
      onClose: await window.api.preference.get('app.tray.on_close'),
      tray: await window.api.preference.get('app.tray.enabled'),
      privacy: await window.api.preference.get('app.privacy.policy_version'),
      onboarding: await window.api.preference.get('app.onboarding.provider_setup.status')
    }))
  const original = await readSettings()
  await testInfo.attach('MP-06 original settings', {
    body: JSON.stringify(original, null, 2),
    contentType: 'application/json'
  })
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const navigation = () => page.locator('[data-ui~="settings.navigation"]')
  const content = () => page.locator('[data-ui~="settings.content"]')
  const languagePicker = () => page.locator('#setting-appearance-display-language').getByRole('combobox')
  const closeSwitch = () => page.locator('#setting-general-tray-onclose').getByRole('switch')
  const errors: string[] = []
  let section = 'setup'
  const watchErrors = () => page.on('pageerror', (error) => errors.push(`${section}: ${error.message}`))
  watchErrors()
  const assertNoBrokenText = async () => {
    const text = await page.locator('[data-ui~="settings.view"]').innerText()
    expect(text).not.toMatch(
      /\b(?:settings|common|languages|title)\.[\w.]+|\[to be translated\]|undefined|\[object Object\]/
    )
    const emptyLabels = await page.locator('[data-ui~="settings.view"]').evaluate(
      (root) =>
        Array.from(root.querySelectorAll('[data-slot="menu-item"], [id^="setting-"]')).filter((element) => {
          if (!element.getClientRects().length) return false
          return !(element as HTMLElement).innerText.trim()
        }).length
    )
    expect(emptyLabels, 'Visible settings rows and navigation labels must not be blank').toBe(0)
  }
  const assertTheme = async (dark: boolean) => {
    // The root dark marker controls the application's documented light/dark rendering.
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(dark)
  }

  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'app.language': 'en-US',
        'app.onboarding.provider_setup.status': 'skipped'
      })
    )
    const privacy = page.getByRole('button', { name: 'Accept and Continue', exact: true })
    if (
      await privacy
        .waitFor({ state: 'visible', timeout: 2_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await privacy.click()
    }
    await selectSidebarApp(page, 'Chat')
    await test.step('Dark theme applies immediately on the main screen', async () => {
      section = 'Appearance / Theme'
      await openSettingsSection(page, 'Appearance')
      await page.getByRole('button', { name: 'Dark', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(async () => (await readSettings()).theme).toBe('dark')
      await closeSettings(page)
      await expect(page.locator('[data-ui~="chat.view"]:visible')).toBeVisible()
      await assertTheme(true)
      await screenshot('MP-06 dark main window immediately')
    })
    await test.step('Minimize to Tray on Close applies immediately', async () => {
      section = 'General / Startup and tray'
      await openSettingsSection(page, 'General')
      await expect(content().getByText('Startup and tray', { exact: true })).toBeVisible()
      await closeSwitch().setChecked(true)
      await expect(closeSwitch()).toBeChecked()
      await expect.poll(async () => (await readSettings()).onClose).toBe(true)
      await expect.poll(async () => (await readSettings()).tray).toBe(true)
      await screenshot('MP-06 minimize to tray enabled')
    })
    await test.step('Thai translates the sidebar and settings before returning to English', async () => {
      section = 'Appearance / Display & Language / Thai'
      await openSettingsSection(page, 'Appearance')
      await languagePicker().click()
      const thai = page.getByRole('option', { name: /Thai|ไทย/ })
      const available = await thai.count()
      await screenshot('MP-06 display language options')
      expect.soft(available, 'Display & Language must offer Thai (ไทย)').toBe(1)
      if (available !== 1) {
        await testInfo.attach('MP-06 missing Thai language', {
          body: await page.getByRole('listbox').innerText(),
          contentType: 'text/plain'
        })
        await page.keyboard.press('Escape')
        return
      }
      await thai.click()
      await expect.poll(async () => (await readSettings()).language).toBe('th-TH')
      await expect(navigation()).toContainText(/[\u0e00-\u0e7f]/)
      await expect(content()).toContainText(/[\u0e00-\u0e7f]/)
      await expect(navigation().getByText('Appearance', { exact: true })).toHaveCount(0)
      await assertNoBrokenText()
      await screenshot('MP-06 Thai settings and sidebar')
      await page
        .getByRole('button', { name: /Back|กลับ|ย้อนกลับ/, exact: true })
        .first()
        .click()
      await expect(page.locator('[data-ui~="app.shell"]').first()).toContainText(/[\u0e00-\u0e7f]/)
      await screenshot('MP-06 Thai main sidebar')
      await page
        .getByRole('button', { name: /Settings|ตั้งค่า|การตั้งค่า/, exact: true })
        .first()
        .click()
      await navigation().getByText('ลักษณะที่ปรากฏ', { exact: true }).click()
      await languagePicker().click()
      await page.getByRole('option', { name: /English/ }).click()
      await expect(navigation().getByText('Appearance', { exact: true })).toBeVisible()
      await expect.poll(async () => (await readSettings()).language).toBe('en-US')
      await assertNoBrokenText()
    })
    await test.step('Restart preserves theme, close preference and English', async () => {
      section = 'restart'
      const before = await readSettings()
      expect(before).toMatchObject({ theme: 'dark', language: 'en-US', onClose: true, tray: true })
      page = await app.restart()
      watchErrors()
      await expect.poll(readSettings).toEqual(before)
      await assertTheme(true)
      await openSettingsSection(page, 'Appearance')
      await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(languagePicker()).toContainText('English')
      await openSettingsSection(page, 'General')
      await expect(closeSwitch()).toBeChecked()
      await screenshot('MP-06 persisted settings after restart')
    })
    await test.step('Every settings section opens without blank content or error overlays', async () => {
      const items = navigation().locator('[data-slot="menu-item"]')
      const names = await items.evaluateAll((items) => items.map((item) => (item as HTMLElement).innerText.trim()))
      expect(names).toEqual(
        expect.arrayContaining([
          'Model Provider',
          'Default Model',
          'Web Search',
          'MCP',
          'Skills',
          'Voice',
          'Computer Use',
          'Data',
          'Usage',
          'About & Feedback'
        ])
      )
      await testInfo.attach('MP-06 settings menu groups and sections', {
        body: await navigation().innerText(),
        contentType: 'text/plain'
      })
      for (const [index, name] of names.entries()) {
        await test.step(name, async () => {
          section = name
          try {
            await items.nth(index).click()
            await expect(items.nth(index)).toHaveAttribute('data-active', 'true', { timeout: 5_000 })
            await expect(content()).toBeVisible()
            await expect
              .poll(async () => (await content().innerText()).trim().length, { timeout: 10_000 })
              .toBeGreaterThan(10)
            await expect(
              page.getByText(/Something went wrong|An unexpected error|Application error|出了点问题/i)
            ).toHaveCount(0)
            await assertNoBrokenText()
          } catch (error) {
            expect.soft(false, `${name}: ${String(error)}`).toBe(true)
          } finally {
            await screenshot(`MP-06 section ${index + 1} ${name.replaceAll('/', '-')}`)
          }
        })
      }
      expect.soft(errors, 'Renderer exceptions by settings section').toEqual([])
    })
  } finally {
    section = 'restore original settings'
    try {
      await page.keyboard.press('Escape')
      await page.evaluate(async (original) => {
        await window.api.preference.setMultiple({
          'app.language': 'en-US',
          'ui.theme_mode': original.theme,
          'app.tray.on_close': original.onClose,
          'app.tray.enabled': original.tray
        })
      }, original)
      await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
      await openSettingsSection(page, 'General')
      await expect(closeSwitch()).toBeChecked({ checked: original.onClose })
      await screenshot('MP-06 original tray setting restored')
      await openSettingsSection(page, 'Appearance')
      const themeIndex = { light: 0, dark: 1, system: 2 }[original.theme]
      await expect(page.locator('#setting-appearance-theme-mode').getByRole('button').nth(themeIndex)).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await page.evaluate((language) => window.api.preference.set('app.language', language), original.language)
      await expect(page.locator('html')).toHaveAttribute(
        'lang',
        original.language ?? (await page.evaluate(() => navigator.language))
      )
      if (original.language) {
        await expect(languagePicker()).toHaveAccessibleName(languageNativeNameMap[original.language])
      }
      const expectedDark =
        original.theme === 'dark' ||
        (original.theme === 'system' && (await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)))
      await assertTheme(expectedDark)
      await screenshot('MP-06 original settings restored')
    } finally {
      await page.evaluate(
        (original) =>
          window.api.preference.setMultiple({
            'ui.theme_mode': original.theme,
            'app.language': original.language,
            'app.tray.on_close': original.onClose,
            'app.tray.enabled': original.tray,
            'app.privacy.policy_version': original.privacy,
            'app.onboarding.provider_setup.status': original.onboarding
          }),
        original
      )
      await expect.poll(readSettings).toEqual(original)
    }
  }
})

test(...caseDefinition('MP-104'), async ({ mainWindow: page }, testInfo) => {
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const language = await page.evaluate(() => window.api.preference.get('app.language'))
  await selectSidebarApp(page, 'Settings')

  try {
    await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
    const settings = page.locator('[data-ui~="settings.view"]:visible')
    const navigation = settings.locator('[data-ui~="settings.navigation"]')
    const content = settings.locator('[data-ui~="settings.content"]')
    await expect(navigation.getByRole('button', { name: '模型服务', exact: true })).toBeVisible()

    // Soft checks preserve every requirement while allowing later steps to collect independent evidence.
    for (const group of ['效率', '偏好', '工具', '系统']) {
      await expect.soft(navigation.getByText(group, { exact: true })).toBeVisible({ timeout: 3_000 })
    }
    for (const section of ['模型服务', '数据', '快捷键', '关于我们']) {
      await expect(navigation.getByRole('button', { name: section, exact: true })).toBeVisible()
    }
    await attachScreenshot('MP-104 settings navigation groups')

    await navigation.getByRole('button', { name: '搜索设置', exact: true }).click()
    await navigation.getByRole('combobox', { name: '搜索设置', exact: true }).fill('代理')
    const results = content.getByRole('listbox', { name: '设置搜索结果', exact: true })
    const proxyResult = results.getByRole('option').filter({ hasText: '代理模式' })
    await expect(proxyResult).toHaveCount(1)
    await expect(proxyResult).toBeVisible()
    await attachScreenshot('MP-104 proxy search result')
    await proxyResult.click()
    const proxy = content.locator('#setting-general-proxy-mode')
    await expect(proxy).toContainText('代理模式')
    await expect(proxy).toBeInViewport()
    // Search jumps promise a transient visual highlight on the destination row.
    await expect(proxy).toHaveClass(/\bsearch-hit-highlight\b/)
    await expect(navigation.getByRole('button', { name: '通用', exact: true })).toHaveAttribute('data-active', 'true')
    await expect(results).toBeHidden()
    await attachScreenshot('MP-104 proxy destination highlighted')

    const sections = [
      { name: '模型服务', marker: content.getByPlaceholder('搜索模型平台...', { exact: true }) },
      { name: '数据', marker: content.getByText('数据', { exact: true }).first() },
      { name: '快捷键', marker: content.getByRole('heading', { name: '快捷键', exact: true }) },
      { name: '关于我们', marker: content.getByText('关于我们', { exact: true }) },
      { name: '外观', marker: content.locator('#setting-appearance-theme-mode') }
    ]
    let previous = proxy
    for (const section of sections) {
      await navigation.getByRole('button', { name: section.name, exact: true }).click()
      await expect(section.marker).toBeVisible()
      await expect(previous).toBeHidden()
      await expect(navigation.getByRole('button', { name: section.name, exact: true })).toHaveAttribute(
        'data-active',
        'true'
      )
      await expect(navigation.locator('[data-slot="menu-item"][data-active="true"]')).toHaveCount(1)
      await expect(page.locator('[data-slot="page-side-panel"][role="dialog"]:visible')).toHaveCount(0)
      previous = section.marker
    }
    await page.getByRole('button', { name: '返回', exact: true }).first().click()
    await expect(settings).toBeHidden()
    await expect(page.locator('[data-ui~="chat.view"]:visible')).toBeVisible()
    await attachScreenshot('MP-104 return to chat')

    await page.evaluate(() => window.api.preference.set('app.language', 'en-US'))
    await selectSidebarApp(page, 'Settings')
    await page.evaluate(() => window.api.preference.set('app.language', 'zh-CN'))
    await navigation.getByRole('button', { name: '搜索设置', exact: true }).click()
    await navigation.getByRole('combobox', { name: '搜索设置', exact: true }).fill('MP104不存在的设置zzzz314159')
    await expect(content.getByText('没有匹配的设置', { exact: true })).toBeVisible()
    await expect(content.getByRole('option')).toHaveCount(0)
    await attachScreenshot('MP-104 no matching settings')
  } finally {
    await page.evaluate((language) => window.api.preference.set('app.language', language), language)
  }
})

test(...caseDefinition('MP-106'), async ({ app, mainWindow }, testInfo) => {
  await fontsAndZoom(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-112'), async ({ app, mainWindow }, testInfo) => {
  await networkProxySettings(app, mainWindow, testInfo)
})
