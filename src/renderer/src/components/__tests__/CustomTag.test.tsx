import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import CustomTag from '../Tags/CustomTag'

const COLOR = '#ff0000'

describe('CustomTag', () => {
  it('should render children text', () => {
    render(<CustomTag color={COLOR}>content</CustomTag>)
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('should render icon if provided', () => {
    render(
      <CustomTag color={COLOR} icon={<span data-testid="icon">cherry</span>}>
        content
      </CustomTag>
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('should show tooltip if tooltip prop is set', async () => {
    render(
      <CustomTag color={COLOR} tooltip="reasoning model">
        reasoning
      </CustomTag>
    )
    // 鼠标悬停触发 Tooltip
    await userEvent.hover(screen.getByText('reasoning'))
    expect(await screen.findByText('reasoning model')).toBeInTheDocument()
  })

  it('should not render Tooltip when tooltip is not set', () => {
    render(<CustomTag color="#ff0000">no tooltip</CustomTag>)

    expect(screen.getByText('no tooltip')).toBeInTheDocument()
    // 不应有 tooltip 相关内容
    expect(document.querySelector('.ant-tooltip')).toBeNull()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
