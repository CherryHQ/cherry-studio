import { execFileSync } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Request } from '@playwright/test'
import AdmZip from 'adm-zip'
import { parse } from 'yaml'

import { AssistantSchema } from '@shared/data/types/assistant'
import { createUniqueModelId } from '@shared/data/types/model'
import { TopicSchema } from '@shared/data/types/topic'
import type { IpcResult } from '@shared/ipc/errors/IpcError'
import { languageNativeNameMap } from '@shared/utils/languages'
import { formatShortcutDisplay } from '@shared/utils/shortcut'

import { caseDefinition } from '../../../../scripts/e2e/regression/cases'
import { getSensitiveConfigValues } from '../../../../scripts/e2e/regression/config'
import { isAlive } from '../../../../scripts/e2e/regression/process'
import { captureMaskedScreenshot } from '../../../../scripts/e2e/regression/screenshotEvidence'
import { saveNativeFile } from '../../../../scripts/e2e/regression/systemAutomation'
import { startMockChatServer } from '../../../helpers/http/mockChatServer'
import { startMockUpdateServer } from '../../../helpers/http/mockUpdateServer'
import { expect, test } from '../fixture'
import { sendChatMarker } from '../helpers/chat'
import { selectVisibleModel } from '../helpers/models'
import { selectSidebarApp, dismissOnboarding } from '../helpers/navigation'
import { closeSettings, openSettingsSection } from '../helpers/settings'
import { inspectStartup } from '../helpers/startupInspection'
import { revealVirtualized } from '../helpers/virtualList'
import { feishuChannelSettings } from '../scenarios/feishuChannelSettings'
import { fontsAndZoom } from '../scenarios/fontsAndZoom'
import { longUserMessageExpansion } from '../scenarios/longUserMessageExpansion'
import { networkProxySettings } from '../scenarios/networkProxySettings'
import { notificationSettings } from '../scenarios/notificationSettings'

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

test(...caseDefinition('MP-105'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const readAppearance = () =>
    page.evaluate(async () => ({
      theme: await window.api.preference.get('ui.theme_mode'),
      color: await window.api.preference.get('ui.theme_user.color_primary'),
      style: await window.api.preference.get('ui.window_style')
    }))
  const original = await readAppearance()
  const color = original.color.toUpperCase() === '#3B82F6' ? '#8B5CF6' : '#3B82F6'
  const rgb = color === '#3B82F6' ? 'rgb(59, 130, 246)' : 'rgb(139, 92, 246)'
  const finalTransparent = original.style !== 'transparent'
  const themeButton = (name: string) =>
    page.locator('#setting-appearance-theme-mode').getByRole('button', { name, exact: true })
  const transparentSwitch = () =>
    page
      .locator('[data-ui~="settings.content"] div')
      .filter({
        has: page.getByText('Transparent Window', { exact: true })
      })
      .filter({ has: page.getByRole('switch') })
      .last()
      .getByRole('switch')
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const errors: string[] = []
  const watchErrors = () => page.on('pageerror', (error) => errors.push(error.message))
  watchErrors()
  const assertStyle = async (transparent: boolean) => {
    await expect(transparentSwitch()).toBeChecked({ checked: transparent })
    await expect.poll(async () => (await readAppearance()).style).toBe(transparent ? 'transparent' : 'opaque')
    const shell = page.getByTestId('macos-traffic-light-drag-region').locator('..')
    if (transparent) {
      await expect(shell).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(page.locator('[data-ui~="settings.view"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    } else {
      await expect(shell).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(page.locator('[data-ui~="settings.view"]')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    }
  }
  const assertColor = async () => {
    await expect.poll(async () => (await readAppearance()).color.toUpperCase()).toBe(color)
    await expect(
      page.locator('#setting-appearance-theme-color-primary').getByRole('button', { name: color, exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(themeButton('System').locator(':scope > div')).toHaveCSS('border-top-color', rgb)
    await expect
      .soft(transparentSwitch(), 'Checked controls must use the selected primary color')
      .toHaveCSS('background-color', rgb, { timeout: 3_000 })
  }

  try {
    await openSettingsSection(page, 'Appearance')
    await transparentSwitch().setChecked(false)
    await assertStyle(false)
    for (const [name, mode] of [
      ['Dark', 'dark'],
      ['Light', 'light'],
      ['System', 'system']
    ] as const) {
      await test.step(`${name} applies without a blank frame`, async () => {
        const [frames] = await Promise.all([
          page.evaluate(async () => {
            const frames: { blank: boolean; dark: boolean; brightness: number }[] = []
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const context = canvas.getContext('2d')!
            const end = performance.now() + 900
            do {
              await new Promise(requestAnimationFrame)
              const surface = document.querySelector('[data-ui~="settings.view"]')
              const content = document.querySelector('[data-ui~="settings.content"]') as HTMLElement | null
              context.clearRect(0, 0, 1, 1)
              context.fillStyle = surface ? getComputedStyle(surface).backgroundColor : '#ffffff'
              context.fillRect(0, 0, 1, 1)
              const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data
              frames.push({
                blank: !content || !content.getClientRects().length || !content.innerText.trim(),
                dark: document.documentElement.classList.contains('dark'),
                brightness: alpha === 0 ? 255 : (r + g + b) / 3
              })
            } while (performance.now() < end)
            return frames
          }),
          themeButton(name).click()
        ])
        await expect(themeButton(name)).toHaveAttribute('aria-pressed', 'true')
        await expect.poll(async () => (await readAppearance()).theme).toBe(mode)
        const dark =
          mode === 'dark' ||
          (mode === 'system' && (await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)))
        await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(dark)
        expect(frames.length, 'Theme transition must produce observable frames').toBeGreaterThan(0)
        expect(
          frames.filter(({ blank }) => blank),
          'Settings must remain painted during theme changes'
        ).toEqual([])
        expect(
          frames.filter((frame) => frame.dark && frame.brightness > 128),
          'Dark frames must never flash a white background'
        ).toEqual([])
        expect(frames.at(-1)!.brightness, 'The rendered background must match the selected theme')[
          dark ? 'toBeLessThan' : 'toBeGreaterThan'
        ](128)
        await testInfo.attach(`MP-105 ${mode} transition frames`, {
          body: JSON.stringify(frames),
          contentType: 'application/json'
        })
        await screenshot(`MP-105 ${mode} theme`)
      })
    }
    await test.step('Primary color updates controls and selection highlights', async () => {
      await page
        .locator('#setting-appearance-theme-color-primary')
        .getByRole('button', { name: color, exact: true })
        .click()
      await transparentSwitch().setChecked(true)
      await assertStyle(true)
      await assertColor()
      await screenshot('MP-105 primary color and transparent window')
    })
    await test.step('Both window styles apply immediately', async () => {
      await transparentSwitch().setChecked(false)
      await assertStyle(false)
      await screenshot('MP-105 opaque window')
      await transparentSwitch().setChecked(finalTransparent)
      await assertStyle(finalTransparent)
    })
    await test.step('Restart preserves System theme, primary color and window style', async () => {
      const before = await readAppearance()
      expect(before).toEqual({ theme: 'system', color, style: finalTransparent ? 'transparent' : 'opaque' })
      const previousPid = app.record.electronPid
      page = await app.restart()
      watchErrors()
      expect(app.record.electronPid).not.toBe(previousPid)
      await expect.poll(readAppearance).toEqual(before)
      await openSettingsSection(page, 'Appearance')
      await expect(themeButton('System')).toHaveAttribute('aria-pressed', 'true')
      const systemDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(systemDark)
      await assertStyle(finalTransparent)
      // The checked switch is a colored control; restore the persisted state after checking its color.
      await transparentSwitch().setChecked(true)
      await assertColor()
      await transparentSwitch().setChecked(finalTransparent)
      await assertStyle(finalTransparent)
      await screenshot('MP-105 appearance retained after restart')
      expect(errors, 'Theme changes and restart must not cause renderer exceptions').toEqual([])
    })
  } finally {
    await page.evaluate(
      (original) =>
        window.api.preference.setMultiple({
          'ui.theme_mode': original.theme,
          'ui.theme_user.color_primary': original.color,
          'ui.window_style': original.style
        }),
      original
    )
    await expect.poll(readAppearance).toEqual(original)
  }
})

test(...caseDefinition('MP-106'), async ({ app, mainWindow }, testInfo) => {
  await fontsAndZoom(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-107'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const keys = [
    'chat.input.send_message_shortcut',
    'chat.input.newline_shortcut',
    'chat.input.steer_shortcut',
    'chat.input.paste_long_text_as_file',
    'chat.input.paste_long_text_threshold',
    'chat.input.show_estimated_tokens',
    'chat.message.confirm_delete',
    'topic.naming.enabled',
    'menu.presentation_mode'
  ] as const
  const previous = await page.evaluate(async (keys) => {
    const values = await Promise.all(keys.map((key) => window.api.preference.get(key)))
    return Object.fromEntries(keys.map((key, index) => [key, values[index]]))
  }, keys)
  await testInfo.attach('MP-107 original preferences', {
    body: JSON.stringify(previous, null, 2),
    contentType: 'application/json'
  })
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const providerId = `mp107-${Date.now()}`
  const assistantName = app.resourceName(`Input settings mock ${providerId}`)
  const topicName = app.resourceName(`Input settings ${providerId}`)
  let assistantId: string | undefined
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'chat.input.send_message_shortcut': ['Enter'],
        'chat.input.newline_shortcut': ['Shift', 'Enter'],
        'chat.input.steer_shortcut': ['CommandOrControl', 'Enter']
      })
    )
    await selectSidebarApp(page, 'Settings')
    await screenshot('MP-107 actual settings navigation')
    const messageSection = page
      .locator('[data-ui~="settings.navigation"] [data-slot="menu-item"]')
      .filter({ hasText: 'Message Settings' })
    const section = (await messageSection.count()) ? 'Message Settings' : 'Appearance'
    await openSettingsSection(page, section)
    await screenshot('MP-107 actual message settings sections')
    await expect(page.getByText('Input Settings', { exact: true })).toBeVisible()
    const send = page.locator('#setting-appearance-send-shortcuts').getByRole('combobox')
    const newline = page.locator('#setting-appearance-newline-shortcuts').getByRole('combobox')
    const steer = page.locator('#setting-appearance-steer-shortcuts').getByRole('combobox')
    await testInfo.attach('MP-107 original displayed bindings', {
      body: JSON.stringify({
        send: await send.innerText(),
        newline: await newline.innerText(),
        steer: await steer.innerText()
      }),
      contentType: 'application/json'
    })
    const sendLabel = formatShortcutDisplay(['CommandOrControl', 'Enter'], process.platform === 'darwin')
    await steer.click()
    await page
      .getByRole('option', {
        name: formatShortcutDisplay(['Alt', 'Enter'], process.platform === 'darwin'),
        exact: true
      })
      .click()
    await send.click()
    await screenshot('MP-107 available send shortcuts')
    const sendOption = page.getByRole('option', { name: sendLabel, exact: true })
    await expect(sendOption, 'Cmd/Ctrl+Enter must be selectable as the send shortcut').toBeVisible({ timeout: 5_000 })
    await sendOption.click()
    await expect(send).toHaveText(sendLabel)
    const newlineLabel = formatShortcutDisplay(['Enter'], process.platform === 'darwin')
    await newline.click()
    await page.getByRole('option', { name: newlineLabel, exact: true }).click()
    await expect(newline).toHaveText(newlineLabel)
    const bindings = [await send.innerText(), await newline.innerText(), await steer.innerText()]
    expect(new Set(bindings).size, 'All three shortcuts must remain distinct').toBe(3)
    await testInfo.attach('MP-107 changed displayed bindings', {
      body: JSON.stringify(bindings),
      contentType: 'application/json'
    })

    for (const name of ['Paste long text as file', 'Show estimated tokens', 'Confirm before deleting messages']) {
      const toggle = page.getByRole('switch', { name, exact: true })
      await toggle.setChecked(true)
      await expect(toggle).toBeChecked()
    }
    const threshold = page.getByRole('spinbutton', { name: 'Paste long text length', exact: true })
    await threshold.fill('500')
    await threshold.blur()
    await expect(threshold).toHaveValue('500')
    await screenshot('MP-107 configured input settings')
    await page.evaluate(() =>
      window.api.preference.setMultiple({ 'topic.naming.enabled': false, 'menu.presentation_mode': 'cherry' })
    )
    // The loopback mock supplies replies; assertions exercise real composer input and provider requests.
    const statuses = await page.evaluate(
      async ({ providerId, baseUrl, modelId }) => {
        const provider = await window.api.dataApi.request({
          id: 'mp107-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-107 mock',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        })
        const enabled = await window.api.dataApi.request({
          id: 'mp107-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        })
        const model = await window.api.dataApi.request({
          id: 'mp107-model',
          method: 'POST',
          path: '/models',
          body: [{ providerId, modelId, endpointTypes: ['openai-chat-completions'] }]
        })
        return [provider.status, enabled.status, model.status]
      },
      { providerId, baseUrl: server.baseUrl, modelId: server.modelId }
    )
    expect(statuses).toEqual([201, 200, 201])
    const assistant = await page.evaluate(
      ({ name, modelId }) =>
        window.api.dataApi.request({
          id: 'mp107-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId }
        }),
      { name: assistantName, modelId: createUniqueModelId(providerId, server.modelId) }
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ name, assistantId }) =>
        window.api.dataApi.request({ id: 'mp107-topic', method: 'POST', path: '/topics', body: { name, assistantId } }),
      { name: topicName, assistantId }
    )
    expect(topic.status).toBe(201)
    const topicId = TopicSchema.parse(topic.data).id
    await page.reload()
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await revealVirtualized(page, chat.locator('[data-virtual-scrolling]').first(), group)
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.locator(`#resource-list-option-${topicId}`).click()
    const composer = page.locator('[data-ui~="chat.composer"]')
    const editor = composer.locator('[contenteditable="true"]').first()
    const messages = chat.locator('[data-ui~="chat.message"][data-message-id]:visible')
    await editor.fill('MP107 first line')
    await editor.press('Enter')
    await editor.pressSequentially('MP107 second line')
    await expect(editor).toHaveText('MP107 first line\nMP107 second line', { useInnerText: true })
    await expect(messages).toHaveCount(0)
    await editor.press('ControlOrMeta+Enter')
    const request = await server.nextRequest()
    expect(request.body.messages).toContainEqual({ role: 'user', content: 'MP107 first line\nMP107 second line' })
    request.complete('MP107 keyboard verified')
    await expect(messages).toHaveCount(2)
    await expect(messages.last()).toContainText('MP107 keyboard verified')
    await editor.fill('')
    await page.evaluate((text) => navigator.clipboard.writeText(text), '文'.repeat(600))
    await editor.click()
    await editor.press('ControlOrMeta+v')
    const attachment = composer.locator('[data-composer-token-kind="file"]')
    await expect(attachment).toHaveCount(1)
    await expect(attachment).toContainText('Pasted text.txt')
    await expect(editor).not.toContainText('文'.repeat(600))
    testInfo.annotations.push({
      type: 'uncovered',
      description:
        'A live draft token counter is not exposed by the composer; the estimate setting is checked for persistence.'
    })
    await screenshot('MP-107 long paste attachment')
    const response = messages.last()
    await response.hover()
    await response.getByRole('button', { name: 'Delete', exact: true }).click()
    const dialog = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog'))
      .filter({ hasText: 'Are you sure you want to delete this message?' })
    await expect(dialog).toBeVisible()
    await expect(messages).toHaveCount(2)
    await screenshot('MP-107 delete confirmation')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(messages).toHaveCount(2)
    await response.hover()
    await response.getByRole('button', { name: 'Delete', exact: true }).click()
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(messages).toHaveCount(1)
    const persisted = await page.evaluate(
      async (keys) =>
        Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await window.api.preference.get(key)]))),
      keys.slice(0, 7)
    )
    page = await app.restart('authenticated')
    await dismissOnboarding(page)
    const restored = await page.evaluate(
      async (keys) =>
        Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await window.api.preference.get(key)]))),
      keys.slice(0, 7)
    )
    expect(restored).toEqual(persisted)
    expect(restored).toMatchObject({
      'chat.input.paste_long_text_as_file': true,
      'chat.input.paste_long_text_threshold': 500,
      'chat.input.show_estimated_tokens': true,
      'chat.message.confirm_delete': true
    })
    await openSettingsSection(page, section)
    await expect(page.locator('#setting-appearance-send-shortcuts').getByRole('combobox')).toHaveText(sendLabel)
    await expect(page.getByRole('spinbutton', { name: 'Paste long text length', exact: true })).toHaveValue('500')
    await screenshot('MP-107 settings persist after complete restart')
  } finally {
    await server.close()
    page = await app.mainWindow()
    await page.keyboard.press('Escape')
    await page.evaluate(
      async ({ previous, assistantId, providerId }) => {
        await window.api.preference.setMultiple(previous)
        if (assistantId) {
          const permanentlyDeletedAssistant = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant.ok || !permanentlyDeletedAssistant.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({ id: 'mp107-cleanup', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { previous, assistantId, providerId }
    )
    const restored = await page.evaluate(
      async (keys) =>
        Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await window.api.preference.get(key)]))),
      keys
    )
    expect(restored).toEqual(previous)
  }
})

test(...caseDefinition('MP-108'), async ({ app, mainWindow: page }, testInfo) => {
  // Real UI and provider HTTP requests catch stale or crossed default assignments; no real account is required.
  const keys = [
    'chat.default_model_id',
    'feature.quick_assistant.model_id',
    'feature.translate.model_id',
    'feature.paintings.default_model_id',
    'feature.paintings.default_provider',
    'feature.translate.auto_detection_method',
    'feature.translate.page.source_language',
    'feature.translate.page.target_language',
    'feature.translate.page.bidirectional_enabled',
    'topic.naming.enabled',
    'menu.presentation_mode'
  ] as const
  const preferences = await page.evaluate(async (keys) => {
    const entries = await Promise.all(keys.map(async (key) => [key, await window.api.preference.get(key)]))
    return Object.fromEntries(entries)
  }, keys)
  const server = await startMockChatServer()
  testInfo.annotations.push({
    type: 'data-source',
    description:
      'Loopback mock chat replies; real Electron UI, IPC and persisted data. Does not validate external model quality.'
  })
  const providerId = `regression-mp108-${Date.now()}`
  const assistantName = app.resourceName('Default assignment assistant')
  const topicName = app.resourceName('Default assignment topic')
  const modelIds = ['mp108-chat', 'mp108-quick', 'mp108-translate', 'mp108-image']
  let assistantId: string | undefined
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const showTopics = async () => {
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await revealVirtualized(page, chat.locator('[data-virtual-scrolling]').first(), group)
    await expect(group).toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    return chat
  }
  try {
    await page.evaluate(() =>
      window.api.preference.setMultiple({
        'topic.naming.enabled': false,
        'menu.presentation_mode': 'cherry',
        'feature.translate.auto_detection_method': 'llm',
        'feature.translate.page.source_language': 'en-us',
        'feature.translate.page.target_language': 'zh-cn',
        'feature.translate.page.bidirectional_enabled': false
      })
    )
    const provider = await page.evaluate(
      ({ providerId, baseUrl }) =>
        window.api.dataApi.request({
          id: 'mp108-provider',
          method: 'POST',
          path: '/providers',
          body: {
            providerId,
            name: 'MP-108 mock provider',
            defaultChatEndpoint: 'openai-chat-completions',
            endpointConfigs: { 'openai-chat-completions': { baseUrl } },
            apiKeys: [{ id: 'mock-key', key: 'mock-api-key', isEnabled: true }]
          }
        }),
      { providerId, baseUrl: server.baseUrl }
    )
    expect(provider.status).toBe(201)
    const enabled = await page.evaluate(
      (providerId) =>
        window.api.dataApi.request({
          id: 'mp108-enable',
          method: 'PATCH',
          path: `/providers/${providerId}`,
          body: { isEnabled: true }
        }),
      providerId
    )
    expect(enabled.status).toBe(200)
    const models = await page.evaluate(
      ({ providerId, modelIds }) =>
        window.api.dataApi.request({
          id: 'mp108-models',
          method: 'POST',
          path: '/models',
          body: modelIds.map((modelId, index) => ({
            providerId,
            modelId,
            capabilities: index === 3 ? ['image-generation'] : [],
            endpointTypes: index === 3 ? ['openai-image-generation'] : ['openai-chat-completions']
          }))
        }),
      { providerId, modelIds }
    )
    expect(models.status).toBe(201)
    const assistant = await page.evaluate(
      (name) =>
        window.api.dataApi.request({
          id: 'mp108-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId: null }
        }),
      assistantName
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({
          id: 'mp108-topic',
          method: 'POST',
          path: '/topics',
          body: { assistantId, name }
        }),
      { assistantId, name: topicName }
    )
    expect(topic.status).toBe(201)
    await page.reload()
    await openSettingsSection(page, 'Default Model')
    const rows = ['default-assistant', 'quick', 'translate', 'painting']
    for (const [index, row] of rows.entries()) {
      const setting = page.locator(`#setting-model-${row}-model`)
      await setting.locator('[data-selector-shell-root="true"] > button').click()
      await selectVisibleModel(page, modelIds[index])
      await expect(setting).toContainText(modelIds[index])
      await expect
        .poll(() => page.evaluate((key) => window.api.preference.get(key), keys[index]))
        .toBe(createUniqueModelId(providerId, modelIds[index]))
    }
    await screenshot('MP-108 four saved default assignments')

    let chat = await showTopics()
    await chat.getByTestId('topic-list-row').filter({ hasText: topicName }).click()
    const assistantGroup = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await assistantGroup.hover()
    await assistantGroup.getByRole('button', { name: 'New Chat', exact: true }).click()
    await screenshot('MP-108 new topic default model selection')
    await expect(page.getByRole('button', { name: 'Selected models', exact: true })).toContainText(modelIds[0])
    await Promise.all([
      sendChatMarker(page, 'Explain default model assignment.', 'MP108_CHAT_DEFAULT_USED'),
      (async () => {
        const request = await server.nextRequest()
        expect(request.body.model).toBe(modelIds[0])
        request.complete('MP108_CHAT_DEFAULT_USED')
      })()
    ])
    // Use the seeded topic to make naming independent of the new topic's localized initial title.
    const originalRow = chat.getByTestId('topic-list-row').filter({ hasText: topicName })
    await originalRow.click()
    await Promise.all([
      sendChatMarker(page, 'Name this model assignment check.', 'MP108_NAMING_INPUT'),
      (async () => {
        const request = await server.nextRequest()
        expect(request.body.model).toBe(modelIds[0])
        request.complete('MP108_NAMING_INPUT')
      })()
    ])
    await originalRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Generate conversation name', exact: true }).click()
    const naming = await server.nextRequest()
    expect(naming.body.model).toBe(modelIds[1])
    naming.complete('MP108 quick naming')
    await expect(chat.getByTestId('topic-list-row').filter({ hasText: 'MP108 quick naming' })).toBeVisible()
    await screenshot('MP-108 new topic and quick model naming')

    await selectSidebarApp(page, 'Translation')
    const translation = page.locator('[data-ui~="translate.view"]:visible')
    await expect(translation.locator('[data-selector-shell-root="true"] > button')).toContainText(modelIds[2])
    await page.locator('[data-ui~="translate.input"] textarea').fill('Default model assignment MP108')
    await translation.getByRole('button', { name: 'Translate', exact: true }).click()
    const translated = await server.nextRequest()
    expect(translated.body.model).toBe(modelIds[2])
    translated.complete('默认模型分配 MP108')
    await expect(page.locator('[data-ui~="translate.output"]')).toContainText('默认模型分配 MP108')
    // History language detection is a separate quick-model request.
    const detection = await server.nextRequest()
    expect(detection.body.model).toBe(modelIds[1])
    detection.complete('en-us')
    await screenshot('MP-108 translation uses assigned model')

    await selectSidebarApp(page, 'Paintings')
    await page.getByRole('button', { name: 'New Image', exact: true }).click()
    await expect(
      page.locator('[data-selector-shell-root="true"] > button').filter({ hasText: modelIds[3] })
    ).toBeVisible()
    await screenshot('MP-108 new drawing uses assigned model')

    await openSettingsSection(page, 'Default Model')
    // Quick Model has no clear action; the supported way to leave it unassigned is the preference
    // itself, and an unassigned quick model falls back to the default model.
    await page.evaluate(() => window.api.preference.set('feature.quick_assistant.model_id', null))
    await expect
      .poll(() => page.evaluate(() => window.api.preference.get('feature.quick_assistant.model_id')))
      .toBeNull()
    await expect(page.locator('#setting-model-quick-model [data-selector-shell-root="true"] > button')).toContainText(
      modelIds[0]
    )
    await screenshot('MP-108 quick model falls back to the default model')
    chat = await showTopics()
    const namedRow = chat.getByTestId('topic-list-row').filter({ hasText: 'MP108 quick naming' })
    await namedRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Generate conversation name', exact: true }).click()
    const fallbackNaming = await server.nextRequest()
    expect(fallbackNaming.body.model).toBe(modelIds[0])
    fallbackNaming.complete('MP108 default naming')
    await expect(chat.getByTestId('topic-list-row').filter({ hasText: 'MP108 default naming' })).toBeVisible()
    await screenshot('MP-108 unassigned quick model names through the default model')
  } finally {
    await server.close()
    await page.evaluate(
      async ({ preferences, assistantId, providerId }) => {
        await window.api.preference.setMultiple(preferences)
        if (assistantId) {
          const permanentlyDeletedAssistant2 = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant2.ok || !permanentlyDeletedAssistant2.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
        await window.api.dataApi.request({ id: 'mp108-delete', method: 'DELETE', path: `/providers/${providerId}` })
      },
      { preferences, assistantId, providerId }
    )
  }
})

test(...caseDefinition('MP-109'), async ({ app, mainWindow: page }, testInfo) => {
  // Catch stale runtime bindings, accepted duplicate shortcuts, and disabled shortcuts that still create topics.
  const original = await page.evaluate(async () => ({
    create: await window.api.preference.get('shortcut.topic.create'),
    search: await window.api.preference.get('shortcut.app.search')
  }))
  const custom = { binding: ['CommandOrControl', 'Shift', 'Y'], enabled: true }
  const defaults = { binding: ['CommandOrControl', 'N'], enabled: true }
  const assistantName = app.resourceName('Shortcut assistant')
  const topicName = app.resourceName('Shortcut starting topic')
  let assistantId: string | undefined
  let startingTopicId: string
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const readShortcut = () => page.evaluate(() => window.api.preference.get('shortcut.topic.create'))
  // CommandOrControl records as Meta on macOS and Control on Windows.
  const primary = app.record.platform === 'macos' ? 'Meta' : 'Control'
  const row = page.locator('#setting-shortcut-topic-create')
  const openShortcut = async () => {
    await openSettingsSection(page, 'Keyboard Shortcuts')
    const settings = page.locator('[data-ui~="settings.view"]:visible')
    await settings.getByRole('button', { name: 'Search', exact: true }).click()
    await settings.getByPlaceholder('Search shortcuts...').fill('New Conversation')
    await expect(row).toBeVisible()
    await expect(settings.locator('[id^="setting-shortcut-"]')).toHaveCount(1)
  }
  const showStartingTopic = async () => {
    await selectSidebarApp(page, 'Chat')
    const chat = page.locator('[data-ui~="chat.view"]:visible')
    const group = chat.locator('[data-ui~="chat.group-header"]').filter({ hasText: assistantName }).first()
    await revealVirtualized(page, chat.locator('[data-virtual-scrolling]').first(), group)
    await expect(group).toBeVisible()
    await group.hover()
    const expand = group.getByRole('button', { name: 'Expand', exact: true })
    if (await expand.isVisible()) await expand.click()
    await chat.locator(`#resource-list-option-${startingTopicId}`).click()
    return chat
  }
  try {
    await page.evaluate(() =>
      window.api.preference.set('shortcut.app.search', {
        binding: ['CommandOrControl', 'Shift', 'F'],
        enabled: true
      })
    )
    const assistant = await page.evaluate(
      (name) =>
        window.api.dataApi.request({
          id: 'mp109-assistant',
          method: 'POST',
          path: '/assistants',
          body: { name, modelId: null }
        }),
      assistantName
    )
    expect(assistant.status).toBe(201)
    assistantId = AssistantSchema.parse(assistant.data).id
    const topic = await page.evaluate(
      ({ assistantId, name }) =>
        window.api.dataApi.request({
          id: 'mp109-topic',
          method: 'POST',
          path: '/topics',
          body: { assistantId, name }
        }),
      { assistantId, name: topicName }
    )
    expect(topic.status).toBe(201)
    startingTopicId = TopicSchema.parse(topic.data).id
    await page.reload()
    await showStartingTopic()
    await openShortcut()
    await row.locator('kbd').first().locator('..').click()
    await row.getByRole('button', { name: 'Press Shortcut', exact: true }).press(`${primary}+Shift+Y`)
    await expect.poll(readShortcut).toEqual(custom)
    await expect(row.locator('kbd').last()).toHaveText('Y')
    await screenshot('MP-109 custom shortcut saved')

    const chat = await showStartingTopic()
    const readTopicIds = () =>
      page.evaluate(async (assistantId) => {
        const ids: string[] = []
        let cursor: string | undefined
        do {
          const response = await window.api.dataApi.request({
            id: 'mp109-topics',
            method: 'GET',
            path: '/topics',
            params: { limit: 200, ...(cursor ? { cursor } : {}) }
          })
          if (response.status !== 200) throw new Error('Could not read persisted topics')
          const data = response.data as { items: { id: string; assistantId: string | null }[]; nextCursor?: string }
          ids.push(...data.items.filter((topic) => topic.assistantId === assistantId).map(({ id }) => id))
          cursor = data.nextCursor
        } while (cursor)
        return ids.sort()
      }, assistantId)
    const createWithShortcut = async (shortcut: string) => {
      const previous = new Set(await readTopicIds())
      await page.keyboard.press(shortcut)
      await expect.poll(async () => (await readTopicIds()).filter((id) => !previous.has(id))).toHaveLength(1)
      const id = (await readTopicIds()).find((id) => !previous.has(id))!
      await expect(chat.locator(`#resource-list-option-${id}`)).toHaveAttribute('aria-selected', 'true')
      return id
    }
    const nameCreatedTopic = async (id: string, name: string) => {
      // Named conversations are retained; unnamed empty placeholders are intentionally reused by the app.
      await page.keyboard.press('Escape')
      const topic = chat.locator(`#resource-list-option-${id}`)
      await topic.getByText('New Chat', { exact: true }).dblclick()
      const input = page.getByRole('textbox', { name: 'Edit conversation name', exact: true })
      await input.fill(app.resourceName(name))
      await input.press('Enter')
      await expect(topic).toContainText(app.resourceName(name))
    }
    let createdId = await createWithShortcut(`${primary}+Shift+Y`)
    await expect(chat.getByRole('heading', { name: 'What should we talk about today?', exact: true })).toBeVisible()
    await screenshot('MP-109 custom shortcut creates conversation immediately')
    await nameCreatedTopic(createdId, 'Custom shortcut conversation')

    await openShortcut()
    await row.locator('kbd').first().locator('..').click()
    await row.getByRole('button', { name: 'Press Shortcut', exact: true }).press(`${primary}+Shift+F`)
    await expect(row.getByText('Already used by "Search Message"', { exact: true })).toBeVisible()
    await screenshot('MP-109 occupied shortcut rejected')
    expect(await readShortcut()).toEqual(custom)
    await page.keyboard.press('Escape')
    await expect(row.locator('kbd').last()).toHaveText('Y')

    await row.locator('.shortcut-undo-icon').click()
    await expect.poll(readShortcut).toEqual(defaults)
    await expect(row.locator('kbd').last()).toHaveText('N')
    await showStartingTopic()
    createdId = await createWithShortcut(`${primary}+N`)
    await screenshot('MP-109 default shortcut restored and working')
    await nameCreatedTopic(createdId, 'Default shortcut conversation')

    await openShortcut()
    await row.getByRole('switch').click()
    await expect(row.getByRole('switch')).not.toBeChecked()
    await expect.poll(readShortcut).toEqual({ ...defaults, enabled: false })
    await showStartingTopic()
    const beforeDisabledShortcut = await readTopicIds()
    await page.keyboard.press(`${primary}+N`)
    await page.waitForTimeout(1_000)
    expect(await readTopicIds()).toEqual(beforeDisabledShortcut)
    await expect(chat.locator(`#resource-list-option-${startingTopicId}`)).toHaveAttribute('aria-selected', 'true')
    await screenshot('MP-109 disabled shortcut does not create conversation')

    await openShortcut()
    await row.getByRole('switch').click()
    await expect.poll(readShortcut).toEqual(defaults)
    await showStartingTopic()
    await createWithShortcut(`${primary}+N`)
  } finally {
    await page.evaluate(
      async ({ original, assistantId }) => {
        await window.api.preference.setMultiple({
          'shortcut.topic.create': original.create,
          'shortcut.app.search': original.search
        })
        if (assistantId) {
          const permanentlyDeletedAssistant3 = (await window.api.ipcApi.request('trash.assistant.delete_permanently', {
            assistantId,
            deleteTopics: true
          })) as IpcResult<{ deleted: boolean }>
          if (!permanentlyDeletedAssistant3.ok || !permanentlyDeletedAssistant3.data.deleted)
            throw new Error('cleanup left the case assistant in the trash')
        }
      },
      { original, assistantId }
    )
  }
})

test(...caseDefinition('MP-110'), async ({ app, mainWindow }, testInfo) => {
  await notificationSettings(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-111'), async ({ app, mainWindow }, testInfo) => {
  let page = mainWindow
  const original = await page.evaluate(async () => ({
    'app.launch_on_boot': await window.api.preference.get('app.launch_on_boot'),
    'app.tray.enabled': await window.api.preference.get('app.tray.enabled'),
    'app.tray.on_launch': await window.api.preference.get('app.tray.on_launch'),
    'app.tray.on_close': await window.api.preference.get('app.tray.on_close')
  }))
  const setSwitch = async (id: string, checked: boolean) => {
    const control = page.locator(`#setting-general-${id}`).getByRole('switch')
    await control.setChecked(checked)
    await expect(control).toBeChecked({ checked })
  }
  const attachScreenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const closeNativeWindow = async () => {
    await expect.poll(async () => (await inspectStartup(app)).visible).toBe(true)
    execFileSync(
      'osascript',
      [
        '-e',
        `tell application "System Events"
          tell (first process whose unix id is ${app.record.electronPid})
            set frontmost to true
            repeat 30 times
              if exists window 1 then exit repeat
              delay 0.1
            end repeat
            click (first button of window 1 whose subrole is "AXCloseButton")
          end tell
        end tell`
      ],
      { timeout: 10_000 }
    )
  }
  try {
    await openSettingsSection(page, 'General')
    await setSwitch('launch-onboot', false)
    await expect.poll(async () => (await inspectStartup(app)).openAtLogin).toBe(false)
    await setSwitch('launch-onboot', true)
    await expect.poll(async () => (await inspectStartup(app)).openAtLogin).toBe(true)
    await setSwitch('launch-totray', true)
    await setSwitch('tray-onclose', true)
    await expect(page.locator('#setting-general-tray-show').getByRole('switch')).toBeChecked()
    await attachScreenshot('MP-111 startup and tray enabled')

    const previousPid = app.record.electronPid
    await inspectStartup(app, 'quit')
    await expect.poll(() => isAlive(previousPid)).toBe(false)
    page = await app.restart()
    expect(app.record.electronPid).not.toBe(previousPid)
    expect(await page.evaluate(() => window.api.preference.get('app.launch_on_boot'))).toBe(true)
    await expect.poll(async () => (await inspectStartup(app)).openAtLogin).toBe(true)
    const hidden = await inspectStartup(app)
    expect(hidden.visible).toBe(false)
    expect(hidden.dockVisible).toBe(false)
    expect(hidden.openAtLogin).toBe(true)
    expect(hidden.trays).toEqual(expect.arrayContaining([expect.objectContaining({ destroyed: false })]))
    expect(hidden.trays.some(({ destroyed, bounds }) => !destroyed && bounds.width > 0 && bounds.height > 0)).toBe(true)
    await testInfo.attach('MP-111 native startup state', {
      body: JSON.stringify(hidden),
      contentType: 'application/json'
    })

    await inspectStartup(app, 'show')
    await openSettingsSection(page, 'General')
    await expect(page.locator('#setting-general-launch-totray').getByRole('switch')).toBeChecked()
    await attachScreenshot('MP-111 persisted startup settings after restart')
    await closeNativeWindow()
    await expect.poll(async () => (await inspectStartup(app)).visible).toBe(false)
    await expect.poll(async () => (await inspectStartup(app)).dockVisible).toBe(false)
    expect(isAlive(app.record.electronPid)).toBe(true)

    await inspectStartup(app, 'show')
    await setSwitch('tray-onclose', false)
    await closeNativeWindow()
    await expect.poll(async () => (await inspectStartup(app)).visible).toBe(false)
    expect((await inspectStartup(app)).dockVisible).toBe(true)
    expect(isAlive(app.record.electronPid)).toBe(true)

    await inspectStartup(app, 'show')
    await setSwitch('launch-onboot', false)
    await setSwitch('launch-totray', false)
    await expect.poll(async () => (await inspectStartup(app)).openAtLogin).toBe(false)
    await attachScreenshot('MP-111 startup options disabled')
    page = await app.restart()
    await expect.poll(async () => (await inspectStartup(app)).visible).toBe(true)
    await openSettingsSection(page, 'General')
    await expect(page.locator('#setting-general-launch-totray').getByRole('switch')).not.toBeChecked()
    await expect(page.locator('#setting-general-launch-onboot').getByRole('switch')).not.toBeChecked()
  } catch (error) {
    await testInfo.attach('MP-111 primary failure', {
      body: error instanceof Error ? (error.stack ?? error.message) : String(error),
      contentType: 'text/plain'
    })
    throw error
  } finally {
    page = await app.mainWindow().catch(() => app.restart())
    await page.evaluate((preferences) => window.api.preference.setMultiple(preferences), original)
    await inspectStartup(app, 'show')
    await expect.poll(async () => (await inspectStartup(app)).openAtLogin).toBe(original['app.launch_on_boot'])
  }
})

test(...caseDefinition('MP-112'), async ({ app, mainWindow }, testInfo) => {
  await networkProxySettings(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-151'), async ({ app, mainWindow }, testInfo) => {
  await feishuChannelSettings(app, mainWindow, testInfo)
})

test(...caseDefinition('MP-113'), async ({ app, mainWindow }, testInfo) => {
  // Catches lost opt-out after restart, missing consent guidance, and telemetry sent after opting out.
  let page = mainWindow
  const original = await page.evaluate(() => window.api.preference.get('app.privacy.data_collection.enabled'))
  const originalPolicy = await page.evaluate(() => window.api.preference.get('app.privacy.policy_version'))
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  const privacyRow = () => page.locator('#setting-data-data-privacy-mode')
  const readConsent = () => page.evaluate(() => window.api.preference.get('app.privacy.data_collection.enabled'))
  const openPrivacy = async () => {
    await page.addLocatorHandler(
      page.getByRole('dialog', { name: 'Privacy Policy Updated', exact: true }),
      async (dialog) => {
        await screenshot('MP-113 privacy policy acknowledgement')
        await dialog.getByRole('button', { name: 'Accept and Continue', exact: true }).click()
      }
    )
    await expect(
      page
        .locator('[data-ui~="settings.view"]:visible')
        .or(page.getByRole('button', { name: 'Chat', exact: true }))
        .first()
    ).toBeVisible()
    await openSettingsSection(page, 'Data')
    await privacyRow().scrollIntoViewIfNeeded()
    await expect(privacyRow()).toContainText('Anonymous reporting of errors and statistics')
  }
  const reportingRequests: string[] = []
  const observeRequest = (request: Request) => {
    const url = new URL(request.url())
    if (/(^|\.)(sentry\.io|sentry\.cherry-ai\.com)$/.test(url.hostname)) {
      reportingRequests.push(`${request.method()} ${url.origin}${url.pathname}`)
    }
  }
  let observedContext = page.context()
  try {
    await openPrivacy()
    await expect(privacyRow().getByRole('switch')).toBeChecked({ checked: original })
    await testInfo.attach('MP-113 initial consent', {
      body: JSON.stringify({ enabled: original }),
      contentType: 'application/json'
    })
    await screenshot('MP-113 original privacy setting')
    await privacyRow().getByRole('switch').click()
    await expect.poll(readConsent).toBe(!original)
    await screenshot('MP-113 toggled privacy setting')
    const guidance = (await privacyRow().locator('..').innerText())
      .replace('Privacy Settings', '')
      .replace('Anonymous reporting of errors and statistics', '')
      .trim()
    expect.soft(guidance, 'Privacy toggle must explain consent and what reporting collects').not.toBe('')

    page = await app.restart()
    await openPrivacy()
    await expect(privacyRow().getByRole('switch')).toBeChecked({ checked: !original })
    expect(await readConsent()).toBe(!original)
    await screenshot('MP-113 toggled consent survives application restart')

    if (await readConsent()) await privacyRow().getByRole('switch').click()
    await expect.poll(readConsent).toBe(false)
    page = await app.restart()
    observedContext = page.context()
    observedContext.on('request', observeRequest)
    await openPrivacy()
    await expect(privacyRow().getByRole('switch')).not.toBeChecked()
    expect(await readConsent()).toBe(false)
    await screenshot('MP-113 disabled reporting survives application restart')

    await page.evaluate(() => {
      const error = new Error('MP-113 opted-out reporting probe')
      window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }))
    })
    await page.waitForTimeout(5_000)
    await testInfo.attach('MP-113 renderer reporting requests', {
      body: JSON.stringify({ observationMs: 5_000, reportingRequests, mode: app.record.mode }),
      contentType: 'application/json'
    })
    if (app.record.mode === 'branch') {
      // Development disables Sentry, and the renderer cannot observe the main-process transport,
      // so opt-out of error reporting is not verifiable on a branch build.
      testInfo.annotations.push({
        type: 'not-applicable',
        description: 'Error-reporting transport opt-out needs a packaged build; branch builds disable Sentry.'
      })
    } else {
      expect(reportingRequests, 'Opted-out renderer must not send error/statistics requests').toEqual([])
      testInfo.annotations.push({
        type: 'limitation',
        description: 'Renderer request observation cannot prove the main-process transport stays silent.'
      })
    }

    await selectSidebarApp(page, 'Chat')
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    await page.getByText('System diagnostics', { exact: true }).click()
    await page
      .getByRole('dialog', { name: 'System diagnostics', exact: true })
      .getByRole('button', { name: 'More', exact: true })
      .click()
    await page.getByRole('menuitem', { name: 'Export diagnostic bundle', exact: true }).click()
    const bundle = page.getByRole('dialog', { name: 'Export diagnostic bundle', exact: true })
    await expect(bundle).toContainText('Save selected diagnostic information as a local ZIP file.')
    await bundle.getByRole('button', { name: 'Export', exact: true }).click()
    const consent = page.getByRole('dialog', { name: 'Before you share', exact: true })
    await expect(consent).toContainText('Cherry Studio does not redact or upload them automatically.')
    await expect(consent).toContainText('Share the ZIP only with support')
    await expect(consent.getByRole('checkbox')).not.toBeChecked()
    await expect(consent.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
    expect(await readConsent(), 'Manual diagnostics must not re-enable anonymous reporting').toBe(false)
    await screenshot('MP-113 diagnostic bundle privacy and explicit consent')
    await consent.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.keyboard.press('Escape')
  } finally {
    observedContext.off('request', observeRequest)
    await page.evaluate(
      ({ original, originalPolicy }) =>
        window.api.preference.setMultiple({
          'app.privacy.data_collection.enabled': original,
          'app.privacy.policy_version': originalPolicy
        }),
      { original, originalPolicy }
    )
  }
})

test(...caseDefinition('MP-114'), async ({ app, mainWindow: page }, testInfo) => {
  const screenshot = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`)
    await writeFile(path, await captureMaskedScreenshot(page, getSensitiveConfigValues()))
    await testInfo.attach(name, { path, contentType: 'image/png' })
  }
  await openSettingsSection(page, 'About & Feedback')
  const content = page.locator('[data-ui~="settings.content"]')
  await test.step('About displays the running package version', async () => {
    const result = (await page.evaluate(() => window.api.ipcApi.request('app.get_info'))) as {
      ok: boolean
      data: { version: string }
    }
    expect(result.ok).toBe(true)
    const info = result.data
    const packageInfo = JSON.parse(await readFile(join(app.record.targetRoot, 'package.json'), 'utf8'))
    expect(info.version).toBe(packageInfo.version)
    await expect(content.getByRole('button', { name: 'Release Notes', exact: true })).toHaveText(`v${info.version}`)
    await screenshot('MP-114 about version')
  })
  await test.step('Checking updates returns a current or available version', async () => {
    let feed: Awaited<ReturnType<typeof startMockUpdateServer>> | undefined
    if (app.record.mode === 'branch') {
      const config = parse(await readFile(join(app.record.targetRoot, 'dev-app-update.yml'), 'utf8')) as {
        provider: string
        url: string
      }
      expect(config.provider).toBe('generic')
      const result = (await page.evaluate(() => window.api.ipcApi.request('app.get_info'))) as IpcResult<{
        version: string
      }>
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('Cannot read the running version for the development update feed')
      feed = await startMockUpdateServer(config.url, result.data.version)
      testInfo.annotations.push({ type: 'update-feed', description: 'Loopback fixture serving the running version.' })
    }
    try {
      await content.getByRole('button', { name: 'Check Update', exact: true }).click()
      const updateError = page.getByRole('dialog', { name: 'Update error', exact: true })
      const updateResult = page
        .getByText('You are using the latest version', { exact: true })
        .or(page.getByText(/^Found new version \d+\./))
        .or(updateError)
      await expect(updateResult).toBeVisible({ timeout: 60_000 })
      await expect
        .soft(updateResult, 'A real update check must report the latest status or an available version')
        .toContainText(/You are using the latest version|Found new version \d+\./, { timeout: 1_000 })
      await screenshot('MP-114 update result')
      if (await updateError.isVisible()) await updateError.getByRole('button', { name: 'Confirm', exact: true }).click()
      if (feed) {
        expect(
          feed.requests.some((path) => path.endsWith('.yml')),
          'The real updater must fetch feed metadata'
        ).toBe(true)
        await testInfo.attach('MP-114 development update feed requests', {
          body: JSON.stringify(feed.requests),
          contentType: 'application/json'
        })
      }
    } finally {
      await feed?.close()
    }
  })
  await test.step('Feedback offers Report a problem', async () => {
    await content.getByRole('button', { name: 'Feedback', exact: true }).click()
    const feedback = page.getByRole('dialog', { name: 'Choose a feedback channel', exact: true })
    await expect(feedback).toBeVisible()
    await screenshot('MP-114 feedback channels')
    await expect.soft(feedback.getByRole('button', { name: /Report a problem/ })).toBeVisible({ timeout: 2_000 })
    await page.keyboard.press('Escape')
    await expect(feedback).toBeHidden()
  })
  await test.step('System diagnostics exports the last 24 hours', async () => {
    await closeSettings(page)
    await page.getByRole('button', { name: 'Help', exact: true }).click()
    await page.getByText('System diagnostics', { exact: true }).click()
    const doctor = page.getByRole('dialog', { name: 'System diagnostics', exact: true })
    await doctor.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export diagnostic bundle', exact: true }).click()
    const range = page.getByRole('radio', { name: 'Last 24 hours', exact: true })
    await range.click()
    await expect(range).toBeChecked()
    await expect(page.getByRole('switch', { name: 'App logs', exact: true })).toBeChecked()
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const confirmation = page.getByRole('dialog', { name: 'Before you share', exact: true })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole('checkbox').check()
    await confirmation.getByRole('button', { name: 'Export', exact: true }).click()
    // The bundle is unredacted by design, so it must never land in an uploaded root.
    const output = join(app.paths.private, 'downloads', `MP-114-diagnostics-${Date.now()}.zip`)
    await saveNativeFile(app.record.platform, app.paths, output)
    await expect(page.getByText('Diagnostic bundle exported', { exact: true })).toBeVisible({ timeout: 60_000 })
    const archiveSize = (await stat(output)).size
    expect(archiveSize).toBeGreaterThan(0)
    const files = new AdmZip(output).getEntries().filter((entry) => !entry.isDirectory)
    const summary = files.find((entry) => entry.entryName === 'diagnostics.json')
    expect(summary, 'The ZIP must contain a diagnostic summary').toBeDefined()
    const manifest = JSON.parse(summary!.getData().toString('utf8'))
    expect(Date.parse(manifest.range.to) - Date.parse(manifest.range.from)).toBe(24 * 60 * 60 * 1000)
    const logs = files.filter((entry) => entry.entryName.startsWith('logs/'))
    expect(logs.length, 'The ZIP must contain application logs').toBeGreaterThan(0)
    const collected = manifest.sources.logs.included.fileCount + manifest.sources.traces.included.fileCount
    const bytes = archiveSize / 1024 ** Math.min(Math.floor(Math.log(archiveSize) / Math.log(1024)), 3)
    const unit = ['B', 'KB', 'MB', 'GB'][Math.min(Math.floor(Math.log(archiveSize) / Math.log(1024)), 3)]
    const sizeText = `${bytes >= 10 || unit === 'B' ? bytes.toFixed(0) : bytes.toFixed(1)} ${unit}`
    await expect(
      page.getByText(new RegExp(`File size .* · ${collected} files collected · \\d+ files not collected`))
    ).toContainText(sizeText)
    const secrets = getSensitiveConfigValues().filter((value) => value.length >= 8)
    for (const entry of files) {
      const text = entry.getData().toString('utf8')
      expect(
        /\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text),
        `${entry.entryName} must not contain plaintext keys`
      ).toBe(false)
      expect(
        secrets.some((secret) => text.includes(secret)),
        `${entry.entryName} must not contain configured secrets`
      ).toBe(false)
    }
    await testInfo.attach('MP-114 archive inventory', {
      body: JSON.stringify({ archiveSize, entries: files.map((entry) => entry.entryName) }, null, 2),
      contentType: 'application/json'
    })
    await screenshot('MP-114 exported bundle size and file count')
    await page.getByRole('button', { name: 'Open file location', exact: true }).click()
    if (app.record.platform === 'macos') {
      await expect
        .poll(() =>
          execFileSync(
            'osascript',
            ['-e', 'tell application "Finder" to get POSIX path of (item 1 of (get selection) as alias)'],
            { encoding: 'utf8', timeout: 10_000 }
          ).trim()
        )
        .toBe(output)
    } else {
      const script =
        '(New-Object -ComObject Shell.Application).Windows() | ForEach-Object { $_.Document.SelectedItems() } | ForEach-Object { $_.Path }'
      await expect
        .poll(() =>
          execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            encoding: 'utf8',
            timeout: 10_000
          })
        )
        .toContain(output)
    }
  })
})

test(...caseDefinition('MP-147'), async ({ app, mainWindow }, testInfo) => {
  await longUserMessageExpansion(app, mainWindow, testInfo)
})
