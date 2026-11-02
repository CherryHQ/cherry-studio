import { mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

const detailMocks = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({ openTab: vi.fn() })
}))
vi.mock('@renderer/components/VirtualList', () => ({
  GroupedVirtualList: () => null
}))
vi.mock('@renderer/services/AppErrorDetailService', () => ({
  buildInlineErrorDetailRequest: (input: unknown) => input
}))
vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => detailMocks.open(request),
  showDetailOpenFailed: vi.fn()
}))

import { BrowserHistoryDialog } from '../BrowserHistoryDialog'

describe('BrowserHistoryDialog errors', () => {
  beforeEach(async () => {
    detailMocks.open.mockReset()
    await i18n.changeLanguage('en-US')
  })

  it('prefers an action failure over a history load failure and keeps refresh', async () => {
    const loadCause = new Error('history down')
    const refreshCause = new Error('refresh exploded')
    const refresh = vi.fn().mockRejectedValue(refreshCause)
    mockUseInfiniteQuery.mockImplementation(() => ({
      pages: [],
      isLoading: false,
      isRefreshing: false,
      error: loadCause,
      hasNext: false,
      loadNext: vi.fn(),
      refresh,
      reset: vi.fn(),
      mutate: vi.fn()
    }))
    render(<BrowserHistoryDialog onOpenPage={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('settings.browser.error'))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('error.details') }))
    await waitFor(() =>
      expect(detailMocks.open).toHaveBeenCalledWith(
        expect.objectContaining({
          error: loadCause,
          message: i18n.t('settings.browser.error'),
          source: 'settings.browser',
          operation: 'browser.history.load'
        })
      )
    )

    detailMocks.open.mockClear()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.refresh') }))
    await act(async () => {
      await refresh.mock.results[0]?.value?.catch(() => undefined)
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('error.details') }))
    await waitFor(() =>
      expect(detailMocks.open).toHaveBeenCalledWith(
        expect.objectContaining({
          error: refreshCause,
          operation: 'browser.history.action',
          source: 'settings.browser',
          message: i18n.t('settings.browser.error')
        })
      )
    )
  })
})
