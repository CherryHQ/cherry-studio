import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageToolButton from '../ImageToolButton'

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onPress, disabled, isDisabled, startContent, ...props }: any) => (
    <button type="button" data-testid="button" onClick={onPress} disabled={disabled || isDisabled} {...props}>
      {startContent}
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

describe('ImageToolButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    tooltip: 'Test tooltip',
    icon: <span data-testid="test-icon">Icon</span>,
    onClick: vi.fn()
  }

  it('renders button content and emits click', () => {
    render(<ImageToolButton {...defaultProps} />)

    const button = screen.getByRole('button', { name: defaultProps.tooltip })
    expect(button).toBeInTheDocument()
    expect(screen.getByTestId('test-icon')).toBeInTheDocument()

    fireEvent.click(button)
    expect(defaultProps.onClick).toHaveBeenCalledTimes(1)
  })
})
