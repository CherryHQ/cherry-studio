import type { ResourceListGroupReorderPayload, ResourceListItemReorderPayload } from './ResourceList'

export type ResourceListOrderAnchor = { before: string } | { after: string } | { position: 'last' }

export function compareResourceOrderKey(a?: string, b?: string) {
  if (a && b) {
    if (a < b) return -1
    if (a > b) return 1
  }

  return 0
}

export function buildResourceListItemDropAnchor(payload: ResourceListItemReorderPayload): ResourceListOrderAnchor {
  if (payload.overType === 'item') {
    return payload.position === 'before' ? { before: payload.overId } : { after: payload.overId }
  }

  return { position: 'last' }
}

export function buildResourceListGroupDropAnchor(
  payload: Pick<ResourceListGroupReorderPayload, 'sourceIndex' | 'targetIndex'>,
  overId: string
): ResourceListOrderAnchor {
  return payload.sourceIndex < payload.targetIndex ? { after: overId } : { before: overId }
}

export function moveResourceListStringGroupAfterDrop(
  ids: readonly string[],
  activeId: string,
  overId: string,
  payload: Pick<ResourceListGroupReorderPayload, 'sourceIndex' | 'targetIndex'>
): string[] {
  const activeIndex = ids.indexOf(activeId)
  const overIndex = ids.indexOf(overId)

  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return [...ids]
  }

  const next = ids.filter((id) => id !== activeId)
  const adjustedOverIndex = next.indexOf(overId)
  const insertIndex = payload.sourceIndex < payload.targetIndex ? adjustedOverIndex + 1 : adjustedOverIndex
  next.splice(insertIndex, 0, activeId)

  return next
}
