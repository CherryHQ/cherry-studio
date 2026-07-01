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
  ipcApi: { request: (...args: unknown[]) => mockRequest(...args) }
}))

vi.mock('@renderer/ipc/useIpcOn', () => ({
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
  )
}))

/** The embedding card is the first of the two rendered list items. */
const embeddingCard = () => screen.getAllByRole('listitem')[0]

describe('LocalModelsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    progressHandlers.length = 0
  })

  it('renders live percent, and cancelling neither fails nor shows a failure notice', async () => {
    let rejectDownload: ((e: Error) => void) | undefined
    mockRequest.mockImplementation((route: string, input?: { model: string }) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download' && input?.model === 'embedding')
        return new Promise<void>((_resolve, reject) => (rejectDownload = reject))
      return Promise.resolve()
    })

    render(<LocalModelsSection />)
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_status', { model: 'embedding' }))

    fireEvent.click(within(embeddingCard()).getByText('settings.plugins.localModels.download'))
    await waitFor(() =>
      expect(within(embeddingCard()).getByText('settings.plugins.localModels.cancel')).toBeInTheDocument()
    )

    act(() => progressHandlers.forEach((h) => h({ model: 'embedding', status: 'downloading', percent: 45 })))
    expect(within(embeddingCard()).getByText('45%')).toBeInTheDocument()

    fireEvent.click(within(embeddingCard()).getByText('settings.plugins.localModels.cancel'))
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.cancel', { model: 'embedding' }))

    // Backend aborts → the in-flight download rejects. A user cancel must not
    // surface as a "download failed" notice, and the card returns to the idle
    // download button.
    act(() => rejectDownload?.(new Error('download cancelled')))
    await waitFor(() =>
      expect(within(embeddingCard()).getByText('settings.plugins.localModels.download')).toBeInTheDocument()
    )
    expect(screen.queryByText('settings.plugins.localModels.notice.downloadFailed')).not.toBeInTheDocument()
  })

  it('surfaces a failure notice when the download genuinely fails', async () => {
    mockRequest.mockImplementation((route: string, input?: { model: string }) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download' && input?.model === 'embedding') return Promise.reject(new Error('boom'))
      return Promise.resolve()
    })

    render(<LocalModelsSection />)
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_status', { model: 'embedding' }))

    fireEvent.click(within(embeddingCard()).getByText('settings.plugins.localModels.download'))

    // No cancel in play → the failure is real and must be shown.
    await waitFor(() =>
      expect(
        within(embeddingCard()).getByText('settings.plugins.localModels.notice.downloadFailed')
      ).toBeInTheDocument()
    )
  })
})
