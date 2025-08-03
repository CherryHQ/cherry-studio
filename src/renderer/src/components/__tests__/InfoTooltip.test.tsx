import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import InfoTooltip from '../InfoTooltip'

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

  it('should show tooltip on hover', async () => {
    const tooltipText = 'This is helpful information'
    render(<InfoTooltip title={tooltipText} />)

    const icon = screen.getByRole('img', { name: 'Information' })
    await userEvent.hover(icon)

    expect(await screen.findByText(tooltipText)).toBeInTheDocument()
  })
})
