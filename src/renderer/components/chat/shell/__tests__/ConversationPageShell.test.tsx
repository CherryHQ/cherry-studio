import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import ConversationPageShell from '../ConversationPageShell'

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => ['bubble']
}))

vi.mock('../ConversationShell', () => ({
  default: ({
    center,
    centerClassName,
    centerId,
    className,
    id,
    onPaneCollapse,
    pane,
    paneOpen,
    panePosition
  }: {
    center?: ReactNode
    centerClassName?: string
    centerId?: string
    className?: string
    id?: string
    onPaneCollapse?: () => void
    pane?: ReactNode
    paneOpen?: boolean
    panePosition?: string
  }) => (
    <section
      data-center-class-name={centerClassName ?? ''}
      data-center-id={centerId ?? ''}
      data-class-name={className ?? ''}
      data-id={id ?? ''}
      data-pane-open={String(paneOpen)}
      data-pane-position={panePosition ?? ''}
      data-testid="conversation-shell">
      <button type="button" onClick={onPaneCollapse}>
        Collapse
      </button>
      <div data-testid="pane">{pane}</div>
      <div data-testid="center">{center}</div>
    </section>
  )
}))

describe('ConversationPageShell', () => {
  it('applies the message style and forwards the center slot to ConversationShell', () => {
    const onPaneCollapse = vi.fn()

    render(
      <ConversationPageShell
        id="chat"
        className="extra-class"
        pane={<div data-testid="pane-content" />}
        paneOpen
        panePosition="left"
        onPaneCollapse={onPaneCollapse}
        center={{
          className: 'relative',
          content: <div data-testid="center-content" />,
          id: 'resource-center'
        }}
      />
    )

    const shell = screen.getByTestId('conversation-shell')

    expect(shell).toHaveAttribute('data-id', 'chat')
    expect(shell).toHaveAttribute('data-class-name', 'bubble extra-class')
    expect(shell).toHaveAttribute('data-pane-open', 'true')
    expect(shell).toHaveAttribute('data-pane-position', 'left')
    expect(shell).toHaveAttribute('data-center-id', 'resource-center')
    expect(shell).toHaveAttribute('data-center-class-name', 'relative')
    expect(screen.getByTestId('pane-content')).toBeInTheDocument()
    expect(screen.getByTestId('center-content')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))

    expect(onPaneCollapse).toHaveBeenCalledTimes(1)
  })
})
