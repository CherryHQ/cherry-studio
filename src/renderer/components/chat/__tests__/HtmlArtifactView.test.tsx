import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HtmlArtifactView } from '../HtmlArtifactView'

const mocks = vi.hoisted(() => ({
  createTempFile: vi.fn(),
  htmlPreviewRestrictedCsp: "default-src 'none'",
  resizeObserverCallbacks: [] as ResizeObserverCallback[],
  CodeViewer: vi.fn(({ value }) => <pre data-testid="code-viewer">{value}</pre>),
  HtmlPreviewFrame: vi.fn(
    ({ title, iframeRef }: { html: string; title: string; iframeRef?: Ref<HTMLIFrameElement> }) => (
      <iframe ref={iframeRef} data-testid="html-preview-frame" title={title} sandbox="" />
    )
  ),
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
  HTML_PREVIEW_RESTRICTED_CSP: mocks.htmlPreviewRestrictedCsp,
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
  const originalInnerHeight = window.innerHeight

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resizeObserverCallbacks = []
    mocks.createTempFile.mockResolvedValue('/tmp/artifacts-preview.html')
    mocks.openPath.mockResolvedValue(undefined)
    mocks.save.mockResolvedValue('/tmp/Preview.html')
    mocks.write.mockResolvedValue(undefined)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
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
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    vi.unstubAllGlobals()
  })

  const createPreviewContentHeightController = () => {
    const iframe = screen.getByTestId<HTMLIFrameElement>('html-preview-frame')
    const body = iframe.contentDocument?.body
    if (!body) throw new Error('Expected iframe body')

    body.style.margin = '0'
    const content = body.ownerDocument.createElement('main')
    body.replaceChildren(content)

    let contentHeight = 0
    const surface = screen.getByTestId('html-artifact-surface')
    const zoomLayer = screen.getByTestId('adaptive-html-zoom-layer')
    const getZoomScale = () => Number.parseFloat(zoomLayer.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? '1')
    Object.defineProperty(iframe, 'clientHeight', {
      configurable: true,
      get: () => (Number.parseFloat(surface.style.height) || 0) / getZoomScale()
    })
    Object.defineProperty(body, 'scrollHeight', {
      configurable: true,
      get: () => Math.max(contentHeight, iframe.clientHeight)
    })
    Object.defineProperty(body.ownerDocument.documentElement, 'scrollHeight', {
      configurable: true,
      get: () => Math.max(contentHeight, iframe.clientHeight)
    })
    vi.spyOn(content, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          bottom: contentHeight,
          height: contentHeight,
          width: 100
        }) as DOMRect
    )

    return (height: number) => {
      contentHeight = height
      fireEvent.load(iframe)
      mocks.resizeObserverCallbacks.forEach((callback) => callback([], {} as ResizeObserver))
    }
  }

  it('switches directly between HTML and code in the message surface', () => {
    render(<HtmlArtifactView html="<h1>Hello</h1>" title="Preview" />)

    expect(screen.getByTestId('html-preview-frame')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'html_artifacts.code' }))
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('<h1>Hello</h1>')
    fireEvent.click(screen.getByRole('button', { name: 'html_artifacts.preview' }))
    expect(screen.getByTestId('html-preview-frame')).toBeInTheDocument()
  })

  it('requires explicit consent before mounting HTML with scripts', () => {
    const html = '<script>window.parent.api.file.write("/tmp/example", "unsafe")</script>'

    render(<HtmlArtifactView html={html} title="Preview" />)

    expect(screen.getByTestId('html-artifact-consent-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('html-preview-frame')).not.toBeInTheDocument()
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'html_artifacts.interactive_preview.action' }))

    expect(screen.getByTestId('interactive-html-webview')).toHaveAttribute('partition', 'html-artifact-preview')
    expect(screen.queryByTestId('html-artifact-consent-overlay')).not.toBeInTheDocument()
  })

  it('renders static inline HTML immediately in the restricted iframe', () => {
    const html = '<main><style>h1 { color: red; }</style><h1>Hello</h1></main>'

    render(<HtmlArtifactView html={html} title="Preview" />)

    expect(mocks.HtmlPreviewFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        html,
        sandbox: 'allow-same-origin',
        csp: expect.stringContaining("default-src 'none'")
      }),
      undefined
    )
  })

  it('requires new consent when interactive HTML content changes', () => {
    const { rerender } = render(<HtmlArtifactView html="<script>one()</script>" title="Preview" />)

    fireEvent.click(screen.getByRole('button', { name: 'html_artifacts.interactive_preview.action' }))
    expect(screen.getByTestId('interactive-html-webview')).toBeInTheDocument()

    rerender(<HtmlArtifactView html="<script>two()</script>" title="Preview" />)

    expect(screen.getByTestId('html-artifact-consent-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
  })

  it('adapts the surface height to the iframe content within the conversation viewport', () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview" />)

    const surface = screen.getByTestId('html-artifact-surface')
    expect(surface).not.toHaveClass('aspect-video')
    expect(surface).not.toHaveClass('rounded-xl', 'border', 'bg-background')
    expect(surface).toHaveStyle({ height: '240px' })
    const setPreviewContentHeight = createPreviewContentHeightController()

    setPreviewContentHeight(180)
    expect(surface).toHaveStyle({ height: '180px' })

    setPreviewContentHeight(360)
    expect(surface).toHaveStyle({ height: '360px' })

    setPreviewContentHeight(1200)
    expect(surface).toHaveStyle({ height: '576px' })

    setPreviewContentHeight(160)
    expect(surface).toHaveStyle({ height: '160px' })

    expect(mocks.HtmlPreviewFrame).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<main>Page</main>',
        title: 'Preview'
      }),
      undefined
    )
  })

  it('allows iframe boundary scrolling to continue into the chat scroller', () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview" />)

    const iframe = screen.getByTestId<HTMLIFrameElement>('html-preview-frame')
    fireEvent.load(iframe)

    const frameDocument = iframe.contentDocument
    if (!frameDocument) throw new Error('Expected iframe document')
    const scrollRoot = (frameDocument.scrollingElement ?? frameDocument.documentElement) as HTMLElement
    expect(scrollRoot.style.getPropertyValue('overscroll-behavior-y')).toBe('')
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

  it('zooms the HTML viewport and keeps the surface fitted to the scaled content', () => {
    render(<HtmlArtifactView html="<main>Page</main>" title="Preview" />)

    const surface = screen.getByTestId('html-artifact-surface')
    const controls = screen.getByTestId('html-artifact-controls')
    const zoomLayer = screen.getByTestId('adaptive-html-zoom-layer')
    const setPreviewContentHeight = createPreviewContentHeightController()
    setPreviewContentHeight(300)

    expect(surface).toHaveStyle({ height: '300px' })
    expect(surface).toContainElement(controls)
    expect(controls).toHaveClass('opacity-0', 'group-hover:opacity-100')
    expect(zoomLayer).toHaveStyle({ width: '100%', height: '100%', transform: 'scale(1)' })

    fireEvent.click(screen.getByRole('button', { name: 'preview.zoom_in' }))
    expect(screen.getByRole('button', { name: 'preview.reset' })).toHaveTextContent('110%')
    expect(surface).toHaveStyle({ height: '330px' })
    expect(zoomLayer).toHaveStyle({
      width: '90.9090909090909%',
      height: '90.9090909090909%',
      transform: 'scale(1.1)'
    })

    fireEvent.click(screen.getByRole('button', { name: 'preview.reset' }))
    expect(screen.getByRole('button', { name: 'preview.reset' })).toHaveTextContent('100%')
    expect(surface).toHaveStyle({ height: '300px' })
    expect(zoomLayer).toHaveStyle({ width: '100%', height: '100%', transform: 'scale(1)' })
  })
})
