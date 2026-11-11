import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComposerContextProvider } from '../../../composer/ComposerContext'
import {
  ConversationTopBarPortal,
  ConversationTopBarPortalHost,
  ConversationTopBarPortalProvider
} from '../ConversationTopBarPortal'

const originalResizeObserver = globalThis.ResizeObserver

describe('ConversationTopBarPortal', () => {
  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  it('suppresses portaled composer controls while an override is active', () => {
    const view = render(
      <ComposerContextProvider value={{ overrides: [] }}>
        <ConversationTopBarPortalProvider>
          <ConversationTopBarPortalHost />
          <ConversationTopBarPortal>
            <button type="button">composer control</button>
          </ConversationTopBarPortal>
        </ConversationTopBarPortalProvider>
      </ComposerContextProvider>
    )

    expect(screen.getByRole('button', { name: 'composer control' })).toBeInTheDocument()

    view.rerender(
      <ComposerContextProvider
        value={{
          overrides: [
            {
              id: 'tool-permission:approval-1',
              render: () => null
            }
          ]
        }}>
        <ConversationTopBarPortalProvider>
          <ConversationTopBarPortalHost />
          <ConversationTopBarPortal>
            <button type="button">composer control</button>
          </ConversationTopBarPortal>
        </ConversationTopBarPortalProvider>
      </ComposerContextProvider>
    )

    expect(screen.queryByRole('button', { name: 'composer control' })).not.toBeInTheDocument()

    view.rerender(
      <ComposerContextProvider value={{ overrides: [] }}>
        <ConversationTopBarPortalProvider>
          <ConversationTopBarPortalHost />
          <ConversationTopBarPortal>
            <button type="button">composer control</button>
          </ConversationTopBarPortal>
        </ConversationTopBarPortalProvider>
      </ComposerContextProvider>
    )

    expect(screen.getByRole('button', { name: 'composer control' })).toBeInTheDocument()
  })
})
