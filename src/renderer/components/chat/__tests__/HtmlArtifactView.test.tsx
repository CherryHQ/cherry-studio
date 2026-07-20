import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HtmlArtifactView } from '../HtmlArtifactView'

const mocks = vi.hoisted(() => ({
  createTempFile: vi.fn(),
  resizeObserverCallbacks: [] as ResizeObserverCallback[],
  CodeViewer: vi.fn(({ value }) => <pre data-testid="code-viewer">{value}</pre>),
  HtmlPreviewFrame: vi.fn(({ title }: { html: string; title: string }) => (
    <div data-testid="html-preview-frame" title={title} />
  )),
  loggerError: vi.fn(),
  openPath: vi.fn(),
  save: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  write: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => children
}))

vi.mock('@renderer/components/CodeViewer', () => ({ default: mocks.CodeViewer }))
vi.mock('@renderer/components/CodeBlockView/HtmlPreviewFrame', () => ({
  default: mocks.HtmlPreviewFrame
}))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: mocks.loggerError })
  }
}))
vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess
  }
}))
vi.mock('@renderer/utils/error', () => ({
  formatErrorMessageWithPrefix: vi.fn((error, prefix) => `${prefix}: ${(error as Error).message}`)
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('HtmlArtifactView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resizeObserverCallbacks = []
    mocks.createTempFile.mockResolvedValue('/tmp/artifacts-preview.html')
    mocks.openPath.mockResolvedValue(undefined)
    mocks.save.mockResolvedValue('/tmp/Preview.html')
    mocks.write.mockResolvedValue(undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: {
        file: {
          createTempFile: mocks.createTempFile,
          openPath: mocks.openPath,
          save: mocks.save,
          write: mocks.write
        }
      }
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          mocks.resizeObserverCallbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('switches directly between HTML and code in the message surface', () => {
    render(<HtmlArtifactView html="<h1>Hello</h1>" title="Preview" />)

    expect(screen.getByTestId('html-preview-frame')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'html_artifacts.code' }))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('<h1>Hello</h1>')
    fireEvent.click(screen.getByRole('button', { name: 'html_artifacts.preview' }))
    expect(screen.getByTestId('html-preview-frame')).toBeInTheDocument()
  })

  it('keeps a stable 16:9 desktop viewport and uses the shared preview frame defaults', () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview" />)

    const viewport = screen.getByTestId('desktop-html-preview')
    const canvas = screen.getByTestId('desktop-html-canvas')
    expect(viewport).toHaveClass('aspect-video')
    expect(canvas).toHaveStyle({ width: '1440px', height: '810px' })

    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 720 })
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 405 })
    mocks.resizeObserverCallbacks[0]?.([], {} as ResizeObserver)
    expect(canvas).toHaveStyle({ transform: 'scale(0.5)' })

    expect(mocks.HtmlPreviewFrame).toHaveBeenCalledWith(
      {
        html: '<main>Page</main>',
        title: 'Preview'
      },
      undefined
    )
  })

  it('opens the HTML source externally from the inline controls', async () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview" />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.artifacts.button.openExternal' }))

    await waitFor(() => expect(mocks.openPath).toHaveBeenCalledWith('/tmp/artifacts-preview.html'))
    expect(mocks.createTempFile).toHaveBeenCalledWith('artifacts-preview.html')
    expect(mocks.write).toHaveBeenCalledWith('/tmp/artifacts-preview.html', '<main>Page</main>')
  })

  it('downloads the HTML source from the inline controls', async () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview Page" />)

    fireEvent.click(screen.getByRole('button', { name: 'code_block.download.label' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('Preview-Page.html', '<main>Page</main>'))
    expect(mocks.toastSuccess).toHaveBeenCalledWith('message.download.success')
  })

  it('zooms the HTML viewport without changing the message dimensions', () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview" />)

    const surface = screen.getByTestId('html-artifact-surface')
    const controls = screen.getByTestId('html-artifact-controls')
    const zoomLayer = screen.getByTestId('desktop-html-zoom-layer')
    expect(surface).toHaveClass('aspect-video')
    expect(surface).toContainElement(controls)
    expect(controls).toHaveClass('opacity-0', 'group-hover:opacity-100')
    expect(zoomLayer).toHaveStyle({ width: '100%', height: '100%', transform: 'scale(1)' })

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(screen.getByRole('button', { name: 'preview.reset' })).toHaveTextContent('110%')
    expect(zoomLayer).toHaveStyle({
      width: '90.9090909090909%',
      height: '90.9090909090909%',
      transform: 'scale(1.1)'
    })

    fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))
    expect(screen.getByRole('button', { name: 'preview.reset' })).toHaveTextContent('100%')
    expect(zoomLayer).toHaveStyle({ width: '100%', height: '100%', transform: 'scale(1)' })
  })
})
