import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationComposerSlot from '../ConversationComposerSlot'

const mocks = vi.hoisted(() => ({
  narrowMode: false
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [mocks.narrowMode, vi.fn()]
}))

vi.mock('../ComposerCore', () => ({
  default: ({ fallback, forceNarrowLayout }: { fallback: ReactNode; forceNarrowLayout?: boolean }) => (
    <div data-force-narrow-layout={forceNarrowLayout || undefined} data-testid="composer-core">
      {fallback}
    </div>
  )
}))

describe('ConversationComposerSlot', () => {
  beforeEach(() => {
    mocks.narrowMode = false
  })

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

  it('keeps the editor frame stable at the configured wide layout when the composer genuinely suspends', () => {
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
    const controlsLoading = loadingFrame?.querySelector('[data-composer-controls-loading]')
    expect(controlsLoading).toBeInTheDocument()
    expect(loadingFrame?.querySelector('[data-composer-static-send]')).toBeInTheDocument()
    for (const skeleton of loadingFrame?.querySelectorAll('[data-slot="skeleton"]') ?? []) {
      expect(controlsLoading?.contains(skeleton)).toBe(true)
    }
    expect(loadingFrame?.closest('.narrow-mode')).toHaveClass('max-w-full')
    expect(loadingFrame?.closest('.narrow-mode')).not.toHaveClass('active')
  })

  it('matches the configured narrow width while the composer genuinely suspends', () => {
    mocks.narrowMode = true
    const pendingComposer = new Promise<never>(() => undefined)
    const SuspendedComposer = () => {
      throw pendingComposer
    }

    const { container } = render(
      <ConversationComposerSlot scopeKey="topic-1" composerContext={{}} fallback={<SuspendedComposer />} />
    )

    const loadingLayout = container.querySelector('[data-conversation-composer-loading]')?.closest('.narrow-mode')

    expect(loadingLayout).toHaveClass('active', 'max-w-[calc(800px+3rem)]')
    expect(loadingLayout).not.toHaveClass('max-w-full')
  })

  it('keeps home loading narrow when the global layout is wide', () => {
    const pendingComposer = new Promise<never>(() => undefined)
    const SuspendedComposer = () => {
      throw pendingComposer
    }

    const { container } = render(
      <ConversationComposerSlot
        scopeKey="topic-1"
        composerContext={{}}
        fallback={<SuspendedComposer />}
        forceNarrowLayout
      />
    )

    expect(container.querySelector('[data-conversation-composer-loading]')?.closest('.narrow-mode')).toHaveClass(
      'active',
      'max-w-[calc(800px+3rem)]'
    )
  })

  it('forwards the forced narrow layout to an active composer core', () => {
    render(
      <ConversationComposerSlot
        scopeKey="topic-1"
        composerContext={{}}
        fallback={<button type="button">send</button>}
        forceNarrowLayout
      />
    )

    expect(screen.getByTestId('composer-core')).toHaveAttribute('data-force-narrow-layout', 'true')
  })

  it('renders nothing when no fallback composer is available', () => {
    const { container } = render(<ConversationComposerSlot scopeKey="topic-1" composerContext={{}} />)

    expect(container).toBeEmptyDOMElement()
  })
})
