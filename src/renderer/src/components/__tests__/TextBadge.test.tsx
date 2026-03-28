import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import TextBadge from '../TextBadge'

describe('TextBadge', () => {
  it('should render text correctly', () => {
    render(<TextBadge text="Beta" />)
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('should render as span element', () => {
    render(<TextBadge text="New" />)
    const element = screen.getByText('New')
    expect(element.tagName).toBe('SPAN')
  })

  it('should apply custom styles', () => {
    const customStyle = { marginLeft: '10px' }
    render(<TextBadge text="Test" style={customStyle} />)
    const element = screen.getByText('Test')
    expect(element).toHaveStyle(customStyle)
  })

  it('should handle empty text', () => {
    const { container } = render(<TextBadge text="" />)
    const span = container.querySelector('span')
    expect(span).toBeInTheDocument()
    expect(span?.textContent).toBe('')
  })

  it('should handle special characters', () => {
    const specialText = '特殊字符 & Symbols: <>&"\''
    render(<TextBadge text={specialText} />)
    expect(screen.getByText(specialText)).toBeInTheDocument()
  })

  it('should match snapshot', () => {
    const { container } = render(<TextBadge text="Feature" />)
    expect(container.firstChild).toMatchSnapshot()
  })
})
