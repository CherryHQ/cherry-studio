// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cacheService } from '@data/CacheService'
import en from '@renderer/i18n/locales/en-us.json'
import { ipcApi } from '@renderer/ipc'
import { BrowserSettings } from '@renderer/pages/settings/BrowserSettings'
import type { BrowserImportResult } from '@shared/ipc/schemas/browserImport'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebviewImportBanner } from '../WebviewImportBanner'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useCache')
vi.unmock('react-i18next')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/hooks/tab', () => ({ useTabs: () => ({ openTab: vi.fn() }) }))

const i18n = createInstance()
const emptyResult: BrowserImportResult = {
  cancelled: false,
  history: { imported: 0, skipped: 0, failed: 0, unsupported: false },
  cookies: { imported: 0, skipped: 0, failed: 0, unsupported: false },
  localStorage: { imported: 0, skipped: 0, failed: 0, unsupported: false }
}
const renderBanner = (settings = false) =>
  render(
    <I18nextProvider i18n={i18n}>
      <WebviewImportBanner />
      {settings && <BrowserSettings />}
    </I18nextProvider>
  )

beforeAll(async () => {
  Element.prototype.scrollIntoView = vi.fn()
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})
beforeEach(() => {
  MockCacheUtils.resetMocks()
  vi.mocked(ipcApi.request)
    .mockReset()
    .mockImplementation(async (route) => {
      if (route === 'browser.import.sources')
        return [{ id: 'chrome:Default', browser: 'chrome', profile: 'Default', history: true, cookies: 'supported' }]
      return emptyResult
    })
})
afterEach(cleanup)

describe('Browser import prompt', () => {
  it('remembers dismissal when the browser is reopened without scanning import sources', async () => {
    const user = userEvent.setup()
    const view = renderBanner()
    expect(screen.getByText(en['webview.browser.import_hint'])).toBeVisible()
    await user.click(screen.getByRole('button', { name: "Don't show again" }))
    expect(screen.queryByText(en['webview.browser.import_hint'])).not.toBeInTheDocument()
    expect(cacheService.getPersist('ui.browser.import_prompt_hidden')).toBe(true)
    view.unmount()
    renderBanner()
    expect(screen.queryByRole('button', { name: 'Import browser data' })).not.toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it.each(['cancelled', 'empty', 'failed'] as const)('keeps the prompt after an %s import', async (outcome) => {
    const user = userEvent.setup()
    renderBanner()
    await user.click(screen.getByRole('button', { name: 'Import browser data' }))
    const dialog = await screen.findByRole('dialog', { name: 'Import browser data' })
    await within(dialog).findByRole('combobox', { name: 'Browser' })
    if (outcome === 'failed') vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('Import failed'))
    else vi.mocked(ipcApi.request).mockResolvedValueOnce({ ...emptyResult, cancelled: outcome === 'cancelled' })
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    if (outcome === 'empty') await within(dialog).findByText('No new data was imported.')
    else if (outcome === 'failed') await within(dialog).findByRole('alert')
    else expect(await within(dialog).findByRole('button', { name: 'Import' })).toBeEnabled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import browser data' })).toBeVisible()
    expect(cacheService.getPersist('ui.browser.import_prompt_hidden')).toBe(false)
  })

  it.each([false, true])(
    'hides the prompt after importing via settings=%s while keeping the results open',
    async (settings) => {
      const user = userEvent.setup()
      const view = renderBanner(settings)
      await user.click(
        screen.getByRole('button', {
          name: settings ? 'Import Import browser data' : 'Import browser data'
        })
      )
      const dialog = await screen.findByRole('dialog', { name: 'Import browser data' })
      await within(dialog).findByRole('combobox', { name: 'Browser' })
      vi.mocked(ipcApi.request).mockResolvedValueOnce({
        ...emptyResult,
        cookies: { imported: 2, failed: 1, skipped: 0, unsupported: false }
      })
      await user.click(within(dialog).getByRole('button', { name: 'Import' }))
      expect(await within(dialog).findByText(en['settings.browser.importPartial'])).toBeVisible()
      expect(screen.queryByText(en['webview.browser.import_hint'])).not.toBeInTheDocument()
      expect(cacheService.getPersist('ui.browser.import_prompt_hidden')).toBe(true)
      await user.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
      view.unmount()
      renderBanner()
      expect(screen.queryByRole('button', { name: 'Import browser data' })).not.toBeInTheDocument()
    }
  )
})
