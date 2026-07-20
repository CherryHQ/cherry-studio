import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageHtmlArtifact } from '../MessageHtmlArtifact'

vi.mock('@cherrystudio/ui', () => ({
  Skeleton: ({ className }: { className?: string }) => <div className={className} />
}))

vi.mock('@renderer/components/chat/HtmlArtifactView', () => ({
  HtmlArtifactView: ({ html, title }: { html: string; title: string }) => (
    <div data-testid="html-artifact-view" data-title={title}>
      {html}
    </div>
  )
}))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('MessageHtmlArtifact', () => {
  it('shows a visual placeholder without rendering code while streaming', () => {
    render(<MessageHtmlArtifact html="<h1>Hello</h1>" isStreaming />)

    expect(screen.getByTestId('html-artifact-generating-placeholder')).toHaveTextContent('html_artifacts.generating')
    expect(screen.queryByText('<h1>Hello</h1>')).not.toBeInTheDocument()
    expect(screen.queryByTestId('html-artifact-view')).not.toBeInTheDocument()
  })

  it('renders the completed HTML in the message artifact view', () => {
    render(<MessageHtmlArtifact html="<title>Demo</title><h1>Hello</h1>" isStreaming={false} />)

    expect(screen.getByTestId('message-html-artifact')).toHaveAttribute('data-html-artifact')
    expect(screen.getByTestId('html-artifact-view')).toHaveAttribute('data-title', 'Demo')
    expect(screen.getByTestId('html-artifact-view')).toHaveTextContent('<title>Demo</title><h1>Hello</h1>')
  })

  it('sizes the artifact from the conversation viewport outside narrow mode', () => {
    render(
      <div data-message-virtual-list-scroller>
        <div className="fold">
          <div className="message">
            <div>
              <MessageHtmlArtifact html="<main>Page</main>" isStreaming={false} />
            </div>
          </div>
        </div>
      </div>
    )

    const scroller = screen
      .getByTestId('message-html-artifact')
      .closest<HTMLElement>('[data-message-virtual-list-scroller]')
    const artifact = screen.getByTestId('message-html-artifact')
    if (!scroller) throw new Error('Expected message scroller')

    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      width: 1200,
      height: 700,
      left: 100
    } as DOMRect)
    vi.spyOn(artifact, 'getBoundingClientRect').mockReturnValue({ left: 300 } as DOMRect)
    fireEvent(window, new Event('resize'))

    expect(artifact).toHaveStyle({ width: '896px', marginLeft: '-48px' })
  })

  it('stays inside the message column in narrow mode', () => {
    render(
      <div data-message-virtual-list-scroller>
        <div className="narrow-mode active">
          <div className="fold">
            <div className="message">
              <div data-testid="narrow-content">
                <MessageHtmlArtifact html="<main>Page</main>" isStreaming={false} />
              </div>
            </div>
          </div>
        </div>
      </div>
    )

    const artifact = screen.getByTestId('message-html-artifact')
    const scroller = artifact.closest<HTMLElement>('[data-message-virtual-list-scroller]')
    const content = screen.getByTestId('narrow-content')
    if (!scroller) throw new Error('Expected message scroller')

    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      width: 1200,
      height: 700,
      left: 100
    } as DOMRect)
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ width: 760, left: 220 } as DOMRect)
    vi.spyOn(artifact, 'getBoundingClientRect').mockReturnValue({ left: 220 } as DOMRect)
    fireEvent(window, new Event('resize'))

    expect(artifact).toHaveStyle({ width: '760px', marginLeft: '0px' })
  })
})
