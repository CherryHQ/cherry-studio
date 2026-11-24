import { MockCherrystudioUI } from '@test-mocks/renderer/CherrystudioUI'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ComponentPropsWithoutRef, type ReactNode, type RefObject, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import MermaidFilePreview from '../MermaidFilePreview'

const mocks = vi.hoisted(() => ({
  readText: vi.fn(),
  openDetail: vi.fn(),
  preview: { pan: vi.fn(), zoom: vi.fn(), copy: vi.fn(), download: vi.fn() }
}))

vi.mock('@renderer/components/Preview/MermaidPreview', () => ({
  default: function MermaidPreviewMock({
    children,
    fit,
    ref,
    onErrorChange
  }: {
    children: string
    fit?: string
    ref?: RefObject<unknown>
    onErrorChange?: (failed: boolean) => void
  }) {
    if (ref) ref.current = mocks.preview
    // Stands in for Mermaid rejecting the source, which keeps the last SVG under the failure overlay.
    const failed = children.includes('%% invalid')
    useEffect(() => onErrorChange?.(failed), [failed, onErrorChange])
    return (
      <div data-testid="diagram" data-fit={fit}>
        {children}
      </div>
    )
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  EmptyState: ({ title, detail }: { title: string; detail?: ReactNode }) => (
    <div>
      {title}
      {detail}
    </div>
  ),
  ScrollArea: MockCherrystudioUI.ScrollArea,
  Tooltip: ({ children }: { children: ReactNode }) => children,
  Button: (props: ComponentPropsWithoutRef<'button'>) => <button type="button" {...props} />
}))

vi.mock('@renderer/services/appErrorDetailOpen', () => ({
  openLoadedErrorDetail: (request: unknown) => mocks.openDetail(request),
  showDetailOpenFailed: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const renderPreview = (refreshKey = 0) => (
  <MermaidFilePreview
    filePath={'/ws/flow.mmd' as AbsoluteFilePath}
    fileName="flow.mmd"
    metadata={{ size: 24, modifiedAt: 1 }}
    refreshKey={refreshKey}
  />
)

describe('MermaidFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', { configurable: true, value: { fs: { readText: mocks.readText } } })
  })

  it('renders the file’s source as a diagram that fills the preview', async () => {
    mocks.readText.mockResolvedValue('flowchart LR\nA-->B')
    render(renderPreview())

    const diagram = await screen.findByTestId('diagram')
    expect(diagram).toHaveTextContent('flowchart LR A-->B')
    expect(diagram).toHaveAttribute('data-fit', 'contain')
  })

  it('drives the diagram from the header toolbar once it has rendered', async () => {
    let finishRead: (source: string) => void = () => {}
    mocks.readText.mockReturnValue(new Promise<string>((resolve) => (finishRead = resolve)))
    render(renderPreview())
    expect(screen.getByRole('button', { name: 'preview.zoom_in' })).toBeDisabled()

    finishRead('flowchart LR\nA-->B')
    await screen.findByTestId('diagram')
    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))
    fireEvent.click(screen.getByRole('button', { name: 'code_block.download.png' }))

    expect(mocks.preview.zoom).toHaveBeenNthCalledWith(1, 0.1)
    expect(mocks.preview.pan).toHaveBeenCalledWith(0, 0, true)
    expect(mocks.preview.zoom).toHaveBeenLastCalledWith(1, true)
    expect(mocks.preview.download).toHaveBeenCalledWith('png')
  })

  it('shows the empty state for a blank file instead of a diagram', async () => {
    mocks.readText.mockResolvedValue('  \n')
    render(renderPreview())

    expect(await screen.findByText('file_preview.text.empty.title')).toBeInTheDocument()
    expect(screen.queryByTestId('diagram')).not.toBeInTheDocument()
  })

  it('shows the load error when the file cannot be read', async () => {
    mocks.readText.mockRejectedValue(new Error('EACCES'))
    render(renderPreview())

    expect(await screen.findByText('file_preview.load_error.title')).toBeInTheDocument()
    // The read failure is the evidence Doctor needs; it must reach the detail dialog intact.
    fireEvent.click(screen.getByRole('button', { name: 'common.detail' }))
    await waitFor(() => expect(mocks.openDetail).toHaveBeenCalled())
    const request = mocks.openDetail.mock.calls[0][0]
    expect(request.error.message).toBe('EACCES')
    expect(request.context.operation).toBe('file.preview.read')
  })

  // A failed render keeps the previous SVG under the overlay; exporting it would hand out a diagram the user can't see.
  it('disables the diagram actions while a refreshed file fails to render, and restores them after', async () => {
    mocks.readText.mockResolvedValueOnce('flowchart LR\nA-->B')
    const view = render(renderPreview(0))
    await screen.findByText('flowchart LR A-->B')
    expect(screen.getByRole('button', { name: 'preview.copy.image' })).toBeEnabled()

    mocks.readText.mockResolvedValueOnce('flowchart LR\n%% invalid')
    view.rerender(renderPreview(1))
    await waitFor(() => expect(screen.getByRole('button', { name: 'preview.copy.image' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'code_block.download.svg' })).toBeDisabled()

    mocks.readText.mockResolvedValueOnce('flowchart LR\nA-->C')
    view.rerender(renderPreview(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'preview.copy.image' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'code_block.download.svg' })).toBeEnabled()
  })
})
