import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

const mocks = vi.hoisted(() => ({
  currentTab: undefined as { metadata?: Record<string, unknown> } | undefined
}))

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

vi.mock('@renderer/hooks/tab', () => ({
  useCurrentTab: () => mocks.currentTab
}))

vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: ({ filePath, refreshKey }: { filePath: AbsoluteFilePath; refreshKey: number }) => (
    <div data-testid="file-preview" data-refresh-key={refreshKey}>
      {filePath}
    </div>
  )
}))

import { FilePreviewPage } from '../FilePreviewPage'

afterEach(cleanup)

beforeEach(() => {
  mocks.currentTab = undefined
})

describe('FilePreviewPage', () => {
  it('contains a missing or invalid route path in the page', () => {
    render(<FilePreviewPage />)

    expect(screen.getByText('file_preview.invalid_path.title')).toBeInTheDocument()
    expect(screen.getByText('file_preview.invalid_path.description')).toBeInTheDocument()
  })
})
