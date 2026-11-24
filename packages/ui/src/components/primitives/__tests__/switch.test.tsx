// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { DescriptionSwitch, Switch } from '../switch'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

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
})

describe('DescriptionSwitch help', () => {
  it('keeps optional help out of the layout and does not toggle when help is clicked', async () => {
    const user = userEvent.setup()
    render(<DescriptionSwitch label="Compact backup" description="Skips attachments" descriptionDisplay="tooltip" />)

    expect(screen.queryByText('Skips attachments')).not.toBeInTheDocument()
    const help = screen.getByRole('img', { name: 'Skips attachments' })
    await user.click(help)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    await user.hover(help)
    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent('Skips attachments')
  })
})
