import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface MockViewerOptions {
  onSlideChange?: (index: number) => void
}

const mocks = vi.hoisted(() => {
  const state = {
    fsRead: vi.fn(),
    viewerInstances: [] as Array<{ currentSlideIndex: number; slideCount: number }>,
    open: vi.fn(),
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

    async open(input: Uint8Array) {
      state.open(input)
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

  return { ...state, MockPptxViewer }
})

vi.mock('@aiden0z/pptx-renderer', () => ({
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
    expect(mocks.open).toHaveBeenCalledWith(new Uint8Array([80, 75, 3, 4]))
    expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('1 / 3')
    expect(screen.getByTestId('pptx-preview-zoom-value')).toHaveTextContent('100%')

    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))

    await waitFor(() => expect(mocks.goToSlide).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.getByTestId('pptx-preview-page-indicator')).toHaveTextContent('2 / 3'))

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))

    await waitFor(() => expect(mocks.setZoom).toHaveBeenCalledWith(110))
    expect(screen.getByTestId('pptx-preview-zoom-value')).toHaveTextContent('110%')
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
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
