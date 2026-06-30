import { LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import LocalEmbeddingDownloadButton from '../LocalEmbeddingDownloadButton'

type ProgressPayload = { model: string; status: string; percent: number }

const mockRequest = vi.fn()
const mockRefetch = vi.fn().mockResolvedValue(undefined)
let progressHandler: ((p: ProgressPayload) => void) | undefined

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mockRequest(...args) }
}))

vi.mock('@renderer/ipc/useIpcOn', () => ({
  useIpcOn: (_event: string, handler: (p: ProgressPayload) => void) => {
    progressHandler = handler
  }
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModels: () => ({ models: [], isLoading: false, refetch: mockRefetch })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, ...props }: { children: ReactNode; onClick?: () => void; [key: string]: unknown }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

/** Drive `local_model.get_status` to a fixed status; all other routes resolve unless overridden. */
const stubStatus = (status: string) => {
  mockRequest.mockImplementation((route: string) => {
    if (route === 'local_model.get_status') return Promise.resolve({ status })
    return Promise.resolve()
  })
}

describe('LocalEmbeddingDownloadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    progressHandler = undefined
    Object.assign(window, { toast: { success: vi.fn(), error: vi.fn() } })
  })

  it('shows the download button when the model is not downloaded', async () => {
    stubStatus('not_downloaded')

    render(<LocalEmbeddingDownloadButton onSelected={vi.fn()} />)

    expect(await screen.findByText('knowledge.rag.download_local_embedding')).toBeInTheDocument()
  })

  it('downloads then selects the local model', async () => {
    stubStatus('not_downloaded')
    const onSelected = vi.fn()

    render(<LocalEmbeddingDownloadButton onSelected={onSelected} />)
    fireEvent.click(await screen.findByText('knowledge.rag.download_local_embedding'))

    await waitFor(() => expect(onSelected).toHaveBeenCalledWith(LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
    expect(mockRequest).toHaveBeenCalledWith('local_model.download', { model: 'embedding' })
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('renders the live percent and cancels while downloading', async () => {
    let resolveDownload: (() => void) | undefined
    mockRequest.mockImplementation((route: string) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download') return new Promise<void>((resolve) => (resolveDownload = resolve))
      return Promise.resolve()
    })

    render(<LocalEmbeddingDownloadButton onSelected={vi.fn()} />)
    fireEvent.click(await screen.findByText('knowledge.rag.download_local_embedding'))

    act(() => progressHandler?.({ model: 'embedding', status: 'downloading', percent: 45 }))
    const cancelButton = await screen.findByText('45%')
    expect(cancelButton).toBeInTheDocument()

    fireEvent.click(cancelButton)
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.cancel', { model: 'embedding' }))
    expect(await screen.findByText('knowledge.rag.download_local_embedding')).toBeInTheDocument()

    resolveDownload?.()
  })

  it('offers to use an already-downloaded model without re-downloading', async () => {
    stubStatus('ready')
    const onSelected = vi.fn()

    render(<LocalEmbeddingDownloadButton onSelected={onSelected} />)
    fireEvent.click(await screen.findByText('knowledge.rag.use_local_embedding'))

    await waitFor(() => expect(onSelected).toHaveBeenCalledWith(LOCAL_EMBEDDING_UNIQUE_MODEL_ID))
    expect(mockRequest).not.toHaveBeenCalledWith('local_model.download', expect.anything())
  })

  it('surfaces a toast and does not select when the download fails', async () => {
    mockRequest.mockImplementation((route: string) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download') return Promise.reject(new Error('boom'))
      return Promise.resolve()
    })
    const onSelected = vi.fn()

    render(<LocalEmbeddingDownloadButton onSelected={onSelected} />)
    fireEvent.click(await screen.findByText('knowledge.rag.download_local_embedding'))

    await waitFor(() =>
      expect(window.toast.error).toHaveBeenCalledWith('knowledge.rag.download_local_embedding_failed')
    )
    expect(onSelected).not.toHaveBeenCalled()
  })
})
