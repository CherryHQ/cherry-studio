// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '../button'

describe('Button', () => {
  it('emits data-busy for loading styles and disables the button', () => {
    render(<Button loading>Save</Button>)

    const button = screen.getByRole('button', { name: /save/i })
    expect(button).toHaveAttribute('data-busy', 'true')
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
    expect(button.className).toContain('data-[busy=true]:cursor-progress')
    expect(button.className).not.toContain('data-[loading=true]')
  })

  it('uses the navbar spinner size for icon-navbar loading buttons', () => {
    render(
      <Button loading size="icon-navbar" aria-label="Refresh">
        <span />
      </Button>
    )

    expect(screen.getByRole('button', { name: 'Refresh' }).querySelector('svg')).toHaveAttribute('width', '18')
  })

  it('exposes pressed state and applies the shared ghost treatment', () => {
    render(
      <Button variant="ghost" pressed>
        Pin
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Pin', pressed: true })
    expect(button).toHaveAttribute('data-pressed', 'true')
    expect(button).toHaveClass(
      'bg-black/10',
      'text-foreground',
      'hover:bg-black/10',
      'dark:bg-white/15',
      'dark:hover:bg-white/15'
    )
  })

  it('applies active styling without exposing toggle semantics', () => {
    render(
      <Button variant="secondary" active>
        Menu
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Menu' })
    expect(button).toHaveAttribute('data-active', 'true')
    expect(button).not.toHaveAttribute('aria-pressed')
    expect(button).toHaveClass(
      'bg-black/15',
      'text-foreground',
      'hover:bg-black/15',
      'dark:bg-white/25',
      'dark:hover:bg-white/25'
    )
  })

  it('applies the shared secondary pressed treatment', () => {
    render(
      <Button variant="secondary" pressed>
        Filter
      </Button>
    )

    expect(screen.getByRole('button', { name: 'Filter', pressed: true })).toHaveClass(
      'bg-black/15',
      'text-foreground',
      'hover:bg-black/15',
      'dark:bg-white/25',
      'dark:hover:bg-white/25'
    )
  })

  it('applies the shared chip treatment', () => {
    render(
      <Button variant="chip" pressed>
        Square
      </Button>
    )

    const button = screen.getByRole('button', { name: 'Square', pressed: true })
    expect(button).not.toHaveClass('bg-muted')
    expect(button).toHaveClass(
      'bg-black/15',
      'ring-1',
      'ring-foreground/30',
      'hover:bg-black/15',
      'dark:hover:bg-white/25'
    )
  })
})
