import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toastError, localModel } = vi.hoisted(() => ({
  toastError: vi.fn(),
  localModel: {
    status: 'not_downloaded' as 'not_downloaded' | 'downloading' | 'ready' | 'error' | 'unsupported',
    percent: 0,
    download: vi.fn<() => Promise<boolean>>(),
    cancel: vi.fn<() => Promise<void>>()
  }
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: toastError } }))
vi.mock('@renderer/hooks/useLocalModel', () => ({ useLocalModel: () => localModel }))

// This suite exercises the real popup store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'common.cancel': 'Cancel',
        'common.retry': 'Retry',
        'knowledge.rag.download_local_model': 'Download Local Model',
        'settings.dependencies.localModels.download': 'Download',
        'settings.dependencies.localModels.notice.downloadFailed': 'Download failed',
        'settings.dependencies.localModels.status.downloading': 'Downloading'
      })[key] ?? key
  })
}))

vi.mock('@cherrystudio/ui', () => {
  const React = require('react')

  return {
    Button: ({ children, ...props }: Record<string, any>) => React.createElement('button', props, children),
    Dialog: ({ children, open }: Record<string, any>) =>
      open ? React.createElement(React.Fragment, null, children) : null,
    DialogContent: ({ children, ...props }: Record<string, any>) => {
      delete props.showCloseButton
      delete props.overlayClassName
      delete props.closeOnOverlayClick
      delete props.onInteractOutside

      return React.createElement('div', { role: 'dialog', ...props }, children)
    },
    DialogDescription: ({ children }: Record<string, any>) => React.createElement('div', null, children),
    DialogFooter: ({ children, ...props }: Record<string, any>) => React.createElement('div', props, children),
    DialogHeader: ({ children, ...props }: Record<string, any>) => React.createElement('div', props, children),
    DialogTitle: ({ children, ...props }: Record<string, any>) => React.createElement('h2', props, children)
  }
})

vi.mock('@cherrystudio/ui/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))

import { PopupHost } from '@renderer/components/PopupHost'

import LocalModelDownloadPopup from '../LocalModelDownloadPopup'

const OCR = { id: 'pp-ocrv6-medium', description: 'PaddleOCR PP-OCRv6 · ~140 MB' } as const

beforeEach(() => {
  localModel.status = 'not_downloaded'
  localModel.percent = 0
  localModel.download.mockReset()
  localModel.cancel.mockReset().mockResolvedValue(undefined)
  toastError.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, false)
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
})

describe('LocalModelDownloadPopup', () => {
  it('stays open for the whole download and resolves true once the model is on disk', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let finishDownload!: (downloaded: boolean) => void
    localModel.download.mockReturnValue(
      new Promise((resolve) => {
        finishDownload = resolve
      })
    )

    let result!: Promise<boolean>
    act(() => {
      result = LocalModelDownloadPopup.show(OCR)
    })

    await screen.findByText('PaddleOCR PP-OCRv6 · ~140 MB')
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await act(async () => {})

    // Still open while download() is in flight — the old confirm resolved here.
    expect(screen.getByText('PaddleOCR PP-OCRv6 · ~140 MB')).toBeInTheDocument()

    finishDownload(true)
    await expect(result).resolves.toBe(true)
  })

  it('reports the download percentage while it runs', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    localModel.download.mockReturnValue(new Promise(() => undefined))
    localModel.status = 'downloading'
    localModel.percent = 42

    act(() => {
      void LocalModelDownloadPopup.show(OCR)
    })

    await screen.findByText('PaddleOCR PP-OCRv6 · ~140 MB')
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('Downloading')).toBeInTheDocument()
    // No way to start a second download while one runs.
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(localModel.cancel).toHaveBeenCalledTimes(1)
  })

  it('keeps itself open for a retry when the download fails', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    localModel.download.mockRejectedValueOnce(new Error('network down'))

    let result!: Promise<boolean>
    act(() => {
      result = LocalModelDownloadPopup.show(OCR)
    })

    await screen.findByText('PaddleOCR PP-OCRv6 · ~140 MB')
    await user.click(screen.getByRole('button', { name: 'Download' }))
    await act(async () => {})

    expect(toastError).toHaveBeenCalledWith('Download failed')
    expect(screen.getByText('PaddleOCR PP-OCRv6 · ~140 MB')).toBeInTheDocument()

    localModel.download.mockResolvedValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await expect(result).resolves.toBe(true)
  })

  it('resolves false when dismissed before the download starts', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let result!: Promise<boolean>
    act(() => {
      result = LocalModelDownloadPopup.show(OCR)
    })

    await screen.findByText('PaddleOCR PP-OCRv6 · ~140 MB')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await expect(result).resolves.toBe(false)
    expect(localModel.download).not.toHaveBeenCalled()
    expect(localModel.cancel).not.toHaveBeenCalled()
  })
})
