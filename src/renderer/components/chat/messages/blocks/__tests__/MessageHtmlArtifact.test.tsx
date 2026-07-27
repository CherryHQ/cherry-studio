import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageHtmlArtifact } from '../MessageHtmlArtifact'

vi.mock('@renderer/components/chat/HtmlArtifactView', () => ({
  HtmlArtifactView: ({ html, title }: { html: string; title: string }) => (
    <div data-testid="html-artifact-view" data-title={title}>
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
    expect(screen.getByTestId('html-artifact-view')).toHaveTextContent('<title>Demo</title><h1>Hello</h1>')
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
