import '@testing-library/jest-dom/vitest'

import type { FilePath } from '@shared/types/file'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      <div>{description}</div>
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: ({ filePath }: { filePath: FilePath }) => <div data-testid="file-preview">{filePath}</div>
}))

import { FilePreviewPage } from '../FilePreviewPage'

afterEach(cleanup)

describe('FilePreviewPage', () => {
  it('renders the shared file preview for a valid route path', () => {
    render(<FilePreviewPage filePath={'/tmp/report.pdf' as FilePath} />)

    expect(screen.getByTestId('file-preview')).toHaveTextContent('/tmp/report.pdf')
  })

  it('contains a missing or invalid route path in the page', () => {
    render(<FilePreviewPage />)

    expect(screen.getByText('file_preview.invalid_path.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.invalid_path.description')).toBeInTheDocument()
  })
})
