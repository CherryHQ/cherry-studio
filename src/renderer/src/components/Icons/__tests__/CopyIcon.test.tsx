import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import CopyIcon from '../CopyIcon'

describe('CopyIcon', () => {
  it('should render with default class', () => {
    const { container } = render(<CopyIcon />)
    const icon = container.querySelector('i')

    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('iconfont')
    expect(icon).toHaveClass('icon-copy')
  })

  it('should merge custom className with default classes', () => {
    const customClass = 'custom-icon-class'
    const { container } = render(<CopyIcon className={customClass} />)
    const icon = container.querySelector('i')

    expect(icon).toHaveClass('iconfont')
    expect(icon).toHaveClass('icon-copy')
    expect(icon).toHaveClass(customClass)
  })

  it('should pass through additional props', () => {
    const onClick = vi.fn()
    const { container } = render(<CopyIcon onClick={onClick} title="Copy to clipboard" data-testid="copy-icon" />)
    const icon = container.querySelector('i')

    expect(icon).toHaveAttribute('title', 'Copy to clipboard')
    expect(icon).toHaveAttribute('data-testid', 'copy-icon')

    icon?.click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('should match snapshot', () => {
    const { container } = render(<CopyIcon />)
    expect(container.firstChild).toMatchSnapshot()
  })
})
