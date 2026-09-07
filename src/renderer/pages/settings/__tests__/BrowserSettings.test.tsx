// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { ipcApi } from '@renderer/ipc'
import { popup } from '@renderer/services/popup'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BrowserSettings } from '../BrowserSettings'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/popup', () => ({ popup: { confirm: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('Browser settings data boundaries', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    MockUseDataApiUtils.mockQueryData('/browser-visits', { items: [], hasMore: false })
    vi.mocked(ipcApi.request)
      .mockReset()
      .mockImplementation(async (route) => {
        if (route === 'browser.import.sources') return []
        if (route === 'browser.pane.list') return []
        return undefined
      })
    vi.mocked(popup.confirm).mockReset()
  })

  it('keeps file import available with control off and lets the user select categories and domains', async () => {
    const user = userEvent.setup()
    let imported: unknown
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'browser.import.run') {
        imported = input
        return {
          cancelled: false,
          history: { imported: 0, skipped: 0, failed: 0, unsupported: false },
          cookies: { imported: 1, skipped: 0, failed: 0, unsupported: false },
          localStorage: { imported: 0, skipped: 0, failed: 0, unsupported: false }
        }
      }
      return []
    })
    render(<BrowserSettings />)
    expect(screen.getByRole('switch', { name: 'settings.browser.control' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'settings.browser.history' })).toBeDisabled()
    await user.type(screen.getByLabelText('settings.browser.domains'), 'example.com, internal.test')
    await user.click(screen.getByRole('button', { name: 'settings.browser.import' }))
    await screen.findByRole('status')
    expect(imported).toEqual({
      sourceId: undefined,
      history: false,
      cookies: true,
      localStorage: false,
      domains: ['example.com', 'internal.test']
    })
  })

  it('requires confirmation before clearing shared site data and keeps clearing categories separate', async () => {
    const user = userEvent.setup()
    const cleared: unknown[] = []
    vi.mocked(ipcApi.request).mockImplementation(async (route, input) => {
      if (route === 'browser.data.clear') cleared.push(input)
      return []
    })
    render(<BrowserSettings />)
    vi.mocked(popup.confirm).mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: 'settings.browser.clearSite' }))
    expect(cleared).toEqual([])
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'settings.browser.clearSite' }))
    await waitFor(() => expect(cleared).toEqual([{ kind: 'site_data' }]))
    vi.mocked(popup.confirm).mockResolvedValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'settings.browser.cache' }))
    await waitFor(() => expect(cleared).toEqual([{ kind: 'site_data' }, { kind: 'cache' }]))
  })
})
