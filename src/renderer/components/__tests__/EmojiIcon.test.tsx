import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import EmojiIcon from '../EmojiIcon'

describe('EmojiIcon', () => {
  it('should render with provided emoji', () => {
    const { container } = render(<EmojiIcon emoji="🚀" />)

    expect(container.textContent).toContain('🚀')
    expect(container.querySelectorAll('svg[data-fluent-emoji="🚀"]')).toHaveLength(2)
  })

  it('should render default emoji when no emoji provided', () => {
    const { container } = render(<EmojiIcon emoji="" />)

    const background = container.querySelector('[aria-hidden="true"]')
    expect(background?.querySelector('svg[data-fluent-emoji="⭐️"]')).toBeInTheDocument()

    const emojiContainer = container.firstChild as HTMLElement
    expect(emojiContainer.textContent).toBe('')
  })

  it('should apply custom className', () => {
    const customClass = 'custom-emoji-class'
    const { container } = render(<EmojiIcon emoji="😊" className={customClass} />)

    const emojiContainer = container.firstChild as HTMLElement
    expect(emojiContainer).toHaveClass(customClass)
  })

  it('should render Fluent SVG artwork for mapped emoji', () => {
    const { container } = render(<EmojiIcon emoji="🎉" />)

    const svg = container.querySelector('svg[data-fluent-emoji="🎉"]')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 32 32')
  })

  it('should handle mapped special emojis correctly', () => {
    const specialEmojis = ['👨‍💻', '🏃‍♀️']

    specialEmojis.forEach((emoji) => {
      const { container } = render(<EmojiIcon emoji={emoji} />)
      expect(container.textContent).toContain(emoji)
    })
  })

  it('should preserve special emoji when Fluent artwork is unavailable', () => {
    const unsupportedEmojis = ['👨‍👩‍👧‍👦', '🇨🇳']

    unsupportedEmojis.forEach((emoji) => {
      const { container } = render(<EmojiIcon emoji={emoji} />)
      expect(container.querySelector('svg[data-fluent-emoji]')).not.toBeInTheDocument()
      expect(container).toHaveTextContent(emoji)
    })
  })

  it('should apply custom size and fontSize props', () => {
    const { container } = render(<EmojiIcon emoji="🌟" size={40} fontSize={24} />)
    const emojiContainer = container.firstChild as HTMLElement

    // Verify that the component renders with custom props
    expect(emojiContainer).toHaveStyle({ width: '40px', height: '40px' })
    expect(emojiContainer).toHaveStyle({ fontSize: '24px' })
  })

  it('should handle empty string emoji', () => {
    const { container } = render(<EmojiIcon emoji="" />)
    const backgroundElement = container.querySelector('[aria-hidden="true"]')

    expect(backgroundElement?.querySelector('svg[data-fluent-emoji="⭐️"]')).toBeInTheDocument()
  })
})
