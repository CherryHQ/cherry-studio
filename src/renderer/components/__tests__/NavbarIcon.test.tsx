import { render, screen } from '@testing-library/react'
import { Menu } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import NavbarIcon from '../NavbarIcon'

describe('NavbarIcon', () => {
  it('keeps the default navbar icon style unchanged', () => {
    render(
      <NavbarIcon aria-label="Default action">
        <Menu />
      </NavbarIcon>
    )

    const button = screen.getByRole('button', { name: 'Default action' })

    expect(button).not.toHaveAttribute('data-active')
    expect(button).toHaveClass('hover:bg-muted')
  })

  it('uses the conversation hover style without active state', () => {
    render(
      <NavbarIcon aria-label="Conversation action" tone="conversation">
        <Menu />
      </NavbarIcon>
    )

    const button = screen.getByRole('button', { name: 'Conversation action' })

    expect(button).not.toHaveAttribute('data-active')
    expect(button).toHaveClass('hover:bg-accent/60')
  })

  it('uses the conversation selected style when active', () => {
    render(
      <NavbarIcon aria-label="Active conversation action" tone="conversation" active>
        <Menu />
      </NavbarIcon>
    )

    const button = screen.getByRole('button', { name: 'Active conversation action' })

    expect(button).toHaveAttribute('data-active', 'true')
    expect(button).toHaveClass('bg-secondary')
  })
})
