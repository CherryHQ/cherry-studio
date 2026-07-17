import '@testing-library/jest-dom/vitest'

import { safeOpen } from '@renderer/utils/file/safeOpen'
import { normalizeFilePreviewPath } from '@renderer/utils/filePreview'
import type { FilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef, ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({
    icon: Icon,
    title,
    description,
    actionLabel,
    onAction
  }: {
    icon?: ComponentType<{ size?: number }>
    title?: string
    description?: string
    actionLabel?: string
    onAction?: () => void
  }) => (
    <div data-testid="empty-state">
      {Icon ? <Icon /> : null}
      <div>{title}</div>
      <div>{description}</div>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  ),
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>
}))

vi.mock('@renderer/utils/file/safeOpen', () => ({
  safeOpen: vi.fn(() => Promise.resolve())
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { FilePreview } from '../FilePreview'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FilePreview', () => {
  it('shows unsupported state without reading the file when the registry is empty', () => {
    render(<FilePreview filePath={'/tmp/report.zip' as FilePath} />)

    expect(screen.getByText('file_preview.unsupported.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.unsupported.description')).toBeInTheDocument()
  })

  it('contains invalid paths in an inline state', () => {
    render(<FilePreview filePath={'relative/report.pdf' as FilePath} />)

    expect(screen.getByText('file_preview.invalid_path.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.invalid_path.description')).toBeInTheDocument()
  })

  it('opens unsupported files with the default app through safeOpen', () => {
    const path = '/tmp/report.zip'
    render(<FilePreview filePath={path as FilePath} />)

    fireEvent.click(screen.getByRole('button', { name: 'file_preview.unsupported.action' }))

    expect(safeOpen).toHaveBeenCalledWith(createFilePathHandle(normalizeFilePreviewPath(path)))
  })

  it('does not offer an external open for invalid paths', () => {
    render(<FilePreview filePath={'relative/report.pdf' as FilePath} />)

    expect(screen.queryByRole('button', { name: 'file_preview.unsupported.action' })).not.toBeInTheDocument()
  })
})
