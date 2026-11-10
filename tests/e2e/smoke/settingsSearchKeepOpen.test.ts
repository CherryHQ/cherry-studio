import type { Page } from '@playwright/test'

import en from '../../../src/renderer/i18n/locales/en-us.json'
import { LATEST_PRIVACY_POLICY_VERSION } from '../../../src/shared/utils/constants'
import { expect, test as base } from './fixtures/electron.fixture'
import { openSettings } from './utils/navigation'

const test = base.extend({
  electronApp: async ({ electronApp }, use, testInfo) => {
    await electronApp.context().tracing.start({ screenshots: true, snapshots: true })
    try {
      await use(electronApp)
    } finally {
      const path = testInfo.outputPath('settings-search-trace.zip')
      await electronApp.context().tracing.stop({ path })
      await testInfo.attach('settings-search-trace', { path, contentType: 'application/zip' })
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
  await expect(mainWindow.locator('[data-ui~="app.content"]').first()).toBeVisible({ timeout: 60000 })
  await expect(
    mainWindow.getByRole('dialog', { name: en['privacy_policy_update.title'], exact: true }),
    'Setup failure: privacy policy modal reopened after setting the current policy version'
  ).toHaveCount(0)

  await openSettings(mainWindow)
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
