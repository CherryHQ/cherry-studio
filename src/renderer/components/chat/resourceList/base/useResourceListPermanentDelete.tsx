import { useRef } from 'react'

import { useCommandHandler } from '@renderer/hooks/command'
import { canRunFocusedResourceCommand, isElementSuppressed } from '@renderer/utils/commandFocus'

import {
  getResourceListOptionDomId,
  type ResourceListItemBase,
  useResourceListItemAccessors,
  useResourceListUiStore,
  useResourceListView
} from './ResourceListContext'

export interface ResourceListPermanentDeleteProps<T extends ResourceListItemBase> {
  /**
   * Return false for pinned, busy, builtin, or otherwise protected rows.
   * Omitted means every focused visible row is eligible.
   */
  isItemEligible?: (item: T) => boolean
  /**
   * Show the shared irreversible confirmation and delete this row.
   * The shortcut stays suppressed until the returned promise settles.
   */
  onDelete: (item: T) => void | Promise<void>
}

/**
 * Registers `resource.delete_permanently` for one list.
 *
 * Mount one inside `ResourceList.Frame` under `ResourceList.Provider`. The target is the
 * focused visible row: a focused `role="option"` (or its non-editable descendant) wins, and
 * listbox focus uses `aria-activedescendant`. The selected conversation is not a fallback.
 * Eligibility is read when the key is pressed, so a hidden, blurred, renaming, modal, editable,
 * or protected row does not consume CommandOrControl+Backspace. Confirm and delete in
 * `onDelete`. Menus should show `useResolvedCommand('resource.delete_permanently').shortcutLabel`.
 */
export function useResourceListPermanentDelete<T extends ResourceListItemBase>({
  isItemEligible,
  onDelete
}: ResourceListPermanentDeleteProps<T>) {
  const markerRef = useRef<HTMLSpanElement>(null)
  const pendingRef = useRef(false)
  const onDeleteRef = useRef(onDelete)
  const isItemEligibleRef = useRef(isItemEligible)
  const view = useResourceListView<T>()
  const viewRef = useRef(view)
  const accessors = useResourceListItemAccessors<T>()
  const store = useResourceListUiStore()
  onDeleteRef.current = onDelete
  isItemEligibleRef.current = isItemEligible
  viewRef.current = view

  const readFocusedItem = (): T | null => {
    if (pendingRef.current) return null

    const marker = markerRef.current
    const frame = marker?.closest('[data-resource-list-variant]')
    const listbox = frame?.querySelector('[role="listbox"]')
    if (!(listbox instanceof HTMLElement) || !canRunFocusedResourceCommand(listbox)) return null

    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return null

    const snapshot = store.getUiSnapshot()
    if (snapshot.renamingId) return null

    const visibleItems = viewRef.current.visibleItems
    const option = active === listbox ? null : active.closest('[role="option"]')
    let domId: string | null = null
    if (option instanceof HTMLElement && listbox.contains(option)) {
      if (isElementSuppressed(option) || !option.id) return null
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
    'resource.delete_permanently',
    () => {
      if (pendingRef.current) return
      const item = readFocusedItemRef.current()
      if (!item) return
      pendingRef.current = true
      try {
        return Promise.resolve(onDeleteRef.current(item)).finally(() => {
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

export function ResourceListPermanentDelete<T extends ResourceListItemBase>(
  props: ResourceListPermanentDeleteProps<T>
) {
  const markerRef = useResourceListPermanentDelete(props)
  return <span ref={markerRef} hidden data-resource-list-permanent-delete="" />
}
