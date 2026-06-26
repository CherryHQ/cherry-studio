import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HtmlPreviewFrame, injectHtmlPreviewBase } from '../HtmlPreviewFrame'

describe('HtmlPreviewFrame', () => {
  it('renders non-empty HTML in an iframe with the shared sandbox and default srcdoc base', () => {
    const html = '<html><head><title>Preview</title></head><body><a href="#">Home</a></body></html>'

    const { container } = render(<HtmlPreviewFrame html={html} title="common.html_preview" />)

    const iframe = container.querySelector('iframe')

    expect(iframe).not.toBeNull()
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
    expect(iframe).toHaveAttribute('title', 'common.html_preview')
    expect(iframe?.getAttribute('srcdoc')).toContain('<base href="about:srcdoc">')
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

  it('renders empty preview text when provided', () => {
    render(<HtmlPreviewFrame html="   " title="common.html_preview" emptyText="No content to preview" />)

    expect(screen.getByText('No content to preview')).toBeInTheDocument()
  })
})
