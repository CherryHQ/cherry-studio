import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ImageToolButton from '../ImageToolButton'

// Mock components
vi.mock('antd', () => ({
  Button: vi.fn(({ children, onClick, ...props }) => (
    <button type="button" data-testid="custom-button" onClick={onClick} {...props}>
      {children}
    </button>
  ))
}))

vi.mock('@cherrystudio/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

describe('ImageToolButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const defaultProps = {
    tooltip: 'Test tooltip',
    icon: <span data-testid="test-icon">Icon</span>,
    onPress: vi.fn()
  }

  it('should match snapshot', () => {
    const { asFragment } = render(<ImageToolButton {...defaultProps} />)
    expect(asFragment()).toMatchSnapshot()
  })
})
