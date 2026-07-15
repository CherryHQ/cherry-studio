import '@testing-library/jest-dom/vitest'

import type { FilePath } from '@shared/types/file'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({
    icon: Icon,
    title,
    description
  }: {
    icon?: ComponentType<{ size?: number }>
    title?: string
    description?: string
  }) => (
    <div data-testid="empty-state">
      {Icon ? <Icon /> : null}
      <div>{title}</div>
      <div>{description}</div>
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { FilePreview } from '../FilePreview'

const isTextFile = vi.fn()

beforeEach(() => {
  Object.assign(window.api.file, { isTextFile })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('FilePreview', () => {
  it('shows unsupported state without reading the file when the registry is empty', () => {
    render(<FilePreview filePath={'/tmp/report.pdf' as FilePath} />)

    expect(screen.getByText('file_preview.unsupported.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.unsupported.description')).toBeInTheDocument()
    expect(isTextFile).not.toHaveBeenCalled()
  })

  it('contains invalid paths in an inline state', () => {
    render(<FilePreview filePath={'relative/report.pdf' as FilePath} />)

    expect(screen.getByText('file_preview.invalid_path.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.invalid_path.description')).toBeInTheDocument()
  })
})
