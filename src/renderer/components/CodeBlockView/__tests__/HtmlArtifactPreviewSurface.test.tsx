import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { HtmlArtifactPreviewSurface } from '../HtmlArtifactPreviewSurface'

const DOCUMENT_WITH_SCRIPT =
  '<!doctype html><html><head><title>App</title></head><body><script>window.__ran = true</script><h1>Interactive app</h1></body></html>'
const DOCUMENT_INERT = '<!doctype html><html><head><title>Doc</title></head><body><h1>Static doc</h1></body></html>'
const FRAGMENT_INERT = '<div><h2>Fragment</h2></div>'
const FRAGMENT_WITH_SCRIPT = '<div><canvas id="c"></canvas><script>draw()</script></div>'
const FRAGMENT_WITH_META_REFRESH =
  '<div><meta http-equiv="refresh" content="0;url=https://evil.example"><h2>Redirector</h2></div>'

describe('HtmlArtifactPreviewSurface', () => {
  it('renders a script-less same-origin frame for inert fragments', () => {
    render(<HtmlArtifactPreviewSurface html={FRAGMENT_INERT} title="common.html_preview" authorized />)

    const iframe = screen.getByTitle('common.html_preview')
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(iframe?.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(iframe?.getAttribute('srcdoc')).toContain('html{overflow-y:auto;scrollbar-gutter:stable}')
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
  })

  it('renders a script-less frame for inert documents', () => {
    render(<HtmlArtifactPreviewSurface html={DOCUMENT_INERT} title="common.html_preview" authorized />)

    expect(screen.getByTitle('common.html_preview')).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
  })

  it('routes active documents to the hardened webview partition, not a frame', () => {
    render(<HtmlArtifactPreviewSurface html={DOCUMENT_WITH_SCRIPT} title="common.html_preview" authorized />)

    const webview = screen.getByTestId('interactive-html-webview')
    expect(webview).toHaveAttribute('partition', 'html-artifact-preview')
    // No same-origin iframe exists, so parent.api is unreachable from the artifact.
    expect(screen.queryByTitle('common.html_preview')).not.toBeInTheDocument()
  })

  it('applies the interactive gutter to the load-time scrolling owner', () => {
    render(<HtmlArtifactPreviewSurface html="<script>run()</script>" title="common.html_preview" authorized />)

    const src = screen.getByTestId('interactive-html-webview').getAttribute('src')
    if (!src) throw new Error('Expected an instrumented webview source')
    const instrumentedHtml = decodeURIComponent(src.slice(src.indexOf(',') + 1))
    const parsed = new DOMParser().parseFromString(instrumentedHtml, 'text/html')
    const bridgeScript = parsed.head.querySelector('script')?.textContent
    if (!bridgeScript) throw new Error('Expected an interactive bridge script')

    const frameDocument = document.implementation.createHTMLDocument()
    let scrollRoot: Element = frameDocument.documentElement
    Object.defineProperty(frameDocument, 'scrollingElement', { configurable: true, get: () => scrollRoot })
    Object.defineProperty(frameDocument, 'readyState', { configurable: true, get: () => 'loading' })
    const loadListeners: EventListener[] = []
    const domContentLoadedListeners: EventListener[] = []
    const frameWindow = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === 'load') loadListeners.push(listener)
      }),
      scrollBy: vi.fn()
    }
    frameDocument.addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'DOMContentLoaded') {
        domContentLoadedListeners.push(typeof listener === 'function' ? listener : listener.handleEvent.bind(listener))
      }
    }) as typeof frameDocument.addEventListener

    new Function('document', 'window', 'console', 'ResizeObserver', bridgeScript)(
      frameDocument,
      frameWindow,
      { debug: vi.fn() },
      undefined
    )
    expect(frameDocument.documentElement.style.scrollbarGutter).toBe('stable')
    expect(domContentLoadedListeners.length).toBeGreaterThan(0)

    scrollRoot = frameDocument.body
    domContentLoadedListeners.forEach((listener) => listener(new Event('DOMContentLoaded')))

    expect(frameDocument.body.style.scrollbarGutter).toBe('stable')
    expect(frameDocument.documentElement.style.scrollbarGutter).toBe('')

    loadListeners.forEach((listener) => listener(new Event('load')))

    expect(frameDocument.body.style.scrollbarGutter).toBe('stable')
  })

  it('keeps interactive fragments interactive: active fragments also go to the webview tier', () => {
    render(<HtmlArtifactPreviewSurface html={FRAGMENT_WITH_SCRIPT} title="common.html_preview" authorized />)

    expect(screen.getByTestId('interactive-html-webview')).toHaveAttribute('partition', 'html-artifact-preview')
    expect(screen.queryByTitle('common.html_preview')).not.toBeInTheDocument()
  })

  it('fails closed without authorization: active content renders script-less, never the webview', () => {
    render(<HtmlArtifactPreviewSurface html={DOCUMENT_WITH_SCRIPT} title="common.html_preview" authorized={false} />)

    const iframe = screen.getByTitle('common.html_preview')
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
  })

  it('strips meta-refresh from the static tier so unconsented content cannot auto-navigate', () => {
    render(
      <HtmlArtifactPreviewSurface html={FRAGMENT_WITH_META_REFRESH} title="common.html_preview" authorized={false} />
    )

    const iframe = screen.getByTitle('common.html_preview')
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin')
    // Meta-refresh navigation survives the script-less sandbox and CSP, so the tag
    // itself must be gone from the rendered document (the CSP meta is injected).
    expect(iframe?.getAttribute('srcdoc')).not.toMatch(/http-equiv=["']?refresh/i)
    expect(iframe?.getAttribute('srcdoc')).toContain('Redirector')
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
  })

  it('renders the empty hint instead of any frame for blank content', () => {
    render(<HtmlArtifactPreviewSurface html="   " title="common.html_preview" authorized emptyText="No content" />)

    expect(screen.getByText('No content')).toBeInTheDocument()
    expect(screen.queryByTitle('common.html_preview')).not.toBeInTheDocument()
  })
})
