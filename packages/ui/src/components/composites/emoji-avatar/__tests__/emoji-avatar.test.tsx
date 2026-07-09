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
})
