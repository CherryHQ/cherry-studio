// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import en from '@renderer/i18n/locales/en-us.json'
import { ipcApi } from '@renderer/ipc'
import type { BrowserImportReason, BrowserImportResult, BrowserImportSource } from '@shared/ipc/schemas/browserImport'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserSettings } from '../BrowserSettings'

vi.unmock('@cherrystudio/ui')
vi.unmock('react-i18next')
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
const { openTab } = vi.hoisted(() => ({ openTab: vi.fn() }))
vi.mock('@renderer/hooks/tab', () => ({ useTabs: () => ({ openTab }) }))
const i18n = createInstance()
const chrome: BrowserImportSource = {
  id: 'chrome:Default',
  browser: 'chrome',
  profile: 'Default',
  history: true,
  cookies: 'requires_authorization'
}
const firefox: BrowserImportSource = {
  id: 'firefox:Default',
  browser: 'firefox',
  profile: 'Default',
  history: false,
  cookies: 'supported'
}
const emptyResult = (): BrowserImportResult => ({
  cancelled: false,
  history: { imported: 0, skipped: 0, failed: 0, unsupported: false },
  cookies: { imported: 0, skipped: 0, failed: 0, unsupported: false },
  localStorage: { imported: 0, skipped: 0, failed: 0, unsupported: false }
})
const renderSettings = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <BrowserSettings />
    </I18nextProvider>
  )

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en } },
    keySeparator: false,
    interpolation: { escapeValue: false }
  })
})
afterEach(cleanup)
beforeEach(() => {
  openTab.mockReset()
  MockUseDataApiUtils.resetMocks()
  MockUseDataApiUtils.mockQueryData('/browser-visits', { items: [], hasMore: false })
  vi.mocked(ipcApi.request)
    .mockReset()
    .mockImplementation(async (route) => {
      if (route === 'browser.import.sources') return [chrome]
      if (route === 'browser.import.run') return emptyResult()
      return undefined
    })
})

describe('Browser settings workflows', () => {
  it('opens the import flow by keyboard, defaults to supported data, and restores focus on Escape', async () => {
    const user = userEvent.setup()
    renderSettings()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(ipcApi.request).not.toHaveBeenCalled()
    const trigger = screen.getByRole('button', { name: 'Import Import browser data' })
    trigger.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Import browser data' })
    expect(await within(dialog).findByRole('combobox', { name: 'Browser' })).toHaveTextContent('Google Chrome')
    expect(within(dialog).queryByRole('combobox', { name: 'Profile' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Importing: History · Website data')).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Import' }))
    await screen.findByText('Import complete')
    expect(ipcApi.request).toHaveBeenCalledWith('browser.import.run', {
      sourceId: chrome.id,
      history: true,
      cookies: true,
      localStorage: false,
      domains: []
    })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('imports a cookie-only profile without requiring an unavailable history choice', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'browser.import.sources' ? [firefox] : emptyResult()
    )
    renderSettings()
    await user.click(screen.getByRole('button', { name: 'Import Import browser data' }))
    await screen.findByText('Importing: Website data')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('Import complete')
    expect(ipcApi.request).toHaveBeenCalledWith('browser.import.run', {
      sourceId: firefox.id,
      history: false,
      cookies: true,
      localStorage: false,
      domains: []
    })
  })

  it('keeps file import available with control off and does not report cancellation as success', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'browser.import.sources' ? [] : { ...emptyResult(), cancelled: true }
    )
    renderSettings()
    expect(screen.getByRole('switch', { name: 'Allow Agent browser control' })).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Import Import browser data' }))
    const pick = await screen.findByRole('button', { name: 'Choose file…' })
    await user.click(pick)
    await waitFor(() => expect(pick).toBeEnabled())
    expect(screen.queryByText('Import complete')).not.toBeInTheDocument()
    expect(ipcApi.request).toHaveBeenCalledWith('browser.import.run', {
      sourceId: undefined,
      history: false,
      cookies: true,
      localStorage: true,
      domains: []
    })
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('shows partial results and prevents duplicate imports or dismissal while importing', async () => {
    const user = userEvent.setup()
    let finish!: (value: BrowserImportResult) => void
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'browser.import.sources'
        ? [chrome]
        : new Promise<BrowserImportResult>((resolve) => {
            finish = resolve
          })
    )
    renderSettings()
    await user.click(screen.getByRole('button', { name: 'Import Import browser data' }))
    await screen.findByText('Importing: History · Website data')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeVisible()
    finish({ ...emptyResult(), history: { imported: 4, skipped: 0, failed: 1, unsupported: false } })
    await screen.findByText('Import finished with some data unavailable')
    expect(screen.getByRole('status')).toHaveTextContent('Imported 4, skipped 0, failed 1')
    expect(screen.queryByText('Import complete')).not.toBeInTheDocument()
  })

  it('can retry browser discovery after an error', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockRejectedValueOnce(new Error('Read failed'))
    renderSettings()
    await user.click(screen.getByRole('button', { name: 'Import Import browser data' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('Importing: History · Website data')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    ['access_denied', 'Key access was denied: 159. Retry and allow access in the system prompt.'],
    ['app_bound', 'Protected by Windows app-bound encryption: 159. Sign in again in the built-in browser.']
  ] satisfies [BrowserImportReason, string][])(
    'explains %s and does not claim zero imported website data is ready to use',
    async (reason, message) => {
      const user = userEvent.setup()
      vi.mocked(ipcApi.request).mockImplementation(async (route) =>
        route === 'browser.import.sources'
          ? [chrome]
          : {
              ...emptyResult(),
              history: { imported: 627, skipped: 5, failed: 0, unsupported: false },
              cookies: { imported: 0, skipped: 159, failed: 0, unsupported: true, reasons: { [reason]: 159 } }
            }
      )
      renderSettings()
      await user.click(screen.getByRole('button', { name: 'Import Import browser data' }))
      await screen.findByText('Importing: History · Website data')
      await user.click(screen.getByRole('button', { name: 'Import' }))
      expect(await screen.findByText(message)).toBeVisible()
      expect(screen.getByText('Review the imported and skipped data below.')).toBeVisible()
      expect(screen.queryByText(en['settings.browser.importFinishHelp'])).not.toBeInTheDocument()
      expect(screen.getByText('Import finished with some data unavailable')).toBeVisible()
    }
  )

  it('offers reload guidance only after website data was imported', async () => {
    const user = userEvent.setup()
    vi.mocked(ipcApi.request).mockImplementation(async (route) =>
      route === 'browser.import.sources'
        ? [chrome]
        : {
            ...emptyResult(),
            cookies: { imported: 2, skipped: 1, failed: 0, unsupported: false, reasons: { expired: 1 } }
          }
    )
    renderSettings()
    await user.click(screen.getByRole('button', { name: 'Import Import browser data' }))
    await screen.findByText('Importing: History · Website data')
    await user.click(screen.getByRole('button', { name: 'Import' }))
    expect(await screen.findByText(en['settings.browser.importFinishHelp'])).toBeVisible()
    expect(screen.getByText('Expired cookies: 1.')).toBeVisible()
    expect(screen.getByText('Import complete')).toBeVisible()
  })

  it('requires an explicit clear action and retries only categories that have not been cleared', async () => {
    const user = userEvent.setup()
    const historyDeleted = vi.fn().mockResolvedValue({ success: true })
    MockUseDataApiUtils.mockMutationWithTrigger('DELETE', '/browser-visits', historyDeleted)
    const cleared: string[] = []
    let fail = true
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'browser.data.clear') {
        const { kind } = input as { kind: string }
        if (fail && kind === 'site_data') throw new Error('Clear failed')
        cleared.push(kind)
      }
      return undefined
    })
    renderSettings()
    await user.click(screen.getByRole('button', { name: 'Clear Clear browsing data' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cleared).toEqual([])
    expect(historyDeleted).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Clear Clear browsing data' }))
    await user.click(screen.getByRole('checkbox', { name: 'History' }))
    await user.click(screen.getByRole('checkbox', { name: 'Website data' }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('checkbox', { name: 'History' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Website data' })).toBeChecked()
    expect(historyDeleted).toHaveBeenCalledTimes(1)
    fail = false
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(cleared).toEqual(['site_data', 'cache'])
    expect(historyDeleted).toHaveBeenCalledTimes(1)
  })

  it('opens history in a new browser tab without an Agent pane, preserving the complete URL', async () => {
    const user = userEvent.setup()
    const url = 'http://internal.test/dashboard?q=a%26b&lang=zh#section'
    MockUseDataApiUtils.mockQueryData('/browser-visits', {
      items: [{ id: 'visit-1', title: 'Dashboard', url, visitedAt: Date.now(), source: 'local' }],
      hasMore: false
    })
    renderSettings()
    await user.click(screen.getByRole('button', { name: 'Manage History' }))
    const open = await screen.findByRole('button', { name: 'Open in new tab' })
    await waitFor(() => expect(open).toBeEnabled())
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(open)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(openTab).toHaveBeenCalledWith(
      '/app/browser?url=http%3A%2F%2Finternal.test%2Fdashboard%3Fq%3Da%2526b%26lang%3Dzh%23section',
      { title: 'Dashboard', forceNew: true }
    )
    expect(ipcApi.request).not.toHaveBeenCalled()
  })
})
