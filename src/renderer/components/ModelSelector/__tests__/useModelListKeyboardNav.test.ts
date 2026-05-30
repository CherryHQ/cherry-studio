/**
 * Behavior tests for `useModelListKeyboardNav`.
 *
 * Covers the contracts the popover relies on:
 * - Arrow keys wrap within list bounds
 * - Page Up/Down clamp at the edges (no wrap)
 * - Enter only fires `onSelectItem` when focus is on a valid item
 * - Escape closes the popover
 * - IME composing (`event.isComposing`) suppresses every handler — critical
 *   for CJK users; without this guard, Enter during composition would
 *   select the currently-focused item instead of committing the IME text.
 * - Effect is inert while closed or with an empty list
 */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useModelListKeyboardNav } from '../useModelListKeyboardNav'

interface Item {
  key: string
}

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({ key: `item-${index}` }))
}

function dispatchKey(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

interface RenderOptions {
  open?: boolean
  items?: Item[]
  focusedItemKey?: string
  pageSize?: number
}

function renderNav(options: RenderOptions = {}) {
  const onClose = vi.fn()
  const onFocusItem = vi.fn()
  const onSelectItem = vi.fn()

  renderHook(() =>
    useModelListKeyboardNav<Item>({
      open: options.open ?? true,
      focusedItemKey: options.focusedItemKey ?? '',
      items: options.items ?? makeItems(5),
      onClose,
      onFocusItem,
      onSelectItem,
      pageSize: options.pageSize
    })
  )

  return { onClose, onFocusItem, onSelectItem }
}

describe('useModelListKeyboardNav', () => {
  describe('ArrowDown / ArrowUp', () => {
    it('focuses the first item when nothing is focused yet on ArrowDown', () => {
      const { onFocusItem } = renderNav({ focusedItemKey: '' })

      dispatchKey('ArrowDown')

      expect(onFocusItem).toHaveBeenCalledWith('item-0')
    })

    it('advances focus by one on ArrowDown', () => {
      const { onFocusItem } = renderNav({ focusedItemKey: 'item-2' })

      dispatchKey('ArrowDown')

      expect(onFocusItem).toHaveBeenCalledWith('item-3')
    })

    it('wraps from the last item to the first on ArrowDown', () => {
      const { onFocusItem } = renderNav({ items: makeItems(3), focusedItemKey: 'item-2' })

      dispatchKey('ArrowDown')

      expect(onFocusItem).toHaveBeenCalledWith('item-0')
    })

    it('wraps from the first item to the last on ArrowUp', () => {
      const { onFocusItem } = renderNav({ items: makeItems(3), focusedItemKey: 'item-0' })

      dispatchKey('ArrowUp')

      expect(onFocusItem).toHaveBeenCalledWith('item-2')
    })
  })

  describe('PageDown / PageUp', () => {
    it('jumps by pageSize on PageDown and clamps at the last index (no wrap)', () => {
      const { onFocusItem } = renderNav({ items: makeItems(10), focusedItemKey: 'item-7', pageSize: 5 })

      dispatchKey('PageDown')

      expect(onFocusItem).toHaveBeenCalledWith('item-9')
    })

    it('jumps by pageSize on PageUp and clamps at zero (no wrap)', () => {
      const { onFocusItem } = renderNav({ items: makeItems(10), focusedItemKey: 'item-2', pageSize: 5 })

      dispatchKey('PageUp')

      expect(onFocusItem).toHaveBeenCalledWith('item-0')
    })
  })

  describe('Enter / Escape', () => {
    it('fires onSelectItem with the focused item on Enter', () => {
      const { onSelectItem } = renderNav({ items: makeItems(3), focusedItemKey: 'item-1' })

      dispatchKey('Enter')

      expect(onSelectItem).toHaveBeenCalledWith({ key: 'item-1' })
    })

    it('is a no-op on Enter when no item is focused', () => {
      const { onSelectItem } = renderNav({ focusedItemKey: '' })

      dispatchKey('Enter')

      expect(onSelectItem).not.toHaveBeenCalled()
    })

    it('fires onClose on Escape', () => {
      const { onClose } = renderNav()

      dispatchKey('Escape')

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('IME composing guard', () => {
    it('ignores every handler while event.isComposing is true', () => {
      const { onFocusItem, onSelectItem, onClose } = renderNav({ focusedItemKey: 'item-1' })

      dispatchKey('ArrowDown', { isComposing: true })
      dispatchKey('Enter', { isComposing: true })
      dispatchKey('Escape', { isComposing: true })

      expect(onFocusItem).not.toHaveBeenCalled()
      expect(onSelectItem).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('effect lifecycle', () => {
    it('does not attach the listener while open=false', () => {
      const { onFocusItem, onClose } = renderNav({ open: false, focusedItemKey: 'item-1' })

      dispatchKey('ArrowDown')
      dispatchKey('Escape')

      expect(onFocusItem).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('does not attach the listener while items is empty', () => {
      const { onFocusItem } = renderNav({ items: [], focusedItemKey: '' })

      dispatchKey('ArrowDown')

      expect(onFocusItem).not.toHaveBeenCalled()
    })

    it('ignores non-navigation keys (letters / numbers)', () => {
      const { onFocusItem, onSelectItem, onClose } = renderNav({ focusedItemKey: 'item-1' })

      dispatchKey('a')
      dispatchKey('1')

      expect(onFocusItem).not.toHaveBeenCalled()
      expect(onSelectItem).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })
  })
})
