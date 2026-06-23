import { render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/Buttons', () => ({
  ActionIconButton: ({
    active,
    className,
    icon,
    type,
    ...props
  }: ComponentProps<'button'> & { active?: boolean; icon: ReactNode }) => (
    <button
      type={type ?? 'button'}
      className={className}
      data-active={active || undefined}
      data-testid="action-icon-button"
      {...props}>
      {icon}
    </button>
  )
}))

const { MessageActionButton } = await import('../MessageActionButton')

describe('MessageActionButton', () => {
  it('renders through the shared ActionIconButton implementation', () => {
    render(
      <MessageActionButton active className="message-action-button" aria-label="Copy">
        <span>Copy icon</span>
      </MessageActionButton>
    )

    const button = screen.getByTestId('action-icon-button')

    expect(button).toHaveAccessibleName('Copy')
    expect(button).toHaveAttribute('data-active', 'true')
    expect(button).toHaveClass('message-action-button')
    expect(button).toHaveTextContent('Copy icon')
  })
})
