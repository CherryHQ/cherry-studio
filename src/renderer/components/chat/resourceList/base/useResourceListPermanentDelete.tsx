import type { RefObject } from 'react'

import type { ResourceListItemBase } from './ResourceListContext'
import { useResourceListItemCommand } from './useResourceListItemCommand'

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
}: ResourceListPermanentDeleteProps<T>): RefObject<HTMLSpanElement | null> {
  return useResourceListItemCommand('resource.delete_permanently', { isItemEligible, onItemCommand: onDelete })
}

export function ResourceListPermanentDelete<T extends ResourceListItemBase>(
  props: ResourceListPermanentDeleteProps<T>
) {
  const markerRef = useResourceListPermanentDelete(props)
  return <span ref={markerRef} hidden data-resource-list-permanent-delete="" />
}
