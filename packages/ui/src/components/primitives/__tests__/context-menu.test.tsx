// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../context-menu'

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
})
