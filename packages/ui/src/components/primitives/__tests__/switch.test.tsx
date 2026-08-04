// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { Switch } from '../switch'

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

  it('keeps a white thumb with the loading indicator and its public className hook', () => {
    const { container } = render(<Switch loading classNames={{ thumbSvg: 'custom-spinner' }} />)

    expect(screen.getByRole('switch')).toHaveClass('bg-control-accent/60!')
    const thumb = container.querySelector('[data-slot="switch-thumb"]')
    const svg = thumb?.querySelector('svg')
    expect(thumb).toHaveClass('bg-white')
    expect(thumb).not.toHaveClass('bg-background')
    expect(svg).toHaveClass('animate-spin', 'custom-spinner')
  })
})
