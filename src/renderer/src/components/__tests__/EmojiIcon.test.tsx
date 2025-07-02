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

  it('should apply default size when not provided', () => {
    const { container } = render(<EmojiIcon emoji="🎉" />)

    const emojiContainer = container.firstChild as HTMLElement
    expect(emojiContainer).toHaveStyle({
      width: '26px',
      height: '26px',
      fontSize: '15px'
    })
  })

  it('should apply custom size and fontSize', () => {
    const customSize = 40
    const customFontSize = 24
    const { container } = render(<EmojiIcon emoji="🌟" size={customSize} fontSize={customFontSize} />)

    const emojiContainer = container.firstChild as HTMLElement
    expect(emojiContainer).toHaveStyle({
      width: `${customSize}px`,
      height: `${customSize}px`,
      fontSize: `${customFontSize}px`
    })
  })

  it('should have correct border radius based on size', () => {
    const customSize = 50
    const { container } = render(<EmojiIcon emoji="🎯" size={customSize} />)

    const emojiContainer = container.firstChild as HTMLElement
    expect(emojiContainer).toHaveStyle({
      borderRadius: `${customSize / 2}px`
    })
  })

  it('should render background with blur effect', () => {
    const { container } = render(<EmojiIcon emoji="💎" />)

    // Should have a container div with two emoji instances (one for background, one for foreground)
    const emojiContainer = container.firstChild as HTMLElement
    expect(emojiContainer).toBeTruthy()

    // The container should contain the emoji twice (background + foreground)
    const emojiCount = (emojiContainer.textContent?.match(/💎/g) || []).length
    expect(emojiCount).toBe(2)

    // Should have at least one child element (the background)
    expect(emojiContainer.children.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle special emojis correctly', () => {
    const specialEmojis = ['👨‍💻', '🏃‍♀️', '👨‍👩‍👧‍👦', '🇨🇳']

    specialEmojis.forEach((emoji) => {
      const { container } = render(<EmojiIcon emoji={emoji} />)
      expect(container.textContent).toContain(emoji)
    })
  })

  it('should maintain structure with multiple renders', () => {
    const { container: container1 } = render(<EmojiIcon emoji="🔥" />)
    const { container: container2 } = render(<EmojiIcon emoji="🔥" />)

    expect(container1.innerHTML).toBe(container2.innerHTML)
  })

  it('should apply margin-right style', () => {
    const { container } = render(<EmojiIcon emoji="✨" />)

    const emojiContainer = container.firstChild as HTMLElement
    expect(emojiContainer).toHaveStyle({
      marginRight: '3px'
    })
  })

  it('should handle empty string emoji', () => {
    // Component should handle empty string by showing default emoji in background
    const { container } = render(<EmojiIcon emoji="" />)
    const backgroundElement = container.querySelector('div > div')
    expect(backgroundElement?.textContent).toContain('⭐️')
  })

  it('should correctly structure background and foreground elements', () => {
    const { container } = render(<EmojiIcon emoji="🎨" />)

    const emojiContainer = container.firstChild as HTMLElement
    const backgroundElement = emojiContainer.firstChild as HTMLElement

    // Background should be the first child
    expect(backgroundElement).toBeTruthy()
    expect(backgroundElement.textContent).toBe('🎨')

    // Container should have both background and foreground emoji
    expect(emojiContainer.childNodes.length).toBe(2) // background div + text node
  })
})
