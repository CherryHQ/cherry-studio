import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import InfoTooltip from '../InfoTooltip'

vi.mock('antd', () => ({
  Tooltip: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      {children}
      {title && <div>{title}</div>}
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
  })
})
