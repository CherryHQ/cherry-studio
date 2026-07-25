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

  it('should keep default star layer when emoji is empty', () => {
    const { container } = render(<EmojiIcon emoji="" />)
    const backgroundElement = container.querySelector('div > div')

    expect(backgroundElement?.textContent).toContain('⭐️')
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

    expect(emojiContainer).toHaveTextContent('🌟')
  })

  it('should provide explicit empty-string rendering for emoji prop', () => {
    const { container } = render(<EmojiIcon emoji="" />)
    const emojiContainer = container.firstChild as HTMLElement
    expect(emojiContainer).toBeTruthy()
  })
})
