import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LocalModelsSection from '../LocalModelsSection'

type ProgressPayload = { id: string; status: string; percent: number }

const mockRequest = vi.fn()
// Both cards subscribe, so collect every handler and fan a progress event out to
// all of them — each card ignores events whose `id` isn't its own.
const { progressHandlers } = vi.hoisted(() => ({
  progressHandlers: [] as Array<(p: ProgressPayload) => void>
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mockRequest(...args) },
  useIpcOn: (_event: string, handler: (p: ProgressPayload) => void) => {
    progressHandlers.push(handler)
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel
  }: {
    children?: ReactNode
    onClick?: () => void
    'aria-label'?: string
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
  DescriptionSwitch: ({
    checked,
    description,
    label,
    onCheckedChange
  }: {
    checked: boolean
    description?: string
    label: string
    onCheckedChange: (checked: boolean) => void
  }) => (
    <label>
      <span>{label}</span>
      {description && <span>{description}</span>}
      <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
    </label>
  )
}))

const EMBEDDING = 'qwen3-embedding-0.6b'

/** What the registry reports as installable; the cards are rendered from it. */
const LISTED_MODELS = {
  models: [
    { id: EMBEDDING, capability: 'embedding' },
    { id: 'pp-ocrv6-medium', capability: 'ocr' }
  ]
}

/** Answer `local_model.list` for every test, and layer the test's own routes over it. */
function mockRoutes(handler: (route: string, input?: { id: string }) => unknown): void {
  mockRequest.mockImplementation((route: string, input?: { id: string }) =>
    route === 'local_model.list' ? Promise.resolve(LISTED_MODELS) : Promise.resolve(handler(route, input))
  )
}

/** The embedding card is the first of the two rendered list items. */
const embeddingCard = () => screen.getAllByRole('listitem')[0]

describe('LocalModelsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    progressHandlers.length = 0
  })

  it('shows a supported acceleration switch and persists the user choice', async () => {
    const user = userEvent.setup()
    mockRoutes((route) => {
      if (route === 'local_model.get_acceleration_capability') return Promise.resolve({ supported: true })
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      return Promise.resolve()
    })

    render(<LocalModelsSection />)

    const acceleration = await screen.findByRole('checkbox', {
      name: /settings\.dependencies\.localModels\.acceleration\.label/
    })
    expect(acceleration).not.toBeChecked()

    await user.click(acceleration)

    expect(MockUsePreferenceUtils.getPreferenceValue('feature.local_model.hardware_acceleration.enabled')).toBe(true)
  })

  it('hides the acceleration switch when the main process reports no supported provider', async () => {
    mockRoutes((route) => {
      if (route === 'local_model.get_acceleration_capability') return Promise.resolve({ supported: false })
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      return Promise.resolve()
    })

    render(<LocalModelsSection />)

    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_acceleration_capability'))
    expect(
      screen.queryByRole('checkbox', { name: /settings\.dependencies\.localModels\.acceleration\.label/ })
    ).not.toBeInTheDocument()
  })

  it('logs acceleration capability probe failures while keeping the switch hidden', async () => {
    const error = new Error('capability probe failed')
    const warnSpy = vi.spyOn(mockRendererLoggerService, 'warn').mockImplementation(() => {})
    mockRoutes((route) => {
      if (route === 'local_model.get_acceleration_capability') return Promise.reject(error)
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      return Promise.resolve()
    })

    render(<LocalModelsSection />)

    await waitFor(() =>
      expect(warnSpy).toHaveBeenCalledWith('Failed to detect local inference hardware acceleration', error)
    )
    expect(
      screen.queryByRole('checkbox', { name: /settings\.dependencies\.localModels\.acceleration\.label/ })
    ).not.toBeInTheDocument()
  })

  it('renders live percent, and cancelling neither fails nor shows a failure notice', async () => {
    let resolveDownload: ((result: { result: 'cancelled' }) => void) | undefined
    mockRoutes((route, input) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download' && input?.id === EMBEDDING)
        return new Promise<{ result: 'cancelled' }>((resolve) => (resolveDownload = resolve))
      return Promise.resolve()
    })

    render(<LocalModelsSection />)
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_status', { id: EMBEDDING }))

    fireEvent.click(within(embeddingCard()).getByText('settings.dependencies.localModels.download'))
    await waitFor(() =>
      expect(within(embeddingCard()).getByText('settings.dependencies.localModels.cancel')).toBeInTheDocument()
    )

    act(() => progressHandlers.forEach((h) => h({ id: EMBEDDING, status: 'downloading', percent: 45 })))
    expect(within(embeddingCard()).getByText('45%')).toBeInTheDocument()

    fireEvent.click(within(embeddingCard()).getByText('settings.dependencies.localModels.cancel'))
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.cancel', { id: EMBEDDING }))

    // Backend aborts → the in-flight download resolves as cancelled. A user cancel must not
    // surface as a "download failed" notice, and the card returns to the idle
    // download button.
    act(() => resolveDownload?.({ result: 'cancelled' }))
    await waitFor(() =>
      expect(within(embeddingCard()).getByText('settings.dependencies.localModels.download')).toBeInTheDocument()
    )
    expect(screen.queryByText('settings.dependencies.localModels.notice.downloadFailed')).not.toBeInTheDocument()
  })

  it('surfaces a failure notice when the download genuinely fails', async () => {
    mockRoutes((route, input) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download' && input?.id === EMBEDDING) return Promise.reject(new Error('boom'))
      return Promise.resolve()
    })

    render(<LocalModelsSection />)
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_status', { id: EMBEDDING }))

    fireEvent.click(within(embeddingCard()).getByText('settings.dependencies.localModels.download'))

    // No cancel in play → the failure is real and must be shown.
    await waitFor(() =>
      expect(
        within(embeddingCard()).getByText('settings.dependencies.localModels.notice.downloadFailed')
      ).toBeInTheDocument()
    )
  })

  it('shows a shared failure as retryable when reopening settings', async () => {
    const user = userEvent.setup()
    mockRoutes((route, input) => {
      if (route === 'local_model.get_status') {
        return Promise.resolve({ status: input?.id === EMBEDDING ? 'error' : 'not_downloaded' })
      }
      if (route === 'local_model.download') return Promise.resolve({ result: 'ready' })
      return Promise.resolve()
    })

    render(<LocalModelsSection />)

    await waitFor(() =>
      expect(
        within(embeddingCard()).getByText('settings.dependencies.localModels.notice.downloadFailed')
      ).toBeInTheDocument()
    )
    await user.click(within(embeddingCard()).getByText('common.retry'))

    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.download', { id: EMBEDDING }))
    expect(mockRequest).not.toHaveBeenCalledWith('local_model.remove', { id: EMBEDDING })
  })

  it('replaces a stale incomplete-cache notice when the retry itself fails in transport', async () => {
    const user = userEvent.setup()
    mockRoutes((route, input) => {
      if (route === 'local_model.get_status') {
        return Promise.resolve(
          input?.id === EMBEDDING ? { status: 'error', errorCode: 'incomplete_cache' } : { status: 'not_downloaded' }
        )
      }
      if (route === 'local_model.download') return Promise.reject(new Error('ipc transport failed'))
      return Promise.resolve()
    })

    render(<LocalModelsSection />)
    await waitFor(() =>
      expect(
        within(embeddingCard()).getByText('settings.dependencies.localModels.notice.incompleteCache')
      ).toBeInTheDocument()
    )

    await user.click(within(embeddingCard()).getByText('common.retry'))

    // The failed retry is a download/transport failure — the repair wording must not
    // survive it via an errorCode left behind by the earlier status probe.
    await waitFor(() =>
      expect(
        within(embeddingCard()).getByText('settings.dependencies.localModels.notice.downloadFailed')
      ).toBeInTheDocument()
    )
    expect(
      within(embeddingCard()).queryByText('settings.dependencies.localModels.notice.incompleteCache')
    ).not.toBeInTheDocument()
  })

  it('words an incomplete-cache error as repair-by-redownload, not a connection problem', async () => {
    mockRoutes((route, input) => {
      if (route === 'local_model.get_status') {
        return Promise.resolve(
          input?.id === EMBEDDING ? { status: 'error', errorCode: 'incomplete_cache' } : { status: 'not_downloaded' }
        )
      }
      return Promise.resolve()
    })

    render(<LocalModelsSection />)

    await waitFor(() =>
      expect(
        within(embeddingCard()).getByText('settings.dependencies.localModels.notice.incompleteCache')
      ).toBeInTheDocument()
    )
    // The generic connection wording would be wrong on both counts here.
    expect(screen.queryByText('settings.dependencies.localModels.notice.downloadFailed')).not.toBeInTheDocument()
    expect(within(embeddingCard()).getByText('common.retry')).toBeInTheDocument()
  })

  it('shows an explicit unsupported state once both cards report unsupported (e.g. Intel Mac)', async () => {
    mockRoutes((route) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'unsupported' })
      return Promise.resolve()
    })

    render(<LocalModelsSection />)

    // The cards give way to one explanation, rather than each offering a download
    // that could only fail.
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText('settings.dependencies.localModels.title')).toBeInTheDocument()
  })
})
