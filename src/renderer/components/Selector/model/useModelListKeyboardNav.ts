import { useEffect } from 'react'

interface KeyboardNavigableItem {
  key: string
}

interface UseModelListKeyboardNavOptions<TItem extends KeyboardNavigableItem> {
  open: boolean
  focusedItemKey: string
  items: TItem[]
  onClose: () => void
  onFocusItem: (key: string) => void
  onSelectItem: (item: TItem) => void
  pageSize?: number
}

export function useModelListKeyboardNav<TItem extends KeyboardNavigableItem>({
  open,
  focusedItemKey,
  items,
  onClose,
  onFocusItem,
  onSelectItem,
  pageSize = 12
}: UseModelListKeyboardNavOptions<TItem>) {
  useEffect(() => {
    if (!open || items.length === 0) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) {
        return
      }

      if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'Escape'].includes(event.key)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const currentIndex = items.findIndex((item) => item.key === focusedItemKey)
      let nextIndex = -1

      switch (event.key) {
        case 'ArrowUp':
          nextIndex = (currentIndex < 0 ? 0 : currentIndex - 1 + items.length) % items.length
          break
        case 'ArrowDown':
          nextIndex = (currentIndex < 0 ? 0 : currentIndex + 1) % items.length
          break
        case 'PageUp':
          nextIndex = Math.max(0, (currentIndex < 0 ? 0 : currentIndex) - pageSize)
          break
        case 'PageDown':
          nextIndex = Math.min(items.length - 1, (currentIndex < 0 ? 0 : currentIndex) + pageSize)
          break
        case 'Enter':
          if (currentIndex >= 0) {
            onSelectItem(items[currentIndex])
          }
          return
        case 'Escape':
          onClose()
          return
      }

      const nextItem = items[nextIndex]
      if (nextItem) {
        onFocusItem(nextItem.key)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedItemKey, items, onClose, onFocusItem, onSelectItem, open, pageSize])
}
