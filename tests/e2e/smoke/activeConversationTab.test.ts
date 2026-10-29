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

async function frameState(button: Locator, dark: boolean) {
  return button.evaluate((element, isDark) => {
    const probe = document.createElement('span')
    const rootProbe = document.createElement('span')
    const stockProbe = document.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden;box-shadow:inset 0 0 0 1px var(--border-selected)'
    rootProbe.style.color = 'var(--border-selected)'
    stockProbe.style.color = `oklch(${isDark ? 1 : 0} 0 0 / 0.3)`
    element.append(probe)
    document.documentElement.append(rootProbe, stockProbe)
    try {
      const layers = (value: string) => {
        if (value === 'none') return []
        const result: string[] = []
        let depth = 0
        let start = 0
        for (let index = 0; index < value.length; index++) {
          if (value[index] === '(') depth++
          if (value[index] === ')') depth--
          if (value[index] === ',' && depth === 0) {
            result.push(value.slice(start, index).trim())
            start = index + 1
          }
        }
        result.push(value.slice(start).trim())
        return result
      }
      const geometry = (layer: string) => [...layer.matchAll(/(-?\d*\.?\d+)px/g)].map((match) => Number(match[1]))
      const painted = layers(getComputedStyle(element).boxShadow).filter((layer) => {
        const transparent = /(?:rgba\([^)]*,\s*0(?:\.0+)?\)|\/\s*0(?:\.0+)?\s*\))/.test(layer)
        const dimensions = geometry(layer)
        return !(transparent && dimensions.length === 4 && dimensions.every((value) => value === 0))
      })
      const expected = getComputedStyle(probe).boxShadow
      return {
        shadow: getComputedStyle(element).boxShadow,
        painted,
        expected,
        geometry: geometry(expected),
        inset: expected.includes('inset'),
        rootToken: getComputedStyle(document.documentElement).getPropertyValue('--border-selected').trim(),
        rootColor: getComputedStyle(rootProbe).color,
        stockColor: getComputedStyle(stockProbe).color
      }
    } finally {
      probe.remove()
      rootProbe.remove()
      stockProbe.remove()
    }
  }, dark)
}

async function expectFrame(button: Locator, selected: boolean, dark: boolean) {
  await expect(async () => {
    const state = await frameState(button, dark)
    expect(state.rootToken).not.toBe('')
    expect(state.rootColor).toBe(state.stockColor)
    expect(state.inset).toBe(true)
    expect(state.geometry).toEqual([0, 0, 0, 1])
    if (selected) expect(state.painted).toEqual([state.expected])
    else expect(state.painted).not.toContain(state.expected)
  }).toPass({ timeout: 10_000 })
}

async function expectSelection(page: Page, selected: string, dark: boolean) {
  for (const name of [ALPHA, BETA]) {
    const button = tab(page, name)
    await expectFrame(button, name === selected, dark)
    await expect(button.getByText(name, { exact: true })).toHaveCSS('font-weight', name === selected ? '500' : '400')
  }
}

async function expectDraft(page: Page, text: string) {
  await expect(async () => {
    const input = composer(page)
    if (await input.evaluate((element) => element instanceof HTMLTextAreaElement)) await expect(input).toHaveValue(text)
    else await expect(input).toHaveText(text)
  }).toPass({ timeout: 10_000 })
}

async function parkPointer(page: Page) {
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
    test(`persistent selected conversation frame: macOS ${style} ${theme}`, async ({ isolatedSession }, testInfo) => {
      test.setTimeout(240_000)
      test.skip(process.platform !== 'darwin', 'The window-style matrix requires real macOS windows')
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
      await expect(page.locator('body')).toHaveAttribute('os', 'mac')
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
      await expect
        .poll(() =>
          tab(page, BETA).evaluate(
            (element, fill) => element.classList.contains(fill),
            style === 'transparent' ? 'bg-white/78' : 'bg-black/8'
          )
        )
        .toBe(true)
      const dark = theme === ThemeMode.dark
      await parkPointer(page)
      await expectSelection(page, BETA, dark)
      await composer(page).fill('Unsent draft for Beta')
      await expectDraft(page, 'Unsent draft for Beta')
      const alphaFill = await tab(page, ALPHA).evaluate((element) => getComputedStyle(element).backgroundColor)
      await tab(page, ALPHA).hover()
      await expect
        .poll(() => tab(page, ALPHA).evaluate((element) => getComputedStyle(element).backgroundColor))
        .not.toBe(alphaFill)
      await expectSelection(page, BETA, dark)
      await tab(page, ALPHA).click()
      await parkPointer(page)
      await expectSelection(page, ALPHA, dark)
      await expectDraft(page, '')
      await composer(page).fill('Unsent draft for Alpha')
      await expectDraft(page, 'Unsent draft for Alpha')
      await capture(page, testInfo, `${style}-${theme}-alpha-active.png`)
      await tab(page, BETA).click()
      await parkPointer(page)
      await expectSelection(page, BETA, dark)
      await expectDraft(page, 'Unsent draft for Beta')
      await capture(page, testInfo, `${style}-${theme}-beta-active.png`)
      await tab(page, ALPHA).click()
      await expectDraft(page, 'Unsent draft for Alpha')
      await tab(page, BETA).click()
      await expectDraft(page, 'Unsent draft for Beta')
      for (const name of [BETA, ALPHA]) {
        await tab(page, name).click({ button: 'right' })
        await expect(page.getByRole('menu').first()).toBeVisible()
        await expectSelection(page, BETA, dark)
        await page.keyboard.press('Escape')
      }
      await testInfo.attach('computed-selection', {
        body: JSON.stringify(
          {
            profile: isolatedSession.profile,
            topics: seeded,
            alphaId,
            betaId,
            alpha: await frameState(tab(page, ALPHA), dark),
            beta: await frameState(tab(page, BETA), dark),
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
        await expectFrame(tab(page, BETA), true, dark)
        await expectFrame(tab(page, ALPHA), false, dark)
        await expectDraft(page, 'Unsent draft for Beta')
        await capture(page, testInfo, 'pinned-active.png')
        await tab(page, ALPHA).click()
        await expectFrame(tab(page, ALPHA), true, dark)
        await expectFrame(tab(page, BETA), false, dark)
        await expectDraft(page, 'Unsent draft for Alpha')
        await tab(page, BETA).click()
        await expectFrame(tab(page, BETA), true, dark)
        await expectDraft(page, 'Unsent draft for Beta')
      }
    })
  }
}
