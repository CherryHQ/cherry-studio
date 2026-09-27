// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ request: vi.fn(), warn: vi.fn(), toastError: vi.fn() }))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: (...args: unknown[]) => mocks.request(...args) } }))
vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ warn: mocks.warn }) }
}))
vi.mock('@renderer/services/toast', () => ({ toast: { error: (...args: unknown[]) => mocks.toastError(...args) } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string) =>
      ({
        'settings.about.feedback.history.title': 'Diagnostic history',
        'settings.about.feedback.history.empty': 'No diagnostic reports',
        'settings.about.feedback.history.open': 'Open',
        'settings.about.feedback.history.refresh_failed': 'Could not refresh some statuses',
        'settings.about.feedback.history.previous': 'Previous',
        'settings.about.feedback.history.next': 'Next',
        'settings.about.diagnostics.status.pending': 'Pending',
        'settings.about.diagnostics.status.unavailable': 'Unavailable',
        'common.refresh': 'Refresh'
      })[key] ?? key
  })
}))

import DiagnosticHistoryDialog from '../DiagnosticHistoryDialog'

describe('DiagnosticHistoryDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseDataApiUtils.resetMocks()
    mocks.request.mockResolvedValue({ processingStatus: 'pending' })
  })

  it('shows saved reports and flags a failed remote refresh without losing the history', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockQueryResult('/diagnostic-reports', {
      data: {
        items: [
          { reportId: 'report-1', submittedAt: 1_780_000_000_000, processingStatus: 'pending', lastCheckedAt: null },
          { reportId: 'report-2', submittedAt: 1_780_000_000_001, processingStatus: null, lastCheckedAt: null }
        ],
        page: 1,
        total: 2
      },
      refetch
    })
    mocks.request.mockImplementation(async (route: string, input: { reportId?: string }) => {
      if (route === 'diagnostics.report.refresh' && input.reportId === 'report-2') throw new Error('offline')
      return undefined
    })

    render(<DiagnosticHistoryDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText('report-1')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Could not refresh some statuses')).toBeInTheDocument())
    expect(refetch).toHaveBeenCalled()
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0])
    expect(mocks.request).toHaveBeenCalledWith(
      'system.shell.open_website',
      'https://api.cherry-ai.com/diagnostics/report-1'
    )
  })

  it('does not request remote statuses when history is empty', () => {
    MockUseDataApiUtils.mockQueryData('/diagnostic-reports', { items: [], page: 1, total: 0 })

    render(<DiagnosticHistoryDialog open onOpenChange={vi.fn()} />)

    expect(screen.getByText('No diagnostic reports')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('revalidates an open history dialog when diagnostic reports change', async () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    MockUseDataApiUtils.mockQueryResult('/diagnostic-reports', {
      data: { items: [], page: 1, total: 0 },
      refetch
    })

    render(<DiagnosticHistoryDialog open onOpenChange={vi.fn()} />)

    MockUseDataApiUtils.emitDataChange([{ endpoint: '/diagnostic-reports', kind: 'membership' }])

    await waitFor(() => expect(refetch).toHaveBeenCalledExactlyOnceWith())
  })

  it('disables refresh and pagination controls while the query is revalidating', async () => {
    MockUseDataApiUtils.mockQueryResult('/diagnostic-reports', {
      data: {
        items: [{ reportId: 'report-1', submittedAt: 1, processingStatus: 'pending', lastCheckedAt: null }],
        page: 1,
        total: 21
      },
      isRefreshing: true
    })

    render(<DiagnosticHistoryDialog open onOpenChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    })
  })

  it('refreshes only visible IDs once per page and supports manual refresh', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn().mockResolvedValue(undefined)
    const firstPage = {
      items: [{ reportId: 'first-page', submittedAt: 1, processingStatus: 'pending' as const, lastCheckedAt: null }],
      page: 1,
      total: 21
    }
    MockUseDataApiUtils.mockQueryResult('/diagnostic-reports', { data: firstPage, refetch })
    render(<DiagnosticHistoryDialog open onOpenChange={vi.fn()} />)

    const refreshedIds = () =>
      mocks.request.mock.calls
        .filter(([route]) => route === 'diagnostics.report.refresh')
        .map(([, input]) => input.reportId)
    await waitFor(() => expect(refreshedIds()).toEqual(['first-page']))
    expect(refetch).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(refreshedIds()).toEqual(['first-page', 'first-page']))
    MockUseDataApiUtils.mockQueryResult('/diagnostic-reports', {
      data: {
        items: [{ reportId: 'second-page', submittedAt: 2, processingStatus: 'resolved', lastCheckedAt: null }],
        page: 2,
        total: 21
      },
      refetch
    })
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(refreshedIds()).toEqual(['first-page', 'first-page', 'second-page']))
    expect(screen.getByText('second-page')).toBeInTheDocument()
    expect(screen.queryByText('first-page')).not.toBeInTheDocument()
  })
})
