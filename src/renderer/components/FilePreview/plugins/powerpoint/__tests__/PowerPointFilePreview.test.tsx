// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { AbsoluteFilePath } from '@shared/types/file'
import { createDeferred } from '@shared/utils/async'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    goToSlide: vi.fn(),
    load: vi.fn(),
    mockFiles: { slides: new Map() },
    parseZipLazyMedia: vi.fn(),
    renderList: vi.fn(),
    setZoom: vi.fn()
  }

  class MockPptxViewer {
    destroyed = false
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
      await state.renderList(options)
      if (this.destroyed) return
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
      this.destroyed = true
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

const loggerError = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})

const filePath = '/tmp/presentations/roadmap.pptx' as AbsoluteFilePath

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fsRead.mockResolvedValue(new Uint8Array([80, 75, 3, 4]))
  mocks.parseZipLazyMedia.mockResolvedValue(mocks.mockFiles)
  mocks.buildPresentation.mockImplementation(() => mocks.createMockPresentation())
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { fs: { read: mocks.fsRead } }
  })
})

afterEach(cleanup)

describe('PowerPointFilePreview', () => {
  it('renders slides and updates the page and zoom controls', async () => {
    const user = userEvent.setup()
    render(
      <PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" metadata={{ size: 1024 }} refreshKey={0} />
    )

    expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
    await screen.findByText('rendered pptx')
    expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('1 / 3')

    await user.click(screen.getByRole('button', { name: 'common.next' }))
    await waitFor(() => expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('2 / 3'))

    await user.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    await waitFor(() => expect(screen.getByTestId('pptx-preview-zoom-value')).toHaveTextContent('110%'))
  })

  it('removes external media relationships before loading the viewer', async () => {
    render(
      <PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" metadata={{ size: 1024 }} refreshKey={0} />
    )

    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))

    const presentation = mocks.load.mock.calls[0][0]
    expect(presentation.slides[0].rels.has('rEmbeddedImage')).toBe(true)
    expect(presentation.slides[0].rels.has('rExternalHyperlink')).toBe(true)
    expect(presentation.slides[0].rels.has('rExternalImage')).toBe(false)
  })

  it('rejects oversized PPTX via metadata before reading bytes', async () => {
    render(
      <PowerPointFilePreview
        filePath={filePath}
        fileName="roadmap.pptx"
        metadata={{ size: 25 * 1024 * 1024 + 1 }}
        refreshKey={0}
      />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.parseZipLazyMedia).not.toHaveBeenCalled()
  })

  it('contains read failures inside the preview and logs the cause', async () => {
    const error = new Error('corrupt pptx')
    mocks.fsRead.mockRejectedValueOnce(error)

    render(
      <PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" metadata={{ size: 1024 }} refreshKey={0} />
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('file_preview.load_error.title')
    expect(screen.getByRole('alert')).toHaveTextContent('file_preview.load_error.description')
    expect(loggerError).toHaveBeenCalledWith(`Failed to load PPTX preview: ${filePath}`, error)
  })

  it('rebuilds and destroys the viewer when refreshKey changes', async () => {
    const view = render(
      <PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" metadata={{ size: 1024 }} refreshKey={0} />
    )
    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1))

    view.rerender(
      <PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" metadata={{ size: 1024 }} refreshKey={1} />
    )

    await waitFor(() => expect(mocks.fsRead).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2))
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it.each(['read', 'parse', 'render'] as const)(
    'discards stale %s completion while the refreshed preview is still loading',
    async (stage) => {
      const oldWork = createDeferred<unknown>()
      const nextRead = createDeferred<Uint8Array>()
      const operation = { read: mocks.fsRead, parse: mocks.parseZipLazyMedia, render: mocks.renderList }[stage]
      operation.mockReturnValueOnce(oldWork.promise)
      const view = render(
        <PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" metadata={{ size: 1024 }} refreshKey={0} />
      )
      await waitFor(() => expect(operation).toHaveBeenCalledOnce())
      mocks.fsRead.mockReturnValueOnce(nextRead.promise)
      view.rerender(
        <PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" metadata={{ size: 1024 }} refreshKey={1} />
      )
      await act(async () => {
        oldWork.resolve(stage === 'read' ? new Uint8Array([80, 75, 3, 4]) : mocks.mockFiles)
        await oldWork.promise
      })

      expect(screen.getByRole('status')).toHaveTextContent('file_preview.loading')
      expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('0 / 0')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(loggerError).not.toHaveBeenCalled()
      expect(mocks.load).toHaveBeenCalledTimes(stage === 'render' ? 1 : 0)
      expect(mocks.destroy).toHaveBeenCalledTimes(stage === 'render' ? 1 : 0)

      await act(async () => nextRead.resolve(new Uint8Array([80, 75, 3, 4])))
      await screen.findByText('rendered pptx')
      expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('1 / 3')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      view.unmount()
      expect(mocks.destroy).toHaveBeenCalledTimes(stage === 'render' ? 2 : 1)
    }
  )
})
