import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import IndicatorLight from '../IndicatorLight'

describe('IndicatorLight', () => {
  it('should render with default props', () => {
    const { container } = render(<IndicatorLight color="red" />)
    const light = container.firstChild as HTMLElement

    expect(light).toHaveStyle({
      width: '8px',
      height: '8px',
      animation: 'pulse 2s infinite'
    })
  })

  it('should apply custom size', () => {
    const { container } = render(<IndicatorLight color="blue" size={16} />)
    const light = container.firstChild as HTMLElement

    expect(light).toHaveStyle({
      width: '16px',
      height: '16px'
    })
  })

  it('should convert green color to hex value', () => {
    const { container } = render(<IndicatorLight color="green" />)
    const light = container.firstChild as HTMLElement
    expect(light).toHaveStyle({ backgroundColor: '#22c55e' })
  })

  it('should disable shadow when specified', () => {
    const { container } = render(<IndicatorLight color="red" shadow={false} />)
    const light = container.firstChild as HTMLElement
    expect(light).toHaveStyle({ boxShadow: 'none' })
  })

  it('should disable animation when specified', () => {
    const { container } = render(<IndicatorLight color="green" animation={false} />)
    const light = container.firstChild as HTMLElement
    expect(light).toHaveStyle({ animation: 'none' })
  })

  it('should match snapshot', () => {
    const { container } = render(<IndicatorLight color="green" />)
    expect(container.firstChild).toMatchSnapshot()
  })
})
