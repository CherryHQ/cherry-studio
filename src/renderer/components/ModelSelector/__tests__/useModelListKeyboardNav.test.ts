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

function renderNav({
  open = true,
  items = makeItems(5),
  focusedItemKey = '',
  pageSize
}: {
  open?: boolean
  items?: Item[]
  focusedItemKey?: string
  pageSize?: number
} = {}) {
  const onClose = vi.fn()
  const onFocusItem = vi.fn()
  const onSelectItem = vi.fn()

  const hook = renderHook(() =>
    useModelListKeyboardNav({
      open,
      focusedItemKey,
      items,
      onClose,
      onFocusItem,
      onSelectItem,
      pageSize
    })
  )

  return { onClose, onFocusItem, onSelectItem, unmount: hook.unmount }
}

describe('useModelListKeyboardNav', () => {
  it('starts at the first item and wraps in both directions', () => {
    const initial = renderNav()
    dispatchKey('ArrowDown')
    expect(initial.onFocusItem).toHaveBeenCalledWith('item-0')
    initial.unmount()

    const down = renderNav({ items: makeItems(3), focusedItemKey: 'item-2' })
    dispatchKey('ArrowDown')
    expect(down.onFocusItem).toHaveBeenCalledWith('item-0')
    down.unmount()

    const up = renderNav({ items: makeItems(3), focusedItemKey: 'item-0' })
    dispatchKey('ArrowUp')
    expect(up.onFocusItem).toHaveBeenCalledWith('item-2')
  })

  it('clamps page navigation at the list boundaries', () => {
    const down = renderNav({ items: makeItems(10), focusedItemKey: 'item-7', pageSize: 5 })
    dispatchKey('PageDown')
    expect(down.onFocusItem).toHaveBeenCalledWith('item-9')
    down.unmount()

    const up = renderNav({ items: makeItems(10), focusedItemKey: 'item-2', pageSize: 5 })
    dispatchKey('PageUp')
    expect(up.onFocusItem).toHaveBeenCalledWith('item-0')
  })

  it('selects the focused item on Enter', () => {
    const { onSelectItem } = renderNav({ items: makeItems(3), focusedItemKey: 'item-1' })

    dispatchKey('Enter')

    expect(onSelectItem).toHaveBeenCalledWith({ key: 'item-1' })
  })

  it('does not treat Enter on a button as list selection', () => {
    const button = document.body.appendChild(document.createElement('button'))
    const { onSelectItem } = renderNav({ items: makeItems(3), focusedItemKey: 'item-1' })

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(onSelectItem).not.toHaveBeenCalled()
    button.remove()
  })

  it('still selects the focused item when Enter comes from the search input', () => {
    const input = document.body.appendChild(document.createElement('input'))
    const { onSelectItem } = renderNav({ items: makeItems(3), focusedItemKey: 'item-1' })

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(onSelectItem).toHaveBeenCalledWith({ key: 'item-1' })
    input.remove()
  })

  it('closes on Escape', () => {
    const { onClose } = renderNav()

    dispatchKey('Escape')

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores navigation keys while an IME composition is active', () => {
    const { onClose, onFocusItem, onSelectItem } = renderNav({ focusedItemKey: 'item-1' })

    dispatchKey('ArrowDown', { isComposing: true })
    dispatchKey('Enter', { isComposing: true })
    dispatchKey('Escape', { isComposing: true })

    expect(onFocusItem).not.toHaveBeenCalled()
    expect(onSelectItem).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'closed', open: false, items: makeItems(3) },
    { name: 'empty', open: true, items: [] }
  ])('does not attach a listener when the selector is $name', ({ open, items }) => {
    const { onClose, onFocusItem } = renderNav({ open, items })

    dispatchKey('ArrowDown')
    dispatchKey('Escape')

    expect(onFocusItem).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
