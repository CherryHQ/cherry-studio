// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '../button'

describe('Button', () => {
  it('uses a flat semantic treatment for the default primary action', () => {
    render(<Button>Continue</Button>)

    const button = screen.getByRole('button', { name: 'Continue' })
    expect(button).toHaveClass('bg-primary', 'text-primary-foreground', 'shadow-xs')
    expect(button).not.toHaveClass('bg-gradient-to-b')
    expect(button.className).not.toContain('--button-elevated-')
    expect(button.className).not.toContain('shadow-[')
  })

  it('uses a translucent destructive surface for subtle destructive actions', () => {
    render(<Button variant="destructiveSubtle">Delete</Button>)

    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveClass('bg-destructive/10', 'text-destructive', 'shadow-none')
    expect(button).toHaveClass('hover:bg-destructive/20', 'dark:bg-destructive/20')
    expect(button).not.toHaveClass('bg-destructive', 'text-white')
  })

  it('uses variant state feedback instead of an outer focus ring', () => {
    render(<Button variant="link">Learn more</Button>)

    const button = screen.getByRole('button', { name: 'Learn more' })
    expect(button.className).toContain('focus-visible:underline')
    expect(button.className).not.toMatch(/focus-visible:ring-(?!0)/)
    expect(button.className).not.toContain('focus-visible:outline-')
  })

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
})
