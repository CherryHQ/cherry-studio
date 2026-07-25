// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../dropdown-menu'
import { PortalContainerProvider } from '../portal-container'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

afterEach(() => {
  cleanup()
})

describe('DropdownMenuContent', () => {
  it('uses the provider portal container by default', () => {
    const portalContainer = document.createElement('div')
    document.body.appendChild(portalContainer)

    try {
      render(
        <PortalContainerProvider container={portalContainer}>
          <DropdownMenu open>
            <DropdownMenuTrigger>Open</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </PortalContainerProvider>
      )

      expect(portalContainer).toContainElement(screen.getByText('Item'))
    } finally {
      portalContainer.remove()
    }
  })

  it('marks content and sub-content as no-drag so they stay clickable over titlebar drag regions', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    expect(screen.getByText('Item').closest('[data-slot="dropdown-menu-content"]')).toHaveClass(
      '[-webkit-app-region:no-drag]'
    )
    expect(screen.getByText('Sub item').closest('[data-slot="dropdown-menu-sub-content"]')).toHaveClass(
      '[-webkit-app-region:no-drag]'
    )
  })

  // A destructive item's icon can be nested (e.g. wrapped in a layout span by the caller), so the
  // override must be a descendant selector (`[&_svg…]`); the broken direct-child form (`*:[svg]`)
  // never reaches a nested icon and leaves it muted-gray. Pin the descendant form, ban the old one.
  it('scopes the destructive icon color with a descendant selector', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem variant="destructive">
            <span>
              <svg aria-label="trash" />
            </span>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const item = screen.getByText('Delete').closest('[data-slot="dropdown-menu-item"]')
    expect(item).toHaveClass("data-[variant=destructive]:[&_svg:not([class*='text-'])]:text-destructive!")
    expect(item).not.toHaveClass('data-[variant=destructive]:*:[svg]:text-destructive!')
  })
})
