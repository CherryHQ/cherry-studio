import '@testing-library/jest-dom/vitest'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PreviewError } from '@cherrystudio/file-preview/core'
import type { AbsoluteFilePath } from '@shared/types/file'

const preview = vi.hoisted(() => ({ onError: undefined as ((error: PreviewError) => void) | undefined }))

vi.mock('@cherrystudio/file-preview/react', () => ({
  Preview: ({ onError }: { onError?: (error: PreviewError) => void }) => {
    preview.onError = onError
    return <div data-testid="preview" />
  }
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
