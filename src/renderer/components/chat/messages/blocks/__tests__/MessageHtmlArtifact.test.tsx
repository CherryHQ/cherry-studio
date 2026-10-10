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
  it('loads the artifact view only after an artifact is rendered', async () => {
    render(<MessageHtmlArtifact artifactId="artifact" html="<title>Demo</title><h1>Hello</h1>" />)

    expect(screen.getByTestId('message-html-artifact')).toHaveAttribute('data-html-artifact')
    expect(screen.queryByTestId('html-artifact-view')).not.toBeInTheDocument()

    const artifactView = await screen.findByTestId('html-artifact-view')
    expect(artifactView).toHaveAttribute('data-artifact-id', 'artifact')
    expect(artifactView).toHaveAttribute('data-title', 'Demo')
    expect(artifactView).toHaveAttribute('data-streaming', 'false')
    expect(artifactView).toHaveTextContent('<title>Demo</title><h1>Hello</h1>')
  })

  it('forwards the Markdown streaming state and classification to the existing artifact view', async () => {
    render(<MessageHtmlArtifact artifactId="artifact" html="<main>Partial</main>" kind="fragment" isStreaming />)

    const artifactView = await screen.findByTestId('html-artifact-view')
    expect(artifactView).toHaveAttribute('data-streaming', 'true')
    expect(artifactView).toHaveAttribute('data-kind', 'fragment')
    expect(artifactView).toHaveTextContent('<main>Partial</main>')
  })

  it('falls back to the gated document classification when none is supplied', async () => {
    render(<MessageHtmlArtifact artifactId="artifact" html="<main>Partial</main>" />)

    expect(await screen.findByTestId('html-artifact-view')).toHaveAttribute('data-kind', 'document')
  })

  it('forwards editing and save support to the artifact view', async () => {
    const onSave = vi.fn()

    render(<MessageHtmlArtifact artifactId="artifact" html="<main>Page</main>" onSave={onSave} editable />)

    expect(await screen.findByTestId('html-artifact-view')).toHaveAttribute('data-editable', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith('updated html')
  })
})
