import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ConversationComposerSlot from '../ConversationComposerSlot'

vi.mock('../ComposerCore', () => ({
  default: ({ fallback }: { fallback: ReactNode }) => <div data-testid="composer-core">{fallback}</div>
}))

describe('ConversationComposerSlot', () => {
  it('mounts a ready composer without an artificial loading frame', () => {
    const { rerender } = render(
      <ConversationComposerSlot
        scopeKey="topic-1"
        composerContext={{}}
        fallback={<button type="button">send</button>}
      />
    )

    expect(screen.getByTestId('composer-core')).toContainElement(screen.getByRole('button', { name: 'send' }))
    expect(document.querySelector('[data-conversation-composer-loading]')).not.toBeInTheDocument()

    rerender(
      <ConversationComposerSlot
        scopeKey="topic-2"
        composerContext={{}}
        fallback={<button type="button">send</button>}
      />
    )

    expect(screen.getByTestId('composer-core')).toContainElement(screen.getByRole('button', { name: 'send' }))
    expect(document.querySelector('[data-conversation-composer-loading]')).not.toBeInTheDocument()
  })

  it('keeps the editor frame stable when the composer genuinely suspends', () => {
    const pendingComposer = new Promise<never>(() => undefined)
    const SuspendedComposer = () => {
      throw pendingComposer
    }

    const { container } = render(
      <ConversationComposerSlot scopeKey="topic-1" composerContext={{}} fallback={<SuspendedComposer />} />
    )

    const loadingFrame = container.querySelector('[data-conversation-composer-loading]')
    const editorFrame = loadingFrame?.querySelector('[data-composer-editor-frame]')

    expect(loadingFrame).toBeInTheDocument()
    expect(editorFrame).toBeInTheDocument()
    expect(editorFrame?.querySelector('[data-slot="skeleton"]')).toBeNull()
    expect(loadingFrame?.querySelector('[data-composer-controls-loading]')).toBeInTheDocument()
  })

  it('renders nothing when no fallback composer is available', () => {
    const { container } = render(<ConversationComposerSlot scopeKey="topic-1" composerContext={{}} />)

    expect(container).toBeEmptyDOMElement()
  })
})
