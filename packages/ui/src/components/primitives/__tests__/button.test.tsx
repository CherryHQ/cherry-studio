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
})
