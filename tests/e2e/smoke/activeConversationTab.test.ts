import { rm } from 'node:fs/promises'
import { isAbsolute, parse, relative, sep } from 'node:path'

import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import { ThemeMode } from '../../../src/shared/data/preference/preferenceTypes'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test as base } from './fixtures/electron.fixture'

const ALPHA = 'Active tab Alpha'
const BETA = 'Active tab Beta'
const strip = (page: Page) => page.locator('[data-ui~="app.tab-bar"]')
const tab = (page: Page, name: string) => page.locator(`[data-ui~="app.tab-bar"] [data-tab-id][aria-label="${name}"]`)
const topicRow = (page: Page, name: string) =>
  page
    .getByTestId('topic-list-row')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ visible: true })
const composer = (page: Page) => {
  const boundary = page.locator('[data-ui~="part:composer-input"]').filter({ visible: true })
  return boundary
    .and(page.locator('textarea'))
    .or(boundary.locator('[contenteditable="true"]'))
    .filter({ visible: true })
    .first()
}

type IsolatedSession = { launch: () => Promise<Page>; profile: string }
const test = base.extend<{ isolatedSession: IsolatedSession }>({
  isolatedSession: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    expect(isAbsolute(profile)).toBe(true)
    expect(profile).not.toBe(parse(profile).root)
    let ownedApp: ElectronApplication | undefined
    const launch = async () => {
      if (ownedApp) {
        await ownedApp.close()
        ownedApp = undefined
      }
      ownedApp = await electron.launch({
        args: ['.'],
        env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
        timeout: 60_000
      })
      const userData = await ownedApp.evaluate(({ app }) => app.getPath('userData'))
      const inside = relative(profile, userData)
      expect(inside).not.toBe('')
      expect(isAbsolute(inside)).toBe(false)
      expect(inside === '..' || inside.startsWith(`..${sep}`)).toBe(false)
      await expect
        .poll(
          async () => {
            for (const window of ownedApp!.windows()) if ((await window.title()) === 'Cherry Studio') return true
            return false
          },
          { timeout: 60_000 }
        )
        .toBe(true)
      const windows = ownedApp.windows()
      const titles = await Promise.all(windows.map((window) => window.title()))
      const page = windows[titles.indexOf('Cherry Studio')]
      await page.waitForFunction(() => !!window.api?.preference, undefined, { timeout: 60_000 })
      return page
    }
    try {
      await use({ launch, profile })
    } finally {
      try {
        await ownedApp?.close()
      } finally {
        await rm(profile, { recursive: true, force: true })
      }
    }
  }
})

async function navigationState(button: Locator) {
  return button.evaluate((element) => {
    const css = getComputedStyle(element)
    const context = new OffscreenCanvas(1, 1).getContext('2d')!
    const pixel = (...layers: string[]) => {
      context.clearRect(0, 0, 1, 1)
      for (const color of layers) {
        context.fillStyle = color
        context.fillRect(0, 0, 1, 1)
      }
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    }
    const luminance = (color: number[]) =>
      color
        .map((channel) => {
          const value = channel / 255
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const contrast = (a: number[], b: number[]) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
    const surface = css.getPropertyValue('--sidebar').trim()
    const background = pixel(surface, css.backgroundColor)
    const shadowColor = css.boxShadow.replace(/^inset\s+/, '').split(/\s-?[\d.]+px/)[0]
    return {
      background,
      foreground: css.color,
      shadow: css.boxShadow,
      focusVisible: element.matches(':focus-visible'),
      textContrast: contrast(pixel(css.color), background),
      surfaceContrast: contrast(background, pixel(surface)),
      focusContrast: css.boxShadow === 'none' ? 0 : contrast(pixel(shadowColor), background)
    }
  })
}

async function expectTabState(button: Locator, selected: boolean, opaque: boolean) {
  if (selected) await expect(button).toHaveAttribute('data-active', 'true')
  else await expect(button).not.toHaveAttribute('data-active')
  await expect(async () => {
    const state = await navigationState(button)
    if (selected) expect(state.surfaceContrast).toBeGreaterThan(1)
    if (opaque) expect(state.textContrast).toBeGreaterThanOrEqual(4.5)
    if (state.focusVisible) {
      expect(state.shadow).toContain('inset')
      if (opaque) expect(state.focusContrast).toBeGreaterThanOrEqual(3)
    } else {
      expect(state.shadow).toBe('none')
    }
  }).toPass({ timeout: 10_000 })
}

async function expectSelection(page: Page, selected: string, opaque: boolean) {
  for (const name of [ALPHA, BETA]) {
    const button = tab(page, name)
    await expectTabState(button, name === selected, opaque)
    await expect(button.getByText(name, { exact: true })).toHaveCSS('font-weight', name === selected ? '500' : '400')
  }
  const other = selected === ALPHA ? BETA : ALPHA
  await expect(async () => {
    expect((await navigationState(tab(page, selected))).surfaceContrast).toBeGreaterThan(
      (await navigationState(tab(page, other))).surfaceContrast
    )
    const sidebar = await navigationState(page.locator('[data-ui~="app.sidebar"] [aria-current="page"]'))
    const active = await navigationState(tab(page, selected))
    expect(sidebar.background).toEqual(active.background)
    expect(sidebar.foreground).toBe(active.foreground)
  }).toPass({ timeout: 10_000 })
}

async function expectDraft(page: Page, text: string) {
  await expect(async () => {
    const input = composer(page)
    if (await input.evaluate((element) => element instanceof HTMLTextAreaElement)) await expect(input).toHaveValue(text)
    else await expect(input).toHaveText(text)
  }).toPass({ timeout: 10_000 })
}

async function parkPointer(page: Page) {
  await expect(composer(page)).toBeVisible()
  const box = await composer(page).boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 4, box!.y + 4)
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await parkPointer(page)
  const bar = await strip(page).boundingBox()
  const input = await composer(page).boundingBox()
  expect(bar).not.toBeNull()
  expect(input).not.toBeNull()
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const top = Math.max(0, Math.floor(bar!.y))
  const path = testInfo.outputPath(name)
  await page.screenshot({
    path,
    clip: {
      x: 0,
      y: top,
      width: size.width,
      height: Math.min(size.height, Math.ceil(input!.y + input!.height + 24)) - top
    }
  })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function enterChat(page: Page) {
  const sidebar = page.locator('[data-ui~="app.sidebar"]')
  const chatEntry = sidebar.getByRole('button', { name: en['title.chat'], exact: true }).and(page.locator('button'))
  await expect(chatEntry).toHaveCount(1)
  await chatEntry.click()
  await expect(page.locator('[data-ui~="chat.view"]').filter({ visible: true })).toBeVisible()
}

async function revealTopics(page: Page) {
  const row = topicRow(page, ALPHA)
  if ((await row.count()) > 0) return
  const header = page.getByRole('button', { name: 'Active tab assistant', exact: true }).filter({ visible: true })
  await expect(header).toHaveCount(1)
  await header.click()
  await expect(row).toBeVisible({ timeout: 10_000 })
}

async function openSecondTab(page: Page, testInfo: TestInfo) {
  let route = 'topic.open-in-new-tab'
  try {
    await topicRow(page, BETA).click({ button: 'right', timeout: 5000 })
    await page.getByRole('menuitem', { name: en['common.open_in_new_tab'], exact: true }).click({ timeout: 5000 })
  } catch (error) {
    route = 'Launchpad → Chat → Beta'
    testInfo.annotations.push({ type: 'second-tab-fallback', description: String(error) })
    await page.keyboard.press('Escape')
    await strip(page).locator('[data-launchpad-button]').click()
    await expect(page.getByRole('heading', { name: en['launchpad.apps'], exact: true })).toBeVisible()
    await page.getByRole('button', { name: en['title.chat'], exact: true }).and(page.locator('button')).last().click()
    await revealTopics(page)
    await topicRow(page, BETA).click()
  }
  testInfo.annotations.push({ type: 'second-tab-route', description: route })
  await testInfo.attach('second-tab-route', { body: route, contentType: 'text/plain' })
}

for (const style of ['opaque', 'transparent'] as const) {
  for (const theme of [ThemeMode.light, ThemeMode.dark]) {
    test(`persistent selected conversation state: ${process.platform} ${style} ${theme}`, async ({
      isolatedSession
    }, testInfo) => {
      test.setTimeout(240_000)
      test.skip(style === 'transparent' && process.platform !== 'darwin', 'Transparent windows require macOS')
      let page = await isolatedSession.launch()
      await page.evaluate(
        async ({ policyVersion, windowStyle, themeMode }) => {
          await window.api.preference.setMultiple({
            'app.privacy.policy_version': policyVersion,
            'app.onboarding.provider_setup.status': 'skipped',
            'app.language': 'en-US',
            'menu.presentation_mode': 'cherry',
            'ui.window_style': windowStyle,
            'ui.theme_mode': themeMode
          })
        },
        { policyVersion: LATEST_PRIVACY_POLICY_VERSION, windowStyle: style, themeMode: theme }
      )
      await page.reload()
      await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 60_000 })
      page = await isolatedSession.launch()
      await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 60_000 })
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`))
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}\\b`))
      await expect(page.locator('body')).toHaveAttribute(
        'os',
        process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
      )
      const seeded = await page.evaluate(
        async ({ alphaName, betaName }) => {
          const assistant = await window.api.dataApi.request({
            id: crypto.randomUUID(),
            method: 'POST',
            path: '/assistants',
            body: { name: 'Active tab assistant' }
          })
          const assistantId = (assistant.data as { id?: string } | undefined)?.id
          if (assistant.status !== 201 || !assistantId) throw new Error(`Assistant seed: ${JSON.stringify(assistant)}`)
          const topics: Array<{ id: string; name: string }> = []
          for (const name of [alphaName, betaName]) {
            const response = await window.api.dataApi.request({
              id: crypto.randomUUID(),
              method: 'POST',
              path: '/topics',
              body: { name, assistantId }
            })
            const id = (response.data as { id?: string } | undefined)?.id
            if (response.status !== 201 || !id) throw new Error(`Topic seed: ${JSON.stringify(response)}`)
            topics.push({ id, name })
          }
          return topics
        },
        { alphaName: ALPHA, betaName: BETA }
      )
      for (const topic of seeded) expect(topic.id).toMatch(/^[0-9a-f-]{36}$/i)
      expect(seeded[0].id).not.toBe(seeded[1].id)
      await page.reload()
      await expect(page.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 60_000 })
      await enterChat(page)
      await revealTopics(page)
      await topicRow(page, ALPHA).click()
      await expect(tab(page, ALPHA)).toBeVisible()
      await openSecondTab(page, testInfo)
      await expect(tab(page, BETA)).toBeVisible()
      const alphaId = await tab(page, ALPHA).getAttribute('data-tab-id')
      const betaId = await tab(page, BETA).getAttribute('data-tab-id')
      expect(alphaId).toBeTruthy()
      expect(betaId).toBeTruthy()
      expect(alphaId).not.toBe(betaId)
      const opaque = style === 'opaque'
      await parkPointer(page)
      await expectSelection(page, BETA, opaque)
      await composer(page).fill('Unsent draft for Beta')
      await expectDraft(page, 'Unsent draft for Beta')
      const alphaFill = await tab(page, ALPHA).evaluate((element) => getComputedStyle(element).backgroundColor)
      await tab(page, ALPHA).hover()
      await expect
        .poll(() => tab(page, ALPHA).evaluate((element) => getComputedStyle(element).backgroundColor))
        .not.toBe(alphaFill)
      await expectSelection(page, BETA, opaque)
      await tab(page, ALPHA).click()
      await parkPointer(page)
      await expectSelection(page, ALPHA, opaque)
      await expectDraft(page, '')
      await composer(page).fill('Unsent draft for Alpha')
      await expectDraft(page, 'Unsent draft for Alpha')
      await capture(page, testInfo, `${style}-${theme}-alpha-active.png`)
      await tab(page, BETA).click()
      await parkPointer(page)
      await expectSelection(page, BETA, opaque)
      await expectDraft(page, 'Unsent draft for Beta')
      await capture(page, testInfo, `${style}-${theme}-beta-active.png`)
      await tab(page, ALPHA).click()
      await expectDraft(page, 'Unsent draft for Alpha')
      await tab(page, BETA).click()
      await expectDraft(page, 'Unsent draft for Beta')
      for (const name of [BETA, ALPHA]) {
        await tab(page, name).click({ button: 'right' })
        await expect(page.getByRole('menu').first()).toBeVisible()
        await expectSelection(page, BETA, opaque)
        await page.keyboard.press('Escape')
      }
      await page.keyboard.press('Tab')
      await tab(page, BETA).focus()
      await expect.poll(async () => (await navigationState(tab(page, BETA))).focusVisible).toBe(true)
      await expectSelection(page, BETA, opaque)
      const sidebar = page.locator('[data-ui~="app.sidebar"] [aria-current="page"]')
      await sidebar.focus()
      await expect.poll(async () => (await navigationState(sidebar)).focusVisible).toBe(true)
      await expectTabState(sidebar, true, opaque)
      await tab(page, BETA).click()
      await parkPointer(page)
      await testInfo.attach('computed-selection', {
        body: JSON.stringify(
          {
            profile: isolatedSession.profile,
            topics: seeded,
            alphaId,
            betaId,
            alpha: await navigationState(tab(page, ALPHA)),
            beta: await navigationState(tab(page, BETA)),
            environment: await page.evaluate(() => ({
              platform: navigator.platform,
              dpr: devicePixelRatio,
              zoom: visualViewport?.scale,
              font: getComputedStyle(document.body).fontFamily
            }))
          },
          null,
          2
        ),
        contentType: 'application/json'
      })
      if (style === 'opaque' && theme === ThemeMode.light) {
        await tab(page, BETA).click({ button: 'right' })
        await page.getByRole('menuitem', { name: en['tab.pin'], exact: true }).click()
        await tab(page, BETA).click()
        await expectTabState(tab(page, BETA), true, opaque)
        await expectTabState(tab(page, ALPHA), false, opaque)
        await expectDraft(page, 'Unsent draft for Beta')
        await capture(page, testInfo, 'pinned-active.png')
        await tab(page, ALPHA).click()
        await expectTabState(tab(page, ALPHA), true, opaque)
        await expectTabState(tab(page, BETA), false, opaque)
        await expectDraft(page, 'Unsent draft for Alpha')
        await tab(page, BETA).click()
        await expectTabState(tab(page, BETA), true, opaque)
        await expectDraft(page, 'Unsent draft for Beta')
      }
    })
  }
}
