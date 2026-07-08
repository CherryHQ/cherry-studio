import type * as CherryStudioUi from '@cherrystudio/ui'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

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
    const backgroundElement = container.querySelector('[aria-hidden="true"]')

    expect(backgroundElement?.querySelector('svg[data-fluent-emoji="⭐️"]')).toBeInTheDocument()
  })
})
