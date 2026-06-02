import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import WordPreviewPanel from '../WordPreviewPanel'

const mocks = vi.hoisted(() => ({
  fsRead: vi.fn(),
  renderAsync: vi.fn(),
  t: vi.fn((key: string) => key)
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/chat', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  LoadingState: ({ label }: { label: string }) => <div data-testid="loading-state">{label}</div>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mocks.t
  })
}))

vi.mock('docx-preview', () => ({
  renderAsync: mocks.renderAsync
}))

describe('WordPreviewPanel', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fsRead.mockResolvedValue(new Uint8Array([1, 2, 3]))
    mocks.renderAsync.mockImplementation(async (_data: Uint8Array, bodyContainer: HTMLElement) => {
      bodyContainer.append(document.createElement('section'))
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: {
          read: mocks.fsRead
        }
      }
    })
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    })
  })

  it('reads the Word document and renders it through docx-preview', async () => {
    render(<WordPreviewPanel filePath="/tmp/workspace/proposal.docx" fileName="proposal.docx" refreshKey={2} />)

    expect(screen.getByTestId('loading-state')).toHaveTextContent('common.loading')
    await waitFor(() => expect(mocks.renderAsync).toHaveBeenCalledTimes(1))
    expect(mocks.fsRead).toHaveBeenCalledWith('/tmp/workspace/proposal.docx')
    expect(mocks.renderAsync).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      expect.any(HTMLDivElement),
      expect.any(HTMLDivElement),
      expect.objectContaining({
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderAltChunks: false,
        renderHeaders: true,
        useBase64URL: true
      })
    )
    expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument()
    expect(screen.getByTestId('word-preview-document').querySelector('section')).toBeInTheDocument()
  })

  it('shows a structured error state when docx rendering fails', async () => {
    mocks.renderAsync.mockRejectedValueOnce(new Error('bad docx'))

    render(<WordPreviewPanel filePath="/tmp/workspace/proposal.docx" fileName="proposal.docx" />)

    await waitFor(() => expect(screen.getByTestId('empty-state')).toHaveTextContent('common.error'))
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.word.errors.parse_failed')
    expect(screen.getByTestId('word-preview-document').querySelector('section')).not.toBeInTheDocument()
  })

  it('shows a read error state when the source file cannot be loaded', async () => {
    mocks.fsRead.mockRejectedValueOnce(new Error('missing'))

    render(<WordPreviewPanel filePath="/tmp/workspace/missing.docx" fileName="missing.docx" />)

    await waitFor(() => expect(screen.getByTestId('empty-state')).toHaveTextContent('common.error'))
    expect(screen.getByTestId('empty-state')).toHaveTextContent('agent.preview_pane.word.errors.read_failed')
    expect(mocks.renderAsync).not.toHaveBeenCalled()
  })

  it('zooms the preview and uses page controls to jump to rendered pages', async () => {
    mocks.renderAsync.mockImplementation(async (_data: Uint8Array, bodyContainer: HTMLElement) => {
      const wrapper = document.createElement('div')
      wrapper.className = 'docx-wrapper'
      for (let index = 0; index < 2; index += 1) {
        const page = document.createElement('section')
        page.className = 'docx'
        wrapper.append(page)
      }
      bodyContainer.append(wrapper)
    })

    render(<WordPreviewPanel filePath="/tmp/workspace/proposal.docx" fileName="proposal.docx" />)

    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(screen.getByTestId('word-preview-body')).toHaveStyle('--word-preview-zoom: 1.1')

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))
    expect(screen.getByTestId('word-preview-body')).toHaveStyle('--word-preview-zoom: 1')
  })
})
