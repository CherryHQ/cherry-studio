import { rm } from 'node:fs/promises'

import { _electron as electron } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test as base } from './fixtures/electron.fixture'

const test = base.extend({
  electronApp: async ({}, use, testInfo) => {
    const profile = testInfo.outputPath('profile')
    const electronApp = await electron.launch({
      args: ['.'],
      env: { ...process.env, NODE_ENV: 'development', CS_DEV_PROFILE_ROOT: profile },
      timeout: 60000
    })
    try {
      await electronApp.context().tracing.start({ screenshots: true, snapshots: true })
      await use(electronApp)
    } finally {
      try {
        const path = testInfo.outputPath('settings-search-trace.zip')
        await electronApp.context().tracing.stop({ path })
        await testInfo.attach('settings-search-trace', { path, contentType: 'application/zip' })
      } finally {
        try {
          await electronApp.close()
        } finally {
          await rm(profile, { recursive: true, force: true })
        }
      }
    }
  }
})

const readActiveRoute = (page: Page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('cs_cache_persist')
    if (!raw) return null
    const cache = JSON.parse(raw) as {
      'ui.tab.normal_tabs'?: { id: string; url: string }[]
      'ui.tab.pinned_tabs'?: { id: string; url: string }[]
      'ui.tab.active_tab_id'?: string
    }
    const tabs = [...(cache['ui.tab.normal_tabs'] ?? []), ...(cache['ui.tab.pinned_tabs'] ?? [])]
    const tab = tabs.find((candidate) => candidate.id === cache['ui.tab.active_tab_id'])
    if (!tab) return null
    const url = new URL(tab.url, 'https://settings-test.invalid')
    return { id: tab.id, pathname: url.pathname, hasQ: url.searchParams.has('q'), q: url.searchParams.get('q') }
  })

async function openSearch(mainWindow: Page) {
  await mainWindow.evaluate(async (policyVersion) => {
    await window.api.preference.set('app.privacy.policy_version', policyVersion)
    await window.api.preference.set('app.onboarding.provider_setup.status', 'skipped')
    await window.api.preference.set('app.language', 'en-US')
  }, LATEST_PRIVACY_POLICY_VERSION)
  await mainWindow.reload()
  await expect(mainWindow.locator('[data-ui~="app.shell"]').first()).toBeVisible({ timeout: 60000 })
  await expect(
    mainWindow.getByRole('dialog', { name: en['privacy_policy_update.title'], exact: true }),
    'Setup failure: privacy policy modal reopened after setting the current policy version'
  ).toHaveCount(0)

  const sidebar = mainWindow.locator('[data-ui~="app.sidebar"]').filter({ visible: true })
  await sidebar.getByRole('button', { name: en['settings.title'], exact: true }).click()
  const settings = mainWindow.locator('[data-ui~="settings.view"]').filter({ visible: true })
  await expect(settings).toHaveCount(1)
  const navigation = settings.locator('[data-ui~="settings.navigation"]')
  const content = settings.locator('[data-ui~="settings.content"]')
  await navigation.getByRole('button', { name: en['settings.appearance.title'], exact: true }).click()
  await expect.poll(() => readActiveRoute(mainWindow)).toMatchObject({ pathname: '/settings/appearance' })
  const owningTabId = (await readActiveRoute(mainWindow))!.id
  const searchButton = navigation.getByRole('button', { name: en['settings.search.placeholder'], exact: true })
  await searchButton.click()
  const input = navigation.getByRole('combobox', { name: en['settings.search.placeholder'], exact: true })
  const clear = navigation.getByRole('button', { name: en['common.clear'], exact: true })
  await expect(input).toBeVisible()
  await expect(input).toBeFocused()
  await mainWindow.keyboard.type('proxy')
  await expect(content.getByRole('listbox')).toBeVisible()
  await expect
    .poll(() => readActiveRoute(mainWindow))
    .toEqual({
      id: owningTabId,
      pathname: '/settings/search',
      hasQ: true,
      q: 'proxy'
    })
  return { input, clear, content, searchButton, owningTabId }
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test('keeps settings search open and focused after keyboard clear', async ({ mainWindow }, testInfo) => {
  const { input, content, owningTabId } = await openSearch(mainWindow)
  const originalInput = await input.elementHandle()
  expect(originalInput).not.toBeNull()
  await mainWindow.keyboard.press('ControlOrMeta+A')
  await mainWindow.keyboard.press('Backspace')
  try {
    await expect(input, 'Issue #22782: keyboard clear must keep the settings combobox visible').toBeVisible()
    await expect(input).toHaveValue('')
    await expect(input, 'Issue #22782: clear must preserve DOM input focus').toBeFocused()
    expect(await originalInput!.evaluate((node) => node.isConnected && node === document.activeElement)).toBe(true)
    await expect
      .poll(() => readActiveRoute(mainWindow))
      .toEqual({
        id: owningTabId,
        pathname: '/settings/search',
        hasQ: false,
        q: null
      })
    await expect(content.getByText(en['settings.search.noResults'], { exact: true })).toHaveCount(0)
    await expect(content.getByText(en['settings.search.placeholder'], { exact: true })).toBeVisible()
    await expect(content.getByRole('listbox')).toHaveCount(0)
    await expect(input).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => input.getAttribute('aria-controls')).toBeNull()
    await expect.poll(() => input.getAttribute('aria-activedescendant')).toBeNull()
    await attachScreenshot(mainWindow, testInfo, 'settings-search-empty-focused')
  } catch (error) {
    await attachScreenshot(mainWindow, testInfo, 'settings-search-before-clear-collapse')
    await testInfo.attach('settings-search-post-clear-route', {
      body: JSON.stringify(await readActiveRoute(mainWindow)),
      contentType: 'application/json'
    })
    throw error
  }
  await mainWindow.keyboard.type('theme')
  await expect(input).toHaveValue('theme')
  await expect(input).toBeFocused()
  await expect
    .poll(() => readActiveRoute(mainWindow))
    .toEqual({
      id: owningTabId,
      pathname: '/settings/search',
      hasQ: true,
      q: 'theme'
    })
  const listbox = content.getByRole('listbox')
  await expect(listbox).toBeVisible()
  await expect(input).toHaveAttribute('aria-controls', (await listbox.getAttribute('id'))!)
  await attachScreenshot(mainWindow, testInfo, 'settings-search-replacement')
})

test('keeps settings search open and focused after pointer clear', async ({ mainWindow }) => {
  const { input, clear, content, owningTabId } = await openSearch(mainWindow)
  await clear.click()
  await expect(input, 'Issue #22782: pointer clear must keep the settings combobox visible').toBeVisible()
  await expect(input).toHaveValue('')
  await expect(input).toBeFocused()
  await expect
    .poll(() => readActiveRoute(mainWindow))
    .toEqual({
      id: owningTabId,
      pathname: '/settings/search',
      hasQ: false,
      q: null
    })
  await expect(content.getByText(en['settings.search.noResults'], { exact: true })).toHaveCount(0)
  await mainWindow.keyboard.type('theme')
  await expect(input).toHaveValue('theme')
  await expect(input).toBeFocused()
  await expect
    .poll(() => readActiveRoute(mainWindow))
    .toEqual({
      id: owningTabId,
      pathname: '/settings/search',
      hasQ: true,
      q: 'theme'
    })
  await expect(content.getByRole('listbox')).toBeVisible()
})

test('shows the neutral prompt for a blank query and the no-match message for a real miss', async ({ mainWindow }) => {
  const { clear, content } = await openSearch(mainWindow)
  await clear.click()
  const prompt = content.getByText(en['settings.search.placeholder'], { exact: true })
  const noResults = content.getByText(en['settings.search.noResults'], { exact: true })
  await expect(prompt).toBeVisible()
  await expect(noResults).toHaveCount(0)
  await mainWindow.keyboard.type('zzzz22782nomatch')
  await expect(noResults).toBeVisible()
  await expect(prompt).toHaveCount(0)
})

test('returns to the origin section once on Escape after clear and retype', async ({ mainWindow }) => {
  const { input, clear, searchButton, owningTabId } = await openSearch(mainWindow)
  await clear.click()
  await expect(input).toHaveValue('')
  await expect.poll(() => readActiveRoute(mainWindow)).toMatchObject({ id: owningTabId, hasQ: false })
  await mainWindow.keyboard.type('theme')
  await expect.poll(() => readActiveRoute(mainWindow)).toMatchObject({ id: owningTabId, q: 'theme' })
  await mainWindow.keyboard.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(searchButton).toBeVisible()
  await expect
    .poll(() => readActiveRoute(mainWindow))
    .toMatchObject({
      id: owningTabId,
      pathname: '/settings/appearance'
    })
  await mainWindow.waitForTimeout(300)
  expect(await readActiveRoute(mainWindow)).toMatchObject({ id: owningTabId, pathname: '/settings/appearance' })
})
