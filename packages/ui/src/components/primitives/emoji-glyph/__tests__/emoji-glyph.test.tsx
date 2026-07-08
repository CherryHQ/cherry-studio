// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { EmojiGlyph, emojiToFluentEmojiIconName, hasFluentEmojiIcon } from '..'

afterEach(() => {
  cleanup()
})

describe('EmojiGlyph', () => {
  it('maps Unicode emoji to Fluent Emoji Flat icon names', () => {
    expect(emojiToFluentEmojiIconName('😀')).toBe('grinning-face')
    expect(emojiToFluentEmojiIconName('❤️')).toBe('red-heart')
    expect(hasFluentEmojiIcon('🤖')).toBe(true)
    expect(hasFluentEmojiIcon('👨‍👩‍👧‍👦')).toBe(false)
  })

  it('renders mapped emoji with local Fluent SVG artwork while preserving the Unicode identity', () => {
    const { container } = render(<EmojiGlyph emoji="🤖" />)

    const svg = container.querySelector('svg[data-fluent-emoji="🤖"]')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('viewBox', '0 0 32 32')
    expect(svg?.innerHTML).toContain('<path')
    expect(container.textContent).toContain('🤖')
  })

  it('falls back to Unicode text when Fluent artwork is unavailable', () => {
    const emoji = '👨‍👩‍👧‍👦'
    const { container } = render(<EmojiGlyph emoji={emoji} />)

    expect(container.querySelector('svg')).not.toBeInTheDocument()
    expect(container.textContent).toBe(emoji)
  })
})
