// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { EmojiIcon } from '@cherrystudio/ui/fluent-emoji'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => {
  cleanup()
})

describe('EmojiIcon', () => {
  it('renders Fluent SVG artwork in both foreground and blurred background', () => {
    const { container } = render(<EmojiIcon emoji="🌈" />)

    const background = container.querySelector('[aria-hidden="true"]')
    expect(background).toBeInTheDocument()
    expect(background?.querySelector('svg[data-fluent-emoji="🌈"]')).toBeInTheDocument()
    expect(container.querySelectorAll('svg[data-fluent-emoji="🌈"]')).toHaveLength(2)
    expect(container.textContent).toContain('🌈')
    expect(background).toHaveClass('blur-sm', 'opacity-40')
  })

  it('falls back to the default star in the background when emoji is empty', () => {
    const { container } = render(<EmojiIcon emoji="" />)
    const background = container.querySelector('[aria-hidden="true"]')
    expect(background?.querySelector('svg[data-fluent-emoji="⭐️"]')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveTextContent('')
  })

  it('applies fixed sizing by default with the right margin', () => {
    const { container } = render(<EmojiIcon emoji="🌟" size={40} fontSize={24} />)
    const wrapper = container.firstChild as HTMLElement

    expect(wrapper).toHaveStyle({ width: '40px', height: '40px', fontSize: '24px' })
    expect(wrapper).toHaveClass('mr-1')
    expect(wrapper).not.toHaveClass('h-full', 'w-full')
  })

  it('fills the parent and drops the right margin when fluid', () => {
    const { container } = render(<EmojiIcon emoji="🌟" fluid fontSize={10} />)
    const wrapper = container.firstChild as HTMLElement

    expect(wrapper).toHaveClass('h-full', 'w-full')
    expect(wrapper).not.toHaveClass('mr-1')
    // Fluid wrapper inherits its width/height from the parent, so it must not carry inline sizing.
    expect(wrapper.style.width).toBe('')
    expect(wrapper.style.height).toBe('')
    expect(wrapper).toHaveStyle({ fontSize: '10px' })
  })
})
