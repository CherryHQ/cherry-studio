import '@testing-library/jest-dom/vitest'

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
            'rExternalVideo',
            {
              type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/video',
              target: 'https://example.com/video.mp4',
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
    layouts: new Map([
      [
        'layout1',
        {
          rels: new Map([
            [
              'rLayoutExternalImage',
              {
                type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
                target: 'https://example.com/layout.png',
                targetMode: 'External'
              }
            ]
          ])
        }
      ]
    ]),
    masters: new Map([
      [
        'master1',
        {
          rels: new Map([
            [
              'rMasterExternalMedia',
              {
                type: 'http://schemas.microsoft.com/office/2007/relationships/media',
                target: 'https://example.com/master.mp4',
                targetMode: 'External'
              }
            ]
          ])
        }
      ]
    ])
  })

  const state = {
    fsRead: vi.fn(),
    viewerInstances: [] as Array<{ currentSlideIndex: number; slideCount: number }>,
    mockFiles: { slides: new Map() },
    parseZipLazyMedia: vi.fn(),
    buildPresentation: vi.fn(),
    load: vi.fn(),
    renderList: vi.fn(),
    goToSlide: vi.fn(),
    setZoom: vi.fn(),
    destroy: vi.fn()
  }

  class MockPptxViewer {
    slideCount = 3
    currentSlideIndex = 0
    zoomPercent = 100
    readonly container: HTMLElement
    readonly options: MockViewerOptions

    constructor(container: HTMLElement, options: MockViewerOptions) {
      this.container = container
      this.options = options
      state.viewerInstances.push(this)
    }

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
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
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
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import PptxPreviewPanel from '../PptxPreviewPanel'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.viewerInstances.length = 0
  mocks.fsRead.mockResolvedValue(new Uint8Array([80, 75, 3, 4]))
  mocks.parseZipLazyMedia.mockResolvedValue(mocks.mockFiles)
  mocks.buildPresentation.mockImplementation(() => mocks.createMockPresentation())
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      fs: {
        read: mocks.fsRead
      }
    }
  })
})

afterEach(() => {
  cleanup()
})

describe('PptxPreviewPanel', () => {
  it('loads pptx bytes into the JS viewer and exposes navigation controls', async () => {
    render(<PptxPreviewPanel filePath="/tmp/slides.pptx" fileName="slides.pptx" refreshKey={0} sourceSize={1024} />)

    expect(await screen.findByTestId('pptx-preview-panel')).toBeInTheDocument()
    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledWith('/tmp/slides.pptx'))
    expect(new Uint8Array(mocks.parseZipLazyMedia.mock.calls[0][0])).toEqual(new Uint8Array([80, 75, 3, 4]))
    expect(mocks.buildPresentation).toHaveBeenCalledWith(mocks.mockFiles, { lazySlides: true })
    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(mocks.renderList).toHaveBeenCalledWith({
      windowed: true,
      batchSize: 4,
      initialSlides: 3,
      overscanViewport: 2
    })
    expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('1 / 3')
    expect(screen.getByTestId('pptx-preview-zoom-value')).toHaveTextContent('100%')

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))

    await waitFor(() => expect(mocks.goToSlide).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('2 / 3'))

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))

    await waitFor(() => expect(mocks.setZoom).toHaveBeenCalledWith(110))
    expect(screen.getByTestId('pptx-preview-zoom-value')).toHaveTextContent('110%')
  })

  it('strips external media relationships before loading the viewer', async () => {
    render(<PptxPreviewPanel filePath="/tmp/slides.pptx" fileName="slides.pptx" refreshKey={0} sourceSize={1024} />)

    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))

    const presentation = mocks.load.mock.calls[0][0]
    expect(presentation.slides[0].rels.has('rEmbeddedImage')).toBe(true)
    expect(presentation.slides[0].rels.has('rExternalHyperlink')).toBe(true)
    expect(presentation.slides[0].rels.has('rExternalImage')).toBe(false)
    expect(presentation.slides[0].rels.has('rExternalVideo')).toBe(false)
    expect(presentation.layouts.get('layout1')?.rels.has('rLayoutExternalImage')).toBe(false)
    expect(presentation.masters.get('master1')?.rels.has('rMasterExternalMedia')).toBe(false)
  })

  it('rejects oversized sources before reading bytes', async () => {
    render(
      <PptxPreviewPanel
        filePath="/tmp/huge.pptx"
        fileName="huge.pptx"
        refreshKey={0}
        sourceSize={25 * 1024 * 1024 + 1}
      />
    )

    expect(await screen.findByTestId('empty-state')).toHaveTextContent('files.preview.error')
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.parseZipLazyMedia).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('rejects oversized bytes discovered after reading the file', async () => {
    mocks.fsRead.mockResolvedValueOnce(new Uint8Array(25 * 1024 * 1024 + 1))

    render(<PptxPreviewPanel filePath="/tmp/grew.pptx" fileName="grew.pptx" refreshKey={0} />)

    expect(await screen.findByTestId('empty-state')).toHaveTextContent('files.preview.error')
    expect(mocks.viewerInstances).toHaveLength(0)
    expect(mocks.parseZipLazyMedia).not.toHaveBeenCalled()
  })

  it('destroys the viewer when rendering rejects', async () => {
    mocks.renderList.mockImplementationOnce(() => {
      throw new Error('corrupt pptx')
    })

    render(<PptxPreviewPanel filePath="/tmp/bad.pptx" fileName="bad.pptx" refreshKey={0} sourceSize={1024} />)

    expect(await screen.findByTestId('empty-state')).toHaveTextContent('files.preview.error')
    expect(mocks.viewerInstances).toHaveLength(1)
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })
})
