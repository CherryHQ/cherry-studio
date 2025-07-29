import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import DividerWithText from '../DividerWithText'

describe('DividerWithText', () => {
  it('should render with correct structure and text', () => {
    const text = 'Section Title'
    render(<DividerWithText text={text} />)

    // Verify text is rendered
    const textElement = screen.getByText(text)
    expect(textElement).toBeInTheDocument()
    expect(textElement.tagName).toBe('SPAN')

    // Verify structure
    const dividerContainer = textElement.parentElement as HTMLElement
    expect(dividerContainer).toBeTruthy()
    expect(dividerContainer.tagName).toBe('DIV')
    expect(dividerContainer.children.length).toBe(2)

    // Verify line element exists
    const lineElement = dividerContainer.children[1] as HTMLElement
    expect(lineElement.tagName).toBe('DIV')
  })

  it('should apply custom styles', () => {
    const customStyle = {
      marginTop: '20px',
      marginBottom: '30px',
      padding: '10px'
    }

    const { container } = render(<DividerWithText text="Styled" style={customStyle} />)
    const dividerContainer = container.firstChild as HTMLElement

    expect(dividerContainer).toHaveStyle(customStyle)
  })

  it('should handle edge cases for text prop', () => {
    // Empty string
    const { container, rerender } = render(<DividerWithText text="" />)
    const emptySpan = container.querySelector('span')
    expect(emptySpan).toBeTruthy()
    expect(emptySpan?.textContent).toBe('')

    // Long text
    const longText = 'This is a very long section title that might wrap or cause layout issues'
    rerender(<DividerWithText text={longText} />)
    expect(screen.getByText(longText)).toBeInTheDocument()

    // Special characters
    const specialText = '特殊字符 & Symbols: <>&"\'@#$%'
    rerender(<DividerWithText text={specialText} />)
    expect(screen.getByText(specialText)).toBeInTheDocument()
  })

  it('should match snapshot', () => {
    const { container } = render(<DividerWithText text="Test Divider" />)
    expect(container.firstChild).toMatchSnapshot()
  })
})
