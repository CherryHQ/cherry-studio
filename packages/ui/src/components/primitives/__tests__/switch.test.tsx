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

  it('uses the shadcn default track and thumb classes', () => {
    render(<Switch defaultChecked />)

    const root = screen.getByRole('switch')
    const thumb = root.querySelector('[data-slot="switch-thumb"]')

    expect(root).toHaveAttribute('data-size', 'default')
    expect(root).toHaveClass('h-[1.15rem]', 'w-8', 'data-[state=checked]:bg-[var(--color-primary)]')
    expect(root).toHaveClass('data-[state=unchecked]:bg-input')
    expect(thumb).toHaveClass('size-4', 'bg-background', 'data-[state=checked]:translate-x-[calc(100%-2px)]')
    expect(thumb?.querySelector('svg')).not.toBeInTheDocument()
  })

  it('maps legacy extra-small size to the shadcn small size', () => {
    render(<Switch size="xs" />)

    const root = screen.getByRole('switch')
    const thumb = root.querySelector('[data-slot="switch-thumb"]')

    expect(root).toHaveAttribute('data-size', 'sm')
    expect(root).toHaveClass('h-3.5', 'w-6')
    expect(thumb).toHaveClass('size-3')
  })

  it('keeps legacy small size at the shadcn default size', () => {
    render(<Switch size="sm" />)

    const root = screen.getByRole('switch')
    const thumb = root.querySelector('[data-slot="switch-thumb"]')

    expect(root).toHaveAttribute('data-size', 'default')
    expect(root).toHaveClass('h-[1.15rem]', 'w-8')
    expect(thumb).toHaveClass('size-4')
  })

  it('keeps the shadcn thumb while exposing loading state', () => {
    render(<Switch loading defaultChecked />)

    const root = screen.getByRole('switch')
    const thumb = root.querySelector('[data-slot="switch-thumb"]')

    expect(root).toHaveAttribute('data-loading', 'true')
    expect(root).toHaveClass('cursor-progress')
    expect(thumb?.querySelector('svg')).not.toBeInTheDocument()
  })
})
