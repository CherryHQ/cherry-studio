import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import InfoTooltip from '../InfoTooltip'

vi.mock('@heroui/react', () => ({
  Tooltip: ({ children, content, showArrow }: { children: React.ReactNode; content: string; showArrow?: boolean }) => (
    <div data-show-arrow={showArrow}>
      {children}
      {content && <div>{content}</div>}
    </div>
  )
}))

vi.mock('lucide-react', () => ({
  Info: ({ ref, ...props }) => (
    <div {...props} ref={ref} role="img" aria-label="Information">
      Info
    </div>
  )
}))

describe('InfoTooltip', () => {
  it('should match snapshot', () => {
    const { container } = render(
      <InfoTooltip title="Test tooltip" placement="top" iconColor="#1890ff" iconStyle={{ fontSize: '16px' }} />
    )
    expect(container.firstChild).toMatchSnapshot()
  })

  it('should pass title prop to the underlying Tooltip component', () => {
    const tooltipText = 'This is helpful information'
    render(<InfoTooltip title={tooltipText} />)

    expect(screen.getByRole('img', { name: 'Information' })).toBeInTheDocument()
    expect(screen.getByText(tooltipText)).toBeInTheDocument()
    expect(document.querySelector('[data-show-arrow="true"]')).toBeInTheDocument()
  })
})
