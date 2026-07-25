import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationComposerSlot from '../ConversationComposerSlot'

vi.mock('../ComposerCore', () => ({
  default: ({ fallback }: { fallback: ReactNode }) => <div data-testid="composer-core">{fallback}</div>
}))

describe('ConversationComposerSlot', () => {
  const animationFrames: FrameRequestCallback[] = []

  beforeEach(() => {
    animationFrames.length = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const flushAnimationFrame = () => {
    act(() => {
      const callbacks = animationFrames.splice(0)
      callbacks.forEach((callback) => callback(0))
    })
  }

  it('renders the stable frame for one paint before mounting the fallback composer', () => {
    const { rerender } = render(
      <ConversationComposerSlot
        scopeKey="topic-1"
        composerContext={{}}
        fallback={<button type="button">send</button>}
      />
    )

    expect(document.querySelector('[data-conversation-composer-loading]')).toBeInTheDocument()
    expect(screen.queryByTestId('composer-core')).not.toBeInTheDocument()

    flushAnimationFrame()
    expect(screen.queryByTestId('composer-core')).not.toBeInTheDocument()

    flushAnimationFrame()

    expect(screen.getByTestId('composer-core')).toContainElement(screen.getByRole('button', { name: 'send' }))

    rerender(
      <ConversationComposerSlot
        scopeKey="topic-2"
        composerContext={{}}
        fallback={<button type="button">send</button>}
      />
    )
    expect(document.querySelector('[data-conversation-composer-loading]')).toBeInTheDocument()
    expect(screen.queryByTestId('composer-core')).not.toBeInTheDocument()
  })

  it('renders nothing when no fallback composer is available', () => {
    const { container } = render(<ConversationComposerSlot scopeKey="topic-1" composerContext={{}} />)

    expect(container).toBeEmptyDOMElement()
  })
})
