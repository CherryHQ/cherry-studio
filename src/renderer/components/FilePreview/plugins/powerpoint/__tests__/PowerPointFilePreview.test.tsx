// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { FilePath } from '@shared/types/file'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface MockViewerOptions {
  onSlideChange?: (index: number) => void
}

const mocks = vi.hoisted(() => {
  const createMockPresentation = () => ({
    slides: [
      {
        rels: new Map([
          [
            'rEmbeddedImage',
            {
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
              target: '../media/image1.png'
            }
          ],
          [
            'rExternalImage',
            {
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
              target: 'https://example.com/image.png',
              targetMode: 'External'
            }
          ],
          [
            'rExternalHyperlink',
            {
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
              target: 'https://example.com',
              targetMode: 'External'
            }
          ]
        ])
      }
    ],
    layouts: new Map(),
    masters: new Map()
  })

  const state = {
    buildPresentation: vi.fn(),
    destroy: vi.fn(),
    fsRead: vi.fn(),
    getMetadata: vi.fn(),
    goToSlide: vi.fn(),
    load: vi.fn(),
    loggerError: vi.fn(),
    mockFiles: { slides: new Map() },
    parseZipLazyMedia: vi.fn(),
    renderList: vi.fn(),
    setZoom: vi.fn()
  }

  class MockPptxViewer {
    currentSlideIndex = 0
    slideCount = 3
    zoomPercent = 100

    constructor(
      private container: HTMLElement,
      private options: MockViewerOptions
    ) {}

    load(presentation: unknown) {
      state.load(presentation)
    }

    async renderList(options: unknown) {
      state.renderList(options)
      this.container.textContent = 'rendered pptx'
      this.options.onSlideChange?.(0)
    }

    async goToSlide(index: number) {
      state.goToSlide(index)
      this.currentSlideIndex = index
      this.options.onSlideChange?.(index)
    }

    async setZoom(percent: number) {
      state.setZoom(percent)
      this.zoomPercent = percent
    }

    destroy() {
      state.destroy()
    }
  }

  return { ...state, createMockPresentation, MockPptxViewer }
})

vi.mock('@aiden0z/pptx-renderer', () => ({
  buildPresentation: mocks.buildPresentation,
  parseZipLazyMedia: mocks.parseZipLazyMedia,
  PptxViewer: mocks.MockPptxViewer,
  RECOMMENDED_ZIP_LIMITS: {}
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: mocks.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'button'>>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren<{ content: string }>) => <>{children}</>,
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  Scrollbar: ({ children, ...props }: PropsWithChildren<React.ComponentPropsWithoutRef<'div'>>) => (
    <div {...props}>{children}</div>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import PowerPointFilePreview from '../PowerPointFilePreview'

const filePath = '/tmp/presentations/roadmap.pptx' as FilePath

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fsRead.mockResolvedValue(new Uint8Array([80, 75, 3, 4]))
  mocks.getMetadata.mockResolvedValue({ kind: 'file', size: 1024 })
  mocks.parseZipLazyMedia.mockResolvedValue(mocks.mockFiles)
  mocks.buildPresentation.mockImplementation(() => mocks.createMockPresentation())
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { fs: { read: mocks.fsRead }, file: { getMetadata: mocks.getMetadata } }
  })
})

afterEach(cleanup)

describe('PowerPointFilePreview', () => {
  it('loads and renders PPTX slides with a centered standalone toolbar', async () => {
    render(<PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" refreshKey={0} />)

    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))

    expect(mocks.fsRead).toHaveBeenCalledWith(filePath)
    expect(new Uint8Array(mocks.parseZipLazyMedia.mock.calls[0][0])).toEqual(new Uint8Array([80, 75, 3, 4]))
    expect(mocks.buildPresentation).toHaveBeenCalledWith(mocks.mockFiles, { lazySlides: true })
    expect(mocks.renderList).toHaveBeenCalledWith({
      windowed: true,
      batchSize: 4,
      initialSlides: 3,
      overscanViewport: 2
    })
    const toolbar = screen.getByRole('toolbar', { name: 'preview.label' })
    expect(toolbar).toHaveClass('h-10')
    expect(toolbar).not.toHaveClass('bg-background')
    expect(toolbar.firstElementChild).toHaveClass('mx-auto', 'justify-center')
    expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('1 / 3')

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    await waitFor(() => expect(mocks.goToSlide).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('2 / 3'))

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    await waitFor(() => expect(mocks.setZoom).toHaveBeenCalledWith(110))
    expect(screen.getByTestId('pptx-preview-zoom-value')).toHaveTextContent('110%')
  })

  it('removes external media relationships before loading the viewer', async () => {
    render(<PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" refreshKey={0} />)

    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))

    const presentation = mocks.load.mock.calls[0][0]
    expect(presentation.slides[0].rels.has('rEmbeddedImage')).toBe(true)
    expect(presentation.slides[0].rels.has('rExternalHyperlink')).toBe(true)
    expect(presentation.slides[0].rels.has('rExternalImage')).toBe(false)
  })

  it('rejects oversized PPTX via metadata before reading bytes', async () => {
    mocks.getMetadata.mockResolvedValueOnce({ kind: 'file', size: 25 * 1024 * 1024 + 1 })

    render(<PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" refreshKey={0} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.parseZipLazyMedia).not.toHaveBeenCalled()
  })

  it('contains read failures inside the preview and logs the cause', async () => {
    const error = new Error('corrupt pptx')
    mocks.fsRead.mockRejectedValueOnce(error)

    render(<PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" refreshKey={0} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    expect(mocks.loggerError).toHaveBeenCalledWith(`Failed to load PPTX preview: ${filePath}`, error)
  })

  it('rebuilds and destroys the viewer when refreshKey changes', async () => {
    const view = render(<PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" refreshKey={0} />)
    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))

    view.rerender(<PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" refreshKey={1} />)

    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2))
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })
})
