import type { RefObject } from 'react'

import type { ResourceListItemBase } from './ResourceListContext'
import { useResourceListItemCommand } from './useResourceListItemCommand'

export interface ResourceListArchiveProps<T extends ResourceListItemBase> {
  /** Return false for pinned, busy, or otherwise protected rows. Omitted means every focused visible row is eligible. */
  isItemEligible?: (item: T) => boolean
  /** Move this row to the trash. The shortcut stays suppressed until the returned promise settles. */
  onArchive: (item: T) => void | Promise<void>
}

/**
 * Registers `topic.delete` for one list inside `ResourceList.Frame` under `ResourceList.Provider`.
 * The target is the focused visible row, never the selected conversation.
 * Focus in the composer or inline rename is skipped; `when` is `resource.focused && !input.focused`.
 * Menus should show `useResolvedCommand('topic.delete').shortcutLabel`.
 */
export function useResourceListArchive<T extends ResourceListItemBase>({
  isItemEligible,
  onArchive
}: ResourceListArchiveProps<T>): RefObject<HTMLSpanElement | null> {
  return useResourceListItemCommand('topic.delete', { isItemEligible, onItemCommand: onArchive })
}

export function ResourceListArchive<T extends ResourceListItemBase>(props: ResourceListArchiveProps<T>) {
  const markerRef = useResourceListArchive(props)
  return <span ref={markerRef} hidden data-resource-list-archive="" />
}
