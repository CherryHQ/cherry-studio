import { render, screen } from '@testing-library/react'
import type * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ChatAppShell } from '../ChatAppShell'

vi.mock('@renderer/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: React.PropsWithChildren) => <>{children}</>
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  motion: {
    div: ({
      children,
      layout: _layout,
      transition: _transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & { layout?: boolean; transition?: unknown }) => {
      void _layout
      void _transition
      return <div {...props}>{children}</div>
    }
  }
}))

describe('ChatAppShell', () => {
  it('keeps side panel inside chat-main with the navbar layer', () => {
    const { container } = render(
      <ChatAppShell
        centerId="chat-main"
        topBar={<div data-testid="navbar" />}
        sidePanel={<div data-testid="settings-panel" />}
        main={<div data-testid="main" />}
      />
    )

    const chatMain = container.querySelector('#chat-main')

    expect(chatMain).toContainElement(screen.getByTestId('navbar'))
    expect(chatMain).toContainElement(screen.getByTestId('settings-panel'))
    expect(chatMain).toContainElement(screen.getByTestId('main'))
    expect(chatMain).toHaveClass('relative')
  })
})
