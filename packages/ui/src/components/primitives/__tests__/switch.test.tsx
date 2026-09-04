// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { DescriptionSwitch, Switch } from '../switch'

afterEach(() => {
  cleanup()
})

describe('Switch', () => {
  it('toggles aria-checked when clicked', async () => {
    const user = userEvent.setup()
    render(<Switch />)

    const root = screen.getByRole('switch')

    expect(root).toHaveAttribute('aria-checked', 'false')
    await user.click(root)
    expect(root).toHaveAttribute('aria-checked', 'true')
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    render(<Switch disabled />)

    const root = screen.getByRole('switch')

    expect(root).toHaveAttribute('aria-checked', 'false')
    await user.click(root)
    expect(root).toHaveAttribute('aria-checked', 'false')
  })

  it('renders the thumb svg without the invalid "inherit" dimension attributes', () => {
    const { container } = render(<Switch />)

    const svg = container.querySelector('[data-slot="switch-thumb"] svg')

    expect(svg).not.toBeNull()
    // "inherit" is a CSS keyword and is invalid as an SVG width/height attribute,
    // which makes React throw "<svg> attribute width: Expected length, "inherit"".
    expect(svg).not.toHaveAttribute('width', 'inherit')
    expect(svg).not.toHaveAttribute('height', 'inherit')
    // Sizing is handled by the cva class so the svg fills the fixed-size thumb.
    expect(svg).toHaveClass('size-full')
  })

  it('uses logical thumb spacing and reverses checked travel in RTL', () => {
    const { container } = render(<Switch size="md" />)
    const thumb = container.querySelector('[data-slot="switch-thumb"]')

    expect(thumb).toHaveClass('ms-0.5')
    expect(thumb).toHaveClass('data-[state=checked]:translate-x-[21px]')
    expect(thumb).toHaveClass('rtl:data-[state=checked]:-translate-x-[21px]')
  })
})

describe('DescriptionSwitch', () => {
  it('places the control at logical end by default', () => {
    const { container } = render(<DescriptionSwitch label="Notifications" />)
    expect(container.firstElementChild).not.toHaveClass('flex-row-reverse')
  })

  it('places the control at logical start when requested', () => {
    const { container } = render(<DescriptionSwitch label="Notifications" controlPosition="start" />)
    expect(container.firstElementChild).toHaveClass('flex-row-reverse')
  })
})
