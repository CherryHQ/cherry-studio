import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import EmojiIcon from '../EmojiIcon'

describe('EmojiIcon', () => {
  it('should render with provided emoji', () => {
    const { container } = render(<EmojiIcon emoji="🚀" />)

    // Should render the emoji
    expect(container.textContent).toContain('🚀')

    // Should also render emoji in background
    const background = container.querySelector('div > div')
    expect(background?.textContent).toContain('🚀')
  })

  it('should render default emoji when no emoji provided', () => {
    const { container } = render(<EmojiIcon emoji="" />)

    // Background should have default star emoji
    const background = container.querySelector('div > div')
    expect(background?.textContent).toContain('⭐️')

    // Foreground should be empty (the actual emoji prop value)
    const emojiContainer = container.firstChild as HTMLElement
    // Remove background text to get only foreground text
    const foregroundText = emojiContainer.textContent?.replace(background?.textContent || '', '')
    expect(foregroundText).toBe('')
  })

  it('should apply custom className', () => {
    const customClass = 'custom-emoji-class'
    const { container } = render(<EmojiIcon emoji="😊" className={customClass} />)

    const emojiContainer = container.firstChild as HTMLElement
    expect(emojiContainer).toHaveClass(customClass)
  })

  it('should match snapshot', () => {
    const { container } = render(<EmojiIcon emoji="🎉" />)
    expect(container.firstChild).toMatchSnapshot()
  })

  it('should handle special emojis correctly', () => {
    const specialEmojis = ['👨‍💻', '🏃‍♀️', '👨‍👩‍👧‍👦', '🇨🇳']

    specialEmojis.forEach((emoji) => {
      const { container } = render(<EmojiIcon emoji={emoji} />)
      expect(container.textContent).toContain(emoji)
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
    const backgroundElement = container.querySelector('div > div')

    // Should show default emoji in background when emoji is empty
    expect(backgroundElement?.textContent).toContain('⭐️')
  })
})
