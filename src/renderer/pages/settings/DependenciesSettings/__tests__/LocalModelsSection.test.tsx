import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LocalModelsSection from '../LocalModelsSection'

type ProgressPayload = { model: string; status: string; percent: number }

const mockRequest = vi.fn()
// Both cards subscribe, so collect every handler and fan a progress event out to
// all of them — each card ignores events whose `model` isn't its own.
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
  CircularProgress: ({ value }: { value: number }) => <span data-testid="circular-progress" data-value={value} />,
  Button: ({
    children,
    className,
    onClick,
    'aria-label': ariaLabel,
    variant,
    size
  }: {
    children?: ReactNode
    className?: string
    onClick?: () => void
    'aria-label'?: string
    variant?: string
    size?: string
  }) => (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label={ariaLabel}
      data-variant={variant}
      data-size={size}>
      {children}
    </button>
  )
}))

/** The embedding card is the first of the two rendered list items. */
const embeddingCard = () => screen.getAllByRole('listitem')[0]

describe('LocalModelsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    progressHandlers.length = 0
  })

  it('renders circular progress, and cancelling neither fails nor shows a failure notice', async () => {
    let rejectDownload: ((e: Error) => void) | undefined
    mockRequest.mockImplementation((route: string, input?: { model: string }) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download' && input?.model === 'embedding')
        return new Promise<void>((_resolve, reject) => (rejectDownload = reject))
      return Promise.resolve()
    })

    render(<LocalModelsSection />)
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_status', { model: 'embedding' }))

    const downloadButton = within(embeddingCard()).getByRole('button', {
      name: 'settings.dependencies.localModels.download'
    })
    expect(downloadButton).toHaveAttribute('data-variant', 'outline')
    expect(downloadButton).toHaveClass('h-7', 'w-28', 'shrink-0')

    fireEvent.click(downloadButton)
    const cancelButton = await within(embeddingCard()).findByRole('button', {
      name: 'settings.dependencies.localModels.cancel'
    })
    expect(cancelButton).toHaveAttribute('data-variant', 'ghost')
    expect(cancelButton).toHaveAttribute('data-size', 'icon-sm')
    expect(cancelButton).toHaveClass('group', 'size-7', 'shrink-0', 'rounded-full')
    expect(cancelButton.querySelector('svg')).toHaveClass(
      'opacity-0',
      'group-hover:opacity-100',
      'group-focus-visible:opacity-100'
    )

    act(() => progressHandlers.forEach((h) => h({ model: 'embedding', status: 'downloading', percent: 45 })))
    expect(within(embeddingCard()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45')
    expect(within(embeddingCard()).getByTestId('circular-progress')).toHaveAttribute('data-value', '45')

    fireEvent.click(cancelButton)
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.cancel', { model: 'embedding' }))

    // Backend aborts → the in-flight download rejects. A user cancel must not
    // surface as a "download failed" notice, and the card returns to the idle
    // download button.
    act(() => rejectDownload?.(new Error('download cancelled')))
    await waitFor(() =>
      expect(within(embeddingCard()).getByText('settings.dependencies.localModels.download')).toBeInTheDocument()
    )
    expect(screen.queryByText('settings.dependencies.localModels.notice.downloadFailed')).not.toBeInTheDocument()
  })

  it('surfaces a failure notice when the download genuinely fails', async () => {
    mockRequest.mockImplementation((route: string, input?: { model: string }) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download' && input?.model === 'embedding') return Promise.reject(new Error('boom'))
      return Promise.resolve()
    })

    render(<LocalModelsSection />)
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_status', { model: 'embedding' }))

    fireEvent.click(within(embeddingCard()).getByText('settings.dependencies.localModels.download'))

    // No cancel in play → the failure is real and must be shown.
    await waitFor(() =>
      expect(
        within(embeddingCard()).getByText('settings.dependencies.localModels.notice.downloadFailed')
      ).toBeInTheDocument()
    )
  })

  it('shows an explicit unsupported state once both cards report unsupported (e.g. Intel Mac)', async () => {
    mockRequest.mockImplementation((route: string) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'unsupported' })
      return Promise.resolve()
    })

    render(<LocalModelsSection />)

    await waitFor(() => expect(screen.queryAllByRole('listitem')).toHaveLength(0))
    expect(screen.getByText('settings.dependencies.localModels.title')).toBeInTheDocument()
    expect(screen.getByText('settings.dependencies.localModels.unsupported')).toBeInTheDocument()
  })
})
