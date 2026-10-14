import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  applyHtmlPreviewScrollbarGutter,
  HTML_PREVIEW_IFRAME_SANDBOX,
  HTML_PREVIEW_RESTRICTED_CSP,
  HTML_PREVIEW_RESTRICTED_SANDBOX,
  HtmlPreviewFrame,
  injectHtmlPreviewBase,
  injectHtmlPreviewCsp,
  injectHtmlPreviewScrollbarGutter
} from '../HtmlPreviewFrame'

describe('HtmlPreviewFrame', () => {
  it('fails closed by default: script-less sandbox and strict CSP with no explicit props', () => {
    const html = '<html><head><title>Preview</title></head><body><a href="#">Home</a></body></html>'

    render(<HtmlPreviewFrame html={html} title="common.html_preview" />)
    const iframe = screen.getByTitle('common.html_preview')

    expect(iframe).not.toBeNull()
    // Unconsented scripts must never run by default — the caller has to opt into the
    // interactive sandbox explicitly.
    expect(iframe).toHaveAttribute('sandbox', '')
    expect(iframe?.getAttribute('srcdoc')).toContain('<base href="about:srcdoc">')
    expect(iframe?.getAttribute('srcdoc')).toContain("default-src 'none'")
  })

  it('keeps the interactive artifact sandbox an explicit opt-in without a CSP', () => {
    render(
      <HtmlPreviewFrame
        html="<html><body><script>window.x = 1</script></body></html>"
        title="common.html_preview"
        sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
      />
    )
    const iframe = screen.getByTitle('common.html_preview')

    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    // Interactive artifacts need full network access; no CSP meta is injected for that tier.
    expect(iframe?.getAttribute('srcdoc')).not.toContain('Content-Security-Policy')
  })

  it('uses a white browser canvas when HTML does not declare a background', () => {
    render(<HtmlPreviewFrame html="<main>Preview</main>" title="common.html_preview" />)
    const iframe = screen.getByTitle('common.html_preview')

    // The white iframe and parent form the browser-canvas visual contract.
    expect(iframe).toHaveClass('bg-white')
    expect(iframe.parentElement).toHaveClass('bg-white')
  })

  it('renders untrusted local files in a fully restricted, script-less sandbox with a strict CSP', () => {
    render(
      <HtmlPreviewFrame
        html="<p>hi</p>"
        title="common.html_preview"
        sandbox={HTML_PREVIEW_RESTRICTED_SANDBOX}
        csp={HTML_PREVIEW_RESTRICTED_CSP}
      />
    )
    const iframe = screen.getByTitle('common.html_preview')

    // The main window runs with `webSecurity: false`, so an opaque-origin iframe is not a
    // reliable boundary — the only robust exfiltration guard is to run no scripts at all.
    expect(iframe).toHaveAttribute('sandbox', '')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-forms')
    // Strict CSP blocks any residual network connection so a preview cannot phone home.
    expect(iframe?.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(iframe?.getAttribute('srcdoc')).not.toContain('data-cherry-html-preview-scrollbar')
  })

  it('injects a Content-Security-Policy meta into the head for untrusted previews', () => {
    const result = injectHtmlPreviewCsp(
      '<html><head><title>x</title></head><body>hi</body></html>',
      HTML_PREVIEW_RESTRICTED_CSP
    )

    expect(result).toContain(`<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_RESTRICTED_CSP}">`)
    // The meta must precede the body content it governs.
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('hi'))
  })

  it('does not inject security elements into a fake head inside a comment', () => {
    const html = '<!-- <head> -->\n<img src="ht&#x0A;tps://example.com/pixel">'
    const result = injectHtmlPreviewCsp(injectHtmlPreviewBase(html), HTML_PREVIEW_RESTRICTED_CSP)

    expect(result.indexOf('Content-Security-Policy')).toBeGreaterThan(result.indexOf('-->'))
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<img'))
    expect(result).toContain('<head><meta http-equiv="Content-Security-Policy"')
  })

  it('uses the provided file base URL for relative links in local artifact previews', () => {
    const html =
      '<!doctype html><html><head><title>Blog</title></head><body><a href="about.html">About</a></body></html>'

    const result = injectHtmlPreviewBase(html, 'file:///Users/me/Desktop/test/blog.html')

    expect(result).toContain('<base href="file:///Users/me/Desktop/test/blog.html">')
    expect(result).toContain('<a href="about.html">About</a>')
  })

  it('keeps doctype before the injected head for minimal HTML documents', () => {
    const result = injectHtmlPreviewBase('<!doctype html><body><a href="#">Home</a></body>')

    expect(result).toMatch(/^<!doctype html><head><base href="about:srcdoc"><\/head>/)
  })

  it('does not inject another base element when the HTML already declares one', () => {
    const html =
      '<html><head><base href="https://example.com/posts/"><title>Blog</title></head><body>Content</body></html>'

    const result = injectHtmlPreviewBase(html, 'file:///Users/me/Desktop/test/blog.html')

    expect(result.match(/<base\b/gi)).toHaveLength(1)
    expect(result).toContain('<base href="https://example.com/posts/">')
  })

  it('reserves scrollbar width only when the preview surface opts in', () => {
    render(
      <HtmlPreviewFrame
        html="<main>Preview</main>"
        title="common.html_preview"
        sandbox="allow-same-origin"
        stableScrollbarGutter
      />
    )
    const iframe = screen.getByTitle<HTMLIFrameElement>('common.html_preview')

    expect(iframe.getAttribute('srcdoc')).toContain('html{overflow-y:auto;scrollbar-gutter:stable}')
    fireEvent.load(iframe)
    const scrollRoot = iframe.contentDocument?.scrollingElement ?? iframe.contentDocument?.documentElement
    expect((scrollRoot as HTMLElement | null)?.style.overflowY).toBe('auto')
    expect((scrollRoot as HTMLElement | null)?.style.scrollbarGutter).toBe('stable')
  })

  it('recognizes only the owned style marker and remains idempotent', () => {
    const authorHtml = '<p data-cherry-html-preview-scrollbar>Author content</p>'
    const injected = injectHtmlPreviewScrollbarGutter(authorHtml)

    expect(injected).toContain('html{overflow-y:auto;scrollbar-gutter:stable}')
    expect(injectHtmlPreviewScrollbarGutter(injected)).toBe(injected)
  })

  it('does not let an author style with the marker suppress the owned gutter rule', () => {
    const authorHtml = '<style data-cherry-html-preview-scrollbar>.preview{color:red}</style><p>Preview</p>'

    const injected = injectHtmlPreviewScrollbarGutter(authorHtml)

    expect(injected).toContain('html{overflow-y:auto;scrollbar-gutter:stable}')
    expect(injected).toContain('.preview{color:red}')
  })

  it.each([
    [
      'a comment',
      '<!-- <style data-cherry-html-preview-scrollbar>html{overflow-y:auto;scrollbar-gutter:stable}</style> -->'
    ],
    [
      'inert text',
      '<textarea><style data-cherry-html-preview-scrollbar>html{overflow-y:auto;scrollbar-gutter:stable}</style></textarea>'
    ]
  ])('does not let the owned style serialized as %s suppress injection', (_label, authorHtml) => {
    const injected = injectHtmlPreviewScrollbarGutter(authorHtml)
    const parsed = new DOMParser().parseFromString(injected, 'text/html')

    expect(parsed.head.querySelectorAll('style[data-cherry-html-preview-scrollbar]')).toHaveLength(1)
  })

  it('does not let an owned style inside a template suppress the live gutter', () => {
    const authorHtml =
      '<template><style data-cherry-html-preview-scrollbar>html{overflow-y:auto;scrollbar-gutter:stable}</style></template><main>Preview</main>'

    const injected = injectHtmlPreviewScrollbarGutter(authorHtml)
    const parsed = new DOMParser().parseFromString(injected, 'text/html')

    expect(parsed.head.querySelectorAll('style[data-cherry-html-preview-scrollbar]')).toHaveLength(1)
    expect(
      parsed.querySelector('template')?.content.querySelector('style[data-cherry-html-preview-scrollbar]')
    ).not.toBeNull()
  })

  it.each([
    [
      'noscript',
      '<noscript><style data-cherry-html-preview-scrollbar>html{overflow-y:auto;scrollbar-gutter:stable}</style></noscript><main>Preview</main>'
    ],
    [
      'a disabled stylesheet',
      '<style disabled data-cherry-html-preview-scrollbar>html{overflow-y:auto;scrollbar-gutter:stable}</style><main>Preview</main>'
    ]
  ])('does not let an inactive owned style in %s suppress the live gutter', (_label, authorHtml) => {
    const injected = injectHtmlPreviewScrollbarGutter(authorHtml)
    const parsed = new DOMParser().parseFromString(injected, 'text/html')

    expect(parsed.head.querySelectorAll('style[data-cherry-html-preview-scrollbar]:not([disabled])')).toHaveLength(1)
  })

  it('applies the gutter to the actual scrolling element for doctype-less documents', () => {
    const frameDocument = document.implementation.createHTMLDocument()
    Object.defineProperty(frameDocument, 'scrollingElement', { configurable: true, value: frameDocument.body })

    applyHtmlPreviewScrollbarGutter(frameDocument)

    expect(frameDocument.body.style.overflowY).toBe('auto')
    expect(frameDocument.body.style.scrollbarGutter).toBe('stable')
    expect(frameDocument.documentElement.style.scrollbarGutter).toBe('')
  })

  it('renders empty preview text when provided', () => {
    render(<HtmlPreviewFrame html="   " title="common.html_preview" emptyText="No content to preview" />)

    expect(screen.getByText('No content to preview')).toBeInTheDocument()
  })
})
