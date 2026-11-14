import '@testing-library/jest-dom/vitest'
import { resetToastMocks } from '@test-mocks/renderer/toast'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PreviewError } from '@cherrystudio/file-preview/core'
import type { PreviewDiagnostic } from '@cherrystudio/file-preview/react'
import { toast } from '@renderer/services/toast'
import type { AbsoluteFilePath } from '@shared/types/file'

const preview = vi.hoisted(() => ({
  onError: undefined as ((error: PreviewError) => void) | undefined,
  onDiagnostic: undefined as ((diagnostic: PreviewDiagnostic) => void) | undefined,
  onRequestOpen: undefined as (() => void) | undefined
}))

vi.mock('@cherrystudio/file-preview/react', () => ({
  Preview: (props: {
    onError?: (error: PreviewError) => void
    onDiagnostic?: (diagnostic: PreviewDiagnostic) => void
    onRequestOpen?: () => void
  }) => {
    preview.onError = props.onError
    preview.onDiagnostic = props.onDiagnostic
    preview.onRequestOpen = props.onRequestOpen
    return <div data-testid="preview" />
  }
}))

// Simulates the detail chunk failing to load (offline after an update, evicted cache).
vi.mock('@renderer/services/AppErrorDetailService', () => {
  throw new Error('chunk load failed')
})
vi.mock('@renderer/utils/file/safeOpen', () => ({
  safeOpen: vi.fn(() => Promise.reject(new Error('no handler')))
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } })
}))

import ElectronFilePreview from '../ElectronFilePreview'

const filePath = '/tmp/report.pdf' as AbsoluteFilePath
const metadata = { size: 128, modifiedAt: 1 }

function renderPreview(refreshKey = 0) {
  return render(
    <ElectronFilePreview filePath={filePath} fileName="report.pdf" metadata={metadata} refreshKey={refreshKey} />
  )
}

describe('ElectronFilePreview error details', () => {
  // A size limit is preview policy; offering Doctor for it sends users to diagnose a non-fault.
  it('does not offer details for a file over the preview size limit', () => {
    renderPreview()
    act(() => preview.onError?.(new PreviewError('too_large', 'File exceeds preview limit')))
    expect(screen.queryByRole('button', { name: 'common.detail' })).not.toBeInTheDocument()
  })

  it('offers details for a load failure and drops them after a reload', () => {
    const view = renderPreview()
    act(() => preview.onError?.(new PreviewError('load_error', 'decode failed')))
    expect(screen.getByRole('button', { name: 'common.detail' })).toBeInTheDocument()

    view.rerender(<ElectronFilePreview filePath={filePath} fileName="report.pdf" metadata={metadata} refreshKey={1} />)
    expect(screen.queryByRole('button', { name: 'common.detail' })).not.toBeInTheDocument()
  })
})

describe('ElectronFilePreview failure toasts without the detail chunk', () => {
  beforeEach(() => resetToastMocks())

  // Without a catch the failure would vanish silently as an unhandled rejection.
  it('still tells the user an external open failed', async () => {
    renderPreview()
    act(() => preview.onRequestOpen?.())
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'file_preview.open_error', data: { suppressDetail: true } })
      )
    )
  })

  it('still tells the user a PDF navigation failed', async () => {
    renderPreview()
    act(() =>
      preview.onDiagnostic?.({
        code: 'navigation_error',
        level: 'warn',
        context: 'pdf',
        message: 'outline target missing'
      })
    )
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'file_preview.pdf.navigation_error', data: { suppressDetail: true } })
      )
    )
  })
})
