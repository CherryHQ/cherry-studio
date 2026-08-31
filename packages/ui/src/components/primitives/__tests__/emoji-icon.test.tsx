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

  it('derives fixed emoji artwork from the declared icon box', () => {
    const { container } = render(<EmojiIcon emoji="🌟" size={14} />)

    const wrapper = container.querySelector<HTMLElement>('[data-slot="emoji-icon"]')
    const foreground = container.querySelector<HTMLElement>('[data-slot="emoji-icon-foreground"]')
    const background = container.querySelector<HTMLElement>('[data-slot="emoji-icon-background"]')

    expect(wrapper).toHaveStyle({ width: '14px', height: '14px', containerType: 'inline-size' })
    expect(wrapper).not.toHaveClass('mr-1')
    expect(foreground).toHaveStyle({ fontSize: '70cqi', lineHeight: '1' })
    expect(background).toHaveStyle({ fontSize: '120cqi' })
  })

  it('uses the same optical sizing contract while filling its parent', () => {
    const { container } = render(<EmojiIcon emoji="🌟" fluid />)
    const wrapper = container.querySelector<HTMLElement>('[data-slot="emoji-icon"]')
    const foreground = container.querySelector<HTMLElement>('[data-slot="emoji-icon-foreground"]')

    expect(wrapper).toHaveClass('h-full', 'w-full')
    expect(wrapper).not.toHaveClass('mr-1')
    expect(wrapper?.style.width).toBe('')
    expect(wrapper?.style.height).toBe('')
    expect(foreground).toHaveStyle({ fontSize: '70cqi', lineHeight: '1' })
  })

  it('keeps the legacy fontSize override compatible without changing the icon box', () => {
    const { container } = render(<EmojiIcon emoji="🌟" size={40} fontSize={24} />)
    const wrapper = container.querySelector<HTMLElement>('[data-slot="emoji-icon"]')
    const foreground = container.querySelector<HTMLElement>('[data-slot="emoji-icon-foreground"]')
    const background = container.querySelector<HTMLElement>('[data-slot="emoji-icon-background"]')

    expect(wrapper).toHaveStyle({ width: '40px', height: '40px' })
    expect(foreground).toHaveStyle({ fontSize: '24px', lineHeight: '1' })
    expect(background).toHaveStyle({ fontSize: '48px' })
  })
})
