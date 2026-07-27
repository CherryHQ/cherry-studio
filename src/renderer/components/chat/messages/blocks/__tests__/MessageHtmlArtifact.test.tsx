import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageHtmlArtifact } from '../MessageHtmlArtifact'

vi.mock('@renderer/components/chat/HtmlArtifactView', () => ({
  HtmlArtifactView: ({
    html,
    title,
    kind,
    isStreaming
  }: {
    html: string
    title: string
    kind: string
    isStreaming: boolean
  }) => (
    <div data-testid="html-artifact-view" data-title={title} data-kind={kind} data-streaming={isStreaming}>
      {html}
    </div>
  )
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('MessageHtmlArtifact', () => {
  it('renders the completed HTML in the message artifact view', () => {
    render(<MessageHtmlArtifact html="<title>Demo</title><h1>Hello</h1>" />)

    expect(screen.getByTestId('message-html-artifact')).toHaveAttribute('data-html-artifact')
    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-title', 'Demo')
    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-streaming', 'false')
    expect(screen.getByTestId('html-artifact-view')).toHaveTextContent('<title>Demo</title><h1>Hello</h1>')
  })

  it('forwards the Markdown streaming state and classification to the existing artifact view', () => {
    render(<MessageHtmlArtifact html="<main>Partial</main>" kind="fragment" isStreaming />)

    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-streaming', 'true')
    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-kind', 'fragment')
    expect(screen.getByTestId('html-artifact-view')).toHaveTextContent('<main>Partial</main>')
  })

  it('falls back to the gated document classification when none is supplied', () => {
    render(<MessageHtmlArtifact html="<main>Partial</main>" />)

    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-kind', 'document')
  })

  it('inherits the message content width in every layout', () => {
    render(
      <div data-message-virtual-list-scroller>
        <div className="fold">
          <div className="message">
            <div data-testid="message-content">
              <MessageHtmlArtifact html="<main>Page</main>" />
            </div>
          </div>
        </div>
      </div>
    )

    const artifact = screen.getByTestId('message-html-artifact')
    expect(artifact).toHaveClass('w-full', 'min-w-0', 'max-w-full')
    expect(artifact).not.toHaveAttribute('style')
    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-title', 'common.html_preview')
  })
})
