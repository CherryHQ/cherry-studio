import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { htmlArtifactPreviewRequiresInteractive, HtmlArtifactPreviewSurface } from '../HtmlArtifactPreviewSurface'

const DOCUMENT_WITH_SCRIPT =
  '<!doctype html><html><head><title>App</title></head><body><script>window.__ran = true</script><h1>Interactive app</h1></body></html>'
const DOCUMENT_INERT = '<!doctype html><html><head><title>Doc</title></head><body><h1>Static doc</h1></body></html>'
const FRAGMENT = '<div><h2>Fragment</h2></div>'

describe('htmlArtifactPreviewRequiresInteractive', () => {
  it('requires the webview tier only for documents with active content', () => {
    expect(htmlArtifactPreviewRequiresInteractive(DOCUMENT_WITH_SCRIPT, 'document')).toBe(true)
    expect(htmlArtifactPreviewRequiresInteractive(DOCUMENT_INERT, 'document')).toBe(false)
    expect(htmlArtifactPreviewRequiresInteractive(FRAGMENT, 'fragment')).toBe(false)
    // A script-bearing fragment embedded in prose never gets the webview tier.
    expect(htmlArtifactPreviewRequiresInteractive('<div><script>1</script></div>', 'fragment')).toBe(false)
  })

  it('fails closed: a missing classification is treated as a document', () => {
    expect(htmlArtifactPreviewRequiresInteractive(DOCUMENT_WITH_SCRIPT)).toBe(true)
    expect(htmlArtifactPreviewRequiresInteractive(DOCUMENT_INERT)).toBe(false)
  })
})

describe('HtmlArtifactPreviewSurface', () => {
  it('renders a script-less same-origin frame for fragments', () => {
    render(<HtmlArtifactPreviewSurface html={FRAGMENT} title="common.html_preview" kind="fragment" />)

    const iframe = screen.getByTitle('common.html_preview')
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(iframe?.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
  })

  it('renders a script-less frame for inert documents', () => {
    render(<HtmlArtifactPreviewSurface html={DOCUMENT_INERT} title="common.html_preview" kind="document" />)

    expect(screen.getByTitle('common.html_preview')).toHaveAttribute('sandbox', 'allow-same-origin')
    expect(screen.queryByTestId('interactive-html-webview')).not.toBeInTheDocument()
  })

  it('routes documents with active content to the hardened webview partition, not a frame', () => {
    render(<HtmlArtifactPreviewSurface html={DOCUMENT_WITH_SCRIPT} title="common.html_preview" kind="document" />)

    const webview = screen.getByTestId('interactive-html-webview')
    expect(webview).toHaveAttribute('partition', 'html-artifact-preview')
    // No same-origin iframe exists, so parent.api is unreachable from the artifact.
    expect(screen.queryByTitle('common.html_preview')).not.toBeInTheDocument()
  })

  it('fails closed when kind is omitted: a script-bearing document still gets the webview', () => {
    render(<HtmlArtifactPreviewSurface html={DOCUMENT_WITH_SCRIPT} title="common.html_preview" />)

    expect(screen.getByTestId('interactive-html-webview')).toBeInTheDocument()
  })

  it('renders the empty hint instead of any frame for blank content', () => {
    render(<HtmlArtifactPreviewSurface html="   " title="common.html_preview" kind="fragment" emptyText="No content" />)

    expect(screen.getByText('No content')).toBeInTheDocument()
    expect(screen.queryByTitle('common.html_preview')).not.toBeInTheDocument()
  })
})
