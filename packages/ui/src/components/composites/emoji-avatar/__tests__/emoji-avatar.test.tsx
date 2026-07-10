// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { EmojiAvatar } from '@cherrystudio/ui/fluent-emoji'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => {
  cleanup()
})

describe('EmojiAvatar', () => {
  it('renders Fluent SVG artwork for mapped emoji', () => {
    const { container } = render(<EmojiAvatar>🌈</EmojiAvatar>)

    expect(container.querySelector('svg[data-fluent-emoji="🌈"]')).toBeInTheDocument()
    expect(container.textContent).toContain('🌈')
  })

  it('uses a stable Fluent fallback when children have no artwork', () => {
    const unsupportedEmoji = '👨‍👩‍👧‍👦'
    const { container } = render(<EmojiAvatar>{unsupportedEmoji}</EmojiAvatar>)

    expect(container.querySelector('svg[data-fluent-emoji="😀"]')).toBeInTheDocument()
    expect(container.textContent).not.toContain(unsupportedEmoji)
  })

  it('uses the provided Fluent fallback for unsupported children', () => {
    const unsupportedEmoji = '👨‍👩‍👧‍👦'
    const { container } = render(<EmojiAvatar fallbackEmoji="🤖">{unsupportedEmoji}</EmojiAvatar>)

    expect(container.querySelector('svg[data-fluent-emoji="🤖"]')).toBeInTheDocument()
    expect(container.textContent).not.toContain(unsupportedEmoji)
  })

  it('preserves non-emoji text avatars', () => {
    const { container } = render(<EmojiAvatar>A</EmojiAvatar>)

    expect(container.querySelector('svg[data-fluent-emoji="😀"]')).not.toBeInTheDocument()
    expect(container).toHaveTextContent('A')
  })
})
