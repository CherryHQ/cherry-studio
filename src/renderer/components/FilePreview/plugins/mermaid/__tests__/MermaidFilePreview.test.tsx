import { render, screen } from '@testing-library/react'
import type { ComponentPropsWithoutRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import MermaidFilePreview from '../MermaidFilePreview'

const mocks = vi.hoisted(() => ({ readText: vi.fn() }))

vi.mock('@renderer/components/Preview/MermaidPreview', () => ({
  default: ({ children, fit }: { children: string; fit?: string }) => (
    <div data-testid="diagram" data-fit={fit}>
      {children}
    </div>
  )
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
  Scrollbar: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => <div {...props}>{children}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const renderPreview = () =>
  render(
    <MermaidFilePreview
      filePath={'/ws/flow.mmd' as AbsoluteFilePath}
      fileName="flow.mmd"
      metadata={{ size: 24, modifiedAt: 1 }}
      refreshKey={0}
    />
  )

describe('MermaidFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', { configurable: true, value: { fs: { readText: mocks.readText } } })
  })

  it('renders the file’s source as a diagram that fills the preview', async () => {
    mocks.readText.mockResolvedValue('flowchart LR\nA-->B')
    renderPreview()

    const diagram = await screen.findByTestId('diagram')
    expect(diagram).toHaveTextContent('flowchart LR A-->B')
    expect(diagram).toHaveAttribute('data-fit', 'contain')
  })

  it('shows the empty state for a blank file instead of a diagram', async () => {
    mocks.readText.mockResolvedValue('  \n')
    renderPreview()

    expect(await screen.findByText('file_preview.text.empty.title')).toBeInTheDocument()
    expect(screen.queryByTestId('diagram')).not.toBeInTheDocument()
  })

  it('shows the load error when the file cannot be read', async () => {
    mocks.readText.mockRejectedValue(new Error('EACCES'))
    renderPreview()

    expect(await screen.findByText('file_preview.load_error.title')).toBeInTheDocument()
  })
})
