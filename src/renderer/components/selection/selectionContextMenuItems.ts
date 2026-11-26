import type { CommandContextMenuExtraItem } from '@renderer/components/command'

type ResolveItems = () => CommandContextMenuExtraItem[]

const itemsByElement = new WeakMap<HTMLElement, ResolveItems>()

export function bindSelectionContextMenuItems(element: HTMLElement, resolveItems: ResolveItems) {
  itemsByElement.set(element, resolveItems)
  return () => {
    itemsByElement.delete(element)
  }
}

export function getSelectionContextMenuItems(target: Element | null, boundary: Element): CommandContextMenuExtraItem[] {
  for (let element = target; element && element !== boundary; element = element.parentElement) {
    const resolveItems = element instanceof HTMLElement && itemsByElement.get(element)
    if (resolveItems) return resolveItems()
  }
  return []
}
