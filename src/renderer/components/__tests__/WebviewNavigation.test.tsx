// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { dataApiService } from '@data/DataApiService'
import en from '@renderer/i18n/locales/en-us.json'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { SWRConfig } from 'swr'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { WebviewNavigation } from '../WebviewNavigation'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useDataApi')
vi.unmock('react-i18next')
vi.mock('@renderer/components/WebviewAnnotationControls', () => ({ WebviewAnnotationControls: () => null }))

const i18n = createInstance()
const visit = (url: string, title: string) => ({ id: title, title, url, visitedAt: 1, source: 'local' })
const report = visit('http://internal.test/reports?lang=zh#latest', 'Monthly report')
const recent = [report, { ...report, title: 'Old report title' }, visit('https://example.com/', 'Example')]
const result = (items = recent) => ({ items, hasMore: false })

beforeAll(async () => {
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})
beforeEach(() => vi.mocked(dataApiService.get).mockReset().mockResolvedValue(result()))
afterEach(cleanup)

function setup(historyEnabled = true, url = 'https://current.test/') {
  const loadURL = vi.fn().mockResolvedValue(undefined)
  const guest = {
    getURL: () => url,
    canGoBack: () => false,
    canGoForward: () => false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    loadURL
  } as unknown as WebviewTag
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <I18nextProvider i18n={i18n}>
        <WebviewNavigation
          initialUrl={url}
          webviewRef={{ current: guest }}
          webviewRevision={1}
          historyEnabled={historyEnabled}
          isWebviewReady
          isHostActive
          target={{ id: 'test-browser', label: 'Browser' }}
        />
      </I18nextProvider>
    </SWRConfig>
  )
  return { loadURL, address: screen.getByRole(historyEnabled ? 'combobox' : 'textbox', { name: 'Web address' }) }
}

describe('Browser address history', () => {
  it('loads history only on focus, deduplicates URLs and opens a searched result with the keyboard', async () => {
    const user = userEvent.setup()
    const { address, loadURL } = setup()
    expect(dataApiService.get).not.toHaveBeenCalled()
    await user.click(address)
    expect(await screen.findAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: /Monthly report/ })).toBeVisible()
    expect(screen.queryByText('Old report title')).not.toBeInTheDocument()
    vi.mocked(dataApiService.get).mockResolvedValue(result([report]))
    await user.clear(address)
    await user.type(address, 'report')
    await waitFor(() =>
      expect(dataApiService.get).toHaveBeenLastCalledWith(
        '/browser-visits',
        expect.objectContaining({ query: { search: 'report', offset: 0, limit: 20 } })
      )
    )
    await screen.findByRole('option', { name: /Monthly report/ })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(loadURL).toHaveBeenCalledWith(report.url)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('opens a clicked history item without blur replacing its URL', async () => {
    const user = userEvent.setup()
    const { address, loadURL } = setup()
    await user.click(address)
    await user.click(await screen.findByRole('option', { name: /Monthly report/ }))
    expect(loadURL).toHaveBeenCalledWith(report.url)
    expect(address).toHaveValue('internal.test')
  })

  it('keeps free-form URL submission and ignores Enter while composing', async () => {
    const user = userEvent.setup()
    const { address, loadURL } = setup()
    await user.click(address)
    await screen.findAllByRole('option')
    await user.clear(address)
    await user.type(address, 'http://localhost:3000/new')
    fireEvent.keyDown(address, { key: 'Enter', isComposing: true })
    expect(loadURL).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(loadURL).toHaveBeenCalledWith('http://localhost:3000/new')
  })

  it('dismisses suggestions with Escape and restores the current address without navigation', async () => {
    const user = userEvent.setup()
    const { address, loadURL } = setup()
    await user.click(address)
    await screen.findAllByRole('option')
    await user.clear(address)
    await user.type(address, 'report')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(address).toHaveValue('current.test')
    expect(loadURL).not.toHaveBeenCalled()
  })

  it('cannot select an earlier search while a newer search is loading or after its late response', async () => {
    const user = userEvent.setup()
    const { address, loadURL } = setup()
    await user.click(address)
    await screen.findAllByRole('option')
    let finish!: (value: ReturnType<typeof result>) => void
    vi.mocked(dataApiService.get).mockReturnValueOnce(
      new Promise<ReturnType<typeof result>>((resolve) => {
        finish = resolve
      })
    )
    await user.clear(address)
    await user.type(address, 'old')
    await waitFor(() =>
      expect(dataApiService.get).toHaveBeenLastCalledWith(
        '/browser-visits',
        expect.objectContaining({ query: { search: 'old', offset: 0, limit: 20 } })
      )
    )
    vi.mocked(dataApiService.get).mockResolvedValue(result([visit('https://new.test/', 'New result')]))
    await user.clear(address)
    await user.type(address, 'new')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    await screen.findByRole('option', { name: /New result/ })
    await act(async () => finish(result([report])))
    expect(screen.queryByRole('option', { name: /Monthly report/ })).not.toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(loadURL).toHaveBeenCalledWith('https://new.test/')
  })

  it('does not expose ordinary browser history in preview surfaces', async () => {
    const user = userEvent.setup()
    const { address } = setup(false)
    await user.click(address)
    await user.clear(address)
    await user.type(address, 'report')
    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('Browser address display', () => {
  it.each([
    ['https://github.com/maizzle/framework?tab=readme#start', 'github.com'],
    ['http://localhost:3000/reports?lang=zh#latest', 'localhost:3000'],
    ['https://docs.example.com/project', 'docs.example.com'],
    ['file:///tmp/preview.html', 'file:///tmp/preview.html']
  ])('expands %s only when focused and restores it after cancelling an edit', async (url, compact) => {
    const user = userEvent.setup()
    const { address, loadURL } = setup(false, url)
    expect(address).toHaveValue(compact)
    await user.hover(address)
    expect(address).toHaveValue(compact)
    await user.click(address)
    expect(address).toHaveValue(url)
    const input = address as HTMLInputElement
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(url.length)
    await user.keyboard('unsaved draft')
    await user.tab()
    expect(address).toHaveValue(compact)
    fireEvent.focus(address)
    expect(address).toHaveValue(url)
    expect(loadURL).not.toHaveBeenCalled()
  })
})
