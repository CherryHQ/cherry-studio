import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
