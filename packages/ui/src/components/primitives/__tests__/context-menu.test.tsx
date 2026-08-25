// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuItemContent,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '../context-menu'
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

// Helper: open the menu by firing a contextmenu event on the trigger.
function openMenu(trigger: Element) {
  act(() => {
    fireEvent.contextMenu(trigger)
  })
}

describe('ContextMenu primitive', () => {
  describe('asChild trigger preserves consumer handlers', () => {
    it('left-click fires the consumer onClick on an asChild button', () => {
      const handleClick = vi.fn()
      render(
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button" onClick={handleClick}>
              Trigger
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Item</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
      fireEvent.click(screen.getByText('Trigger'))
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('pointerdown reaches the consumer handler (drag-handler regression guard)', () => {
      const handlePointerDown = vi.fn()
      render(
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button" onPointerDown={handlePointerDown}>
              Trigger
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Item</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
      fireEvent.pointerDown(screen.getByText('Trigger'))
      expect(handlePointerDown).toHaveBeenCalledTimes(1)
    })
  })

  describe('item selection', () => {
    it('fires onSelect exactly once when the user clicks a menu item', () => {
      const handleSelect = vi.fn()
      render(
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button">Trigger</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={handleSelect}>Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )

      openMenu(screen.getByText('Trigger'))
      const item = screen.getByText('Delete')
      fireEvent.click(item)

      expect(handleSelect).toHaveBeenCalledTimes(1)
    })

    it('does not select the item under the pointer when opening with right click', () => {
      const handleSelect = vi.fn()
      render(
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button">Trigger</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={handleSelect}>Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )

      openMenu(screen.getByText('Trigger'))
      fireEvent(screen.getByText('Delete'), new MouseEvent('pointerup', { bubbles: true, button: 2, cancelable: true }))

      expect(handleSelect).not.toHaveBeenCalled()
    })

    it('does not select the item under the pointer when the context menu opens from a primary-button gesture', () => {
      const handleSelect = vi.fn()
      render(
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button">Trigger</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={handleSelect}>Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )

      openMenu(screen.getByText('Trigger'))
      fireEvent(screen.getByText('Delete'), new MouseEvent('pointerup', { bubbles: true, button: 0, cancelable: true }))

      expect(handleSelect).not.toHaveBeenCalled()

      fireEvent.click(screen.getByText('Delete'))

      expect(handleSelect).toHaveBeenCalledTimes(1)
    })

    it('clears the opening pointerup guard when the opening release happens outside the menu content', () => {
      let openingPointerUpListener: ((event: Event) => void) | null = null
      const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation(((type, listener, options) => {
        void options
        if (type === 'pointerup' && typeof listener === 'function') {
          openingPointerUpListener = listener as (event: Event) => void
        }
        return undefined
      }) as Window['addEventListener'])

      render(
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button">Trigger</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Delete</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )

      try {
        openMenu(screen.getByText('Trigger'))
      } finally {
        addEventListener.mockRestore()
      }
      const listener = openingPointerUpListener as ((event: Event) => void) | null
      expect(listener).not.toBeNull()
      listener?.(new MouseEvent('pointerup', { bubbles: true, button: 0, cancelable: true }))

      const itemPointerUp = new MouseEvent('pointerup', { bubbles: true, button: 0, cancelable: true })
      fireEvent(screen.getByText('Delete'), itemPointerUp)

      expect(itemPointerUp.defaultPrevented).toBe(false)
    })

    it('does not fire onSelect on disabled items', () => {
      const handleSelect = vi.fn()
      render(
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button">Trigger</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled onSelect={handleSelect}>
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )

      openMenu(screen.getByText('Trigger'))
      fireEvent.click(screen.getByText('Delete'))

      expect(handleSelect).not.toHaveBeenCalled()
    })
  })

  describe('Electron drag-region opt-out', () => {
    it('marks content and sub-content as no-drag so they stay clickable over titlebar drag regions', () => {
      render(
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button">Trigger</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Delete</ContextMenuItem>
            <ContextMenuSub open>
              <ContextMenuSubTrigger>More</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem>Sub item</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
          </ContextMenuContent>
        </ContextMenu>
      )

      openMenu(screen.getByText('Trigger'))

      expect(screen.getByText('Delete').closest('[data-slot="context-menu-content"]')).toHaveClass(
        '[-webkit-app-region:no-drag]'
      )
      expect(screen.getByText('Sub item').closest('[data-slot="context-menu-sub-content"]')).toHaveClass(
        '[-webkit-app-region:no-drag]'
      )
    })
  })

  describe('portal container', () => {
    it('renders content inside the provider portal container', () => {
      const portalContainer = document.createElement('div')
      document.body.appendChild(portalContainer)

      try {
        render(
          <PortalContainerProvider container={portalContainer}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button type="button">Trigger</button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>Delete</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </PortalContainerProvider>
        )

        openMenu(screen.getByText('Trigger'))

        expect(portalContainer).toContainElement(screen.getByText('Delete'))
      } finally {
        portalContainer.remove()
      }
    })
  })

  describe('destructive variant icon color', () => {
    // ContextMenuItemContent nests the icon two spans deep, so the destructive icon override
    // must be a descendant selector (`[&_svg…]`). A direct-child selector (`*:[svg]`) never
    // reaches the nested icon, letting the base `text-muted-foreground` rule win and rendering
    // the icon gray. Pin the descendant form and guard against the broken direct-child form.
    it('applies the destructive color to icons nested inside ContextMenuItemContent', () => {
      render(
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button type="button">Trigger</button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem variant="destructive">
              <ContextMenuItemContent icon={<svg aria-label="trash" />}>Delete</ContextMenuItemContent>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )

      openMenu(screen.getByText('Trigger'))

      const item = screen.getByText('Delete').closest('[data-slot="context-menu-item"]')
      expect(item).toHaveClass("data-[variant=destructive]:[&_svg:not([class*='text-'])]:text-destructive!")
      expect(item).not.toHaveClass('data-[variant=destructive]:*:[svg]:text-destructive!')
    })
  })
})
