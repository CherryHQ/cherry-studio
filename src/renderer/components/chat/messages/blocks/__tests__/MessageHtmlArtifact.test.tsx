import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageHtmlArtifact } from '../MessageHtmlArtifact'

vi.mock('@renderer/components/chat/HtmlArtifactView', () => ({
  HtmlArtifactView: ({
    artifactId,
    html,
    title,
    onSave,
    editable,
    kind,
    isStreaming
  }: {
    artifactId: string
    html: string
    title: string
    onSave?: (html: string) => void
    editable: boolean
    kind: string
    isStreaming: boolean
  }) => (
    <div
      data-testid="html-artifact-view"
      data-artifact-id={artifactId}
      data-title={title}
      data-editable={editable}
      data-kind={kind}
      data-streaming={isStreaming}>
      {html}
      <button type="button" onClick={() => onSave?.('updated html')}>
        Save
      </button>
    </div>
  )
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('MessageHtmlArtifact', () => {
  it('renders the completed HTML in the message artifact view', () => {
    render(<MessageHtmlArtifact artifactId="artifact" html="<title>Demo</title><h1>Hello</h1>" />)

    expect(screen.getByTestId('message-html-artifact')).toHaveAttribute('data-html-artifact')
    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-artifact-id', 'artifact')
    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-title', 'Demo')
    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-streaming', 'false')
    expect(screen.getByTestId('html-artifact-view')).toHaveTextContent('<title>Demo</title><h1>Hello</h1>')
  })

  it('forwards the Markdown streaming state and classification to the existing artifact view', () => {
    render(<MessageHtmlArtifact artifactId="artifact" html="<main>Partial</main>" kind="fragment" isStreaming />)

    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-streaming', 'true')
    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-kind', 'fragment')
    expect(screen.getByTestId('html-artifact-view')).toHaveTextContent('<main>Partial</main>')
  })

  it('falls back to the gated document classification when none is supplied', () => {
    render(<MessageHtmlArtifact artifactId="artifact" html="<main>Partial</main>" />)

    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-kind', 'document')
  })

  it('forwards editing and save support to the artifact view', () => {
    const onSave = vi.fn()

    render(<MessageHtmlArtifact artifactId="artifact" html="<main>Page</main>" onSave={onSave} editable />)

    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-editable', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('updated html')
  })

  it('inherits the message content width in every layout', () => {
    render(
      <div data-message-virtual-list-scroller>
        <div className="fold">
          <div className="message">
            <div data-testid="message-content">
              <MessageHtmlArtifact artifactId="artifact" html="<main>Page</main>" />
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
