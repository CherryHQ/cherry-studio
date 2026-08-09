import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  HTML_PREVIEW_RESTRICTED_CSP,
  HTML_PREVIEW_RESTRICTED_SANDBOX,
  HtmlPreviewFrame,
  injectHtmlPreviewBase,
  injectHtmlPreviewCsp,
  injectHtmlPreviewDefaultFonts
} from '../HtmlPreviewFrame'

describe('HtmlPreviewFrame', () => {
  it('renders non-empty HTML in an iframe with the shared sandbox and default srcdoc base', () => {
    const html = '<html><head><title>Preview</title></head><body><a href="#">Home</a></body></html>'

    render(<HtmlPreviewFrame html={html} title="common.html_preview" />)
    const iframe = screen.getByTitle('common.html_preview')

    expect(iframe).not.toBeNull()
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    expect(iframe).toHaveAttribute('title', 'common.html_preview')
    expect(iframe?.getAttribute('srcdoc')).toContain('<base href="about:srcdoc">')
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

  it('injects low-specificity default font styles into the preview head', () => {
    const html = '<html><head><title>t</title></head><body><pre>code()</pre><p>text</p></body></html>'

    const result = injectHtmlPreviewDefaultFonts(html, {
      body: "'Roboto', sans-serif",
      code: "'Fira Code', monospace"
    })

    expect(result).toMatch(/^<html><head><style>/)
    expect(result).toContain("html, body { font-family: 'Roboto', sans-serif; }")
    expect(result).toContain("pre, code, kbd, samp { font-family: 'Fira Code', monospace; }")
    expect(result).not.toContain('!important')
  })

  it('falls back to default font stacks when none are provided', () => {
    const result = injectHtmlPreviewDefaultFonts('<body>hi</body>')

    expect(result).toMatch(/^<head><style>/)
    expect(result).toMatch(/html, body \{ font-family: /)
    expect(result).toMatch(/pre, code, kbd, samp \{ font-family: /)
  })

  it('strips angle brackets from font values so they cannot break out of the style tag', () => {
    const result = injectHtmlPreviewDefaultFonts('<body>x</body>', {
      body: "'Roboto'</style><script>alert(1)</script>",
      code: 'monospace'
    })

    // The malicious `</style><script>` inside the font value must be stripped, leaving only the
    // injected style block's own single closing tag.
    expect(result.match(/<\/style>/g)).toHaveLength(1)
    expect(result).not.toContain('<script>')
    expect(result).toContain("html, body { font-family: 'Roboto'/stylescriptalert(1)/script; }")
  })

  it('skips font injection for empty HTML', () => {
    expect(injectHtmlPreviewDefaultFonts('   ')).toBe('   ')
  })

  it('renders srcdoc containing the injected default fonts alongside base and CSP', () => {
    render(
      <HtmlPreviewFrame
        html="<main>Preview</main>"
        title="common.html_preview"
        sandbox={HTML_PREVIEW_RESTRICTED_SANDBOX}
        csp={HTML_PREVIEW_RESTRICTED_CSP}
      />
    )
    const iframe = screen.getByTitle('common.html_preview')

    const srcdoc = iframe?.getAttribute('srcdoc') ?? ''
    expect(srcdoc).toContain('<base href="about:srcdoc">')
    expect(srcdoc).toContain('html, body { font-family:')
    expect(srcdoc).toContain('pre, code, kbd, samp { font-family:')
    expect(srcdoc).toContain("default-src 'none'")
  })

  it('renders empty preview text when provided', () => {
    render(<HtmlPreviewFrame html="   " title="common.html_preview" emptyText="No content to preview" />)

    expect(screen.getByText('No content to preview')).toBeInTheDocument()
  })
})
