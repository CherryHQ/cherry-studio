import type {
  ResourceListGroupReorderPayload,
  ResourceListItemReorderPayload
} from '@renderer/utils/chat/resourceListBase'

export function createResourceListItemReorderPayload(
  overrides: Partial<ResourceListItemReorderPayload> = {}
): ResourceListItemReorderPayload {
  return {
    type: 'item',
    activeId: 'a',
    overId: 'b',
    position: 'before',
    overType: 'item',
    sourceGroupId: 'group-a',
    targetGroupId: 'group-a',
    sourceIndex: 0,
    targetIndex: 1,
    ...overrides
  }
}

export function createResourceListGroupReorderPayload(
  overrides: Partial<ResourceListGroupReorderPayload> = {}
): ResourceListGroupReorderPayload {
  return {
    type: 'group',
    activeGroupId: 'group-a',
    overGroupId: 'group-b',
    overType: 'group',
    sourceIndex: 0,
    targetIndex: 1,
    ...overrides
  }
}
