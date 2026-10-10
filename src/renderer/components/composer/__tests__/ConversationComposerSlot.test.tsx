import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ConversationComposerSlot from '../ConversationComposerSlot'

vi.mock('../ComposerCore', () => ({
  default: ({ fallback }: { fallback: ReactNode }) => <div data-testid="composer-core">{fallback}</div>
}))

describe('ConversationComposerSlot', () => {
  it('mounts the composer directly without an artificial loading frame', () => {
    const { rerender } = render(
      <ConversationComposerSlot composerContext={{}} fallback={<button type="button">send</button>} />
    )

    expect(screen.getByTestId('composer-core')).toContainElement(screen.getByRole('button', { name: 'send' }))
    expect(document.querySelector('[data-conversation-composer-loading]')).not.toBeInTheDocument()

    rerender(<ConversationComposerSlot composerContext={{}} fallback={<button type="button">send again</button>} />)

    expect(screen.getByTestId('composer-core')).toContainElement(screen.getByRole('button', { name: 'send again' }))
    expect(document.querySelector('[data-conversation-composer-loading]')).not.toBeInTheDocument()
  })

  it('renders nothing when no fallback composer is available', () => {
    const { container } = render(<ConversationComposerSlot composerContext={{}} />)

    expect(container).toBeEmptyDOMElement()
  })
})
