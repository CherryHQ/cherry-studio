// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import EmojiIcon from '../emoji-icon'

afterEach(() => {
  cleanup()
})

describe('EmojiIcon', () => {
  it('renders the emoji in both foreground and blurred background', () => {
    const { container } = render(<EmojiIcon emoji="🌈" />)

    expect(container.textContent).toContain('🌈')
    const background = container.querySelector('[aria-hidden="true"]')
    expect(background).toBeInTheDocument()
    expect(background).toHaveTextContent('🌈')
    expect(background).toHaveClass('blur-sm', 'opacity-40')
  })

  it('falls back to the default star in the background when emoji is empty', () => {
    const { container } = render(<EmojiIcon emoji="" />)
    const background = container.querySelector('[aria-hidden="true"]')
    expect(background).toHaveTextContent('⭐️')
  })

  it('applies fixed sizing by default with the right margin', () => {
    const { container } = render(<EmojiIcon emoji="🌟" size={40} fontSize={24} />)
    const wrapper = container.firstChild as HTMLElement

    expect(wrapper).toHaveStyle({ width: '40px', height: '40px', fontSize: '24px' })
    expect(wrapper).toHaveClass('me-1')
    expect(wrapper).not.toHaveClass('h-full', 'w-full')
  })

  it('fills the parent and drops the right margin when fluid', () => {
    const { container } = render(<EmojiIcon emoji="🌟" fluid fontSize={10} />)
    const wrapper = container.firstChild as HTMLElement

    expect(wrapper).toHaveClass('h-full', 'w-full')
    expect(wrapper).not.toHaveClass('me-1')
    // Fluid wrapper inherits its width/height from the parent, so it must not carry inline sizing.
    expect(wrapper.style.width).toBe('')
    expect(wrapper.style.height).toBe('')
    expect(wrapper).toHaveStyle({ fontSize: '10px' })
  })
})
