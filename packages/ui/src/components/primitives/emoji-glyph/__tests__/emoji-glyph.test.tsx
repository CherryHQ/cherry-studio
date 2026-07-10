// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { EmojiGlyph, hasFluentEmojiIcon } from '@cherrystudio/ui/fluent-emoji'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => {
  cleanup()
})

describe('EmojiGlyph', () => {
  it('detects whether Unicode emoji have Fluent Emoji artwork', () => {
    expect(hasFluentEmojiIcon('😀')).toBe(true)
    expect(hasFluentEmojiIcon('❤️')).toBe(true)
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

  it('hides the mapped glyph wrapper when decorative', () => {
    const { container } = render(<EmojiGlyph emoji="🤖" decorative aria-label="robot" />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.sr-only')).not.toBeInTheDocument()
  })

  it('falls back to Unicode text when Fluent artwork is unavailable', () => {
    const emoji = '👨‍👩‍👧‍👦'
    const { container } = render(<EmojiGlyph emoji={emoji} />)

    expect(container.querySelector('svg')).not.toBeInTheDocument()
    expect(container.textContent).toBe(emoji)
  })
})
