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

  it('dims only the track when loading, keeping the thumb color intact', () => {
    const { container } = render(<Switch loading />)

    expect(container.querySelector('[data-slot="switch-thumb"] svg')).toBeNull()
    expect(screen.getByRole('switch')).toHaveClass('bg-primary/60!')
    const thumb = container.querySelector('[data-slot="switch-thumb"]')
    expect(thumb).not.toHaveClass('bg-primary/60!')
    expect(thumb).toHaveClass('bg-background')
  })
})
