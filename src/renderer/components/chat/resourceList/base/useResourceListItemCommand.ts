import type { RefObject } from 'react'
import { useRef } from 'react'

import { useCommandHandler } from '@renderer/hooks/command'
import type { CommandId } from '@shared/utils/command'

import {
  getResourceListOptionDomId,
  type ResourceListItemBase,
  useResourceListItemAccessors,
  useResourceListUiStore,
  useResourceListView
} from './ResourceListContext'

export interface ResourceListItemCommandProps<T extends ResourceListItemBase> {
  isItemEligible?: (item: T) => boolean
  onItemCommand: (item: T) => void | Promise<void>
}

/** Registers a command for the focused visible row in one list, without falling back to the selected conversation. */
export function useResourceListItemCommand<T extends ResourceListItemBase>(
  command: CommandId,
  { isItemEligible, onItemCommand }: ResourceListItemCommandProps<T>
): RefObject<HTMLSpanElement | null> {
  const markerRef = useRef<HTMLSpanElement>(null)
  const pendingRef = useRef(false)
  const onItemCommandRef = useRef(onItemCommand)
  const isItemEligibleRef = useRef(isItemEligible)
  const view = useResourceListView<T>()
  const viewRef = useRef(view)
  const accessors = useResourceListItemAccessors<T>()
  const store = useResourceListUiStore()
  onItemCommandRef.current = onItemCommand
  isItemEligibleRef.current = isItemEligible
  viewRef.current = view

  const readFocusedItem = (): T | null => {
    if (pendingRef.current) return null

    const marker = markerRef.current
    const frame = marker?.closest('[data-resource-list-variant]')
    const listbox = frame?.querySelector('[role="listbox"]')
    if (!(listbox instanceof HTMLElement)) return null

    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return null

    const snapshot = store.getUiSnapshot()
    if (snapshot.renamingId) return null

    const visibleItems = viewRef.current.visibleItems
    const option = active === listbox ? null : active.closest('[role="option"]')
    let domId: string | null = null
    if (option instanceof HTMLElement && listbox.contains(option)) {
      if (!option.id) return null
      domId = option.id
    } else if (active === listbox) {
      domId = listbox.getAttribute('aria-activedescendant')
    } else {
      return null
    }

    // A present descendant id that misses the visible rows is no target. activeId applies only before that attribute exists.
    const item = domId
      ? visibleItems.find((candidate) => getResourceListOptionDomId(accessors.getItemId(candidate)) === domId)
      : visibleItems.find((candidate) => accessors.getItemId(candidate) === snapshot.activeId)
    if (!item || (isItemEligibleRef.current && !isItemEligibleRef.current(item))) return null
    return item
  }

  const readFocusedItemRef = useRef(readFocusedItem)
  readFocusedItemRef.current = readFocusedItem

  useCommandHandler(
    command,
    () => {
      if (pendingRef.current) return
      const item = readFocusedItemRef.current()
      if (!item) return
      pendingRef.current = true
      try {
        return Promise.resolve(onItemCommandRef.current(item)).finally(() => {
          pendingRef.current = false
        })
      } catch (error) {
        pendingRef.current = false
        throw error
      }
    },
    { enabled: () => readFocusedItemRef.current() !== null }
  )

  return markerRef
}
