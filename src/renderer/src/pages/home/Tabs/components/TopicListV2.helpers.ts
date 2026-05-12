import type { ResourceListReorderPayload } from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'

export type TopicOrderMove = {
  id: string
  anchor: OrderRequest
}

export type TopicListItem = Topic & {
  name: string
}

export function buildTopicOrderMoves(currentIds: readonly string[], reorderedIds: readonly string[]): TopicOrderMove[] {
  const moves: TopicOrderMove[] = []

  for (let index = 0; index < reorderedIds.length; index++) {
    if (currentIds[index] === reorderedIds[index]) continue

    moves.push({
      id: reorderedIds[index],
      anchor: index === 0 ? { position: 'first' } : { after: reorderedIds[index - 1] }
    })
  }

  return moves
}

export function moveTopicAfterDrop<T extends { id: string }>(
  topics: readonly T[],
  payload: ResourceListReorderPayload
): T[] {
  const activeIndex = topics.findIndex((topic) => topic.id === payload.activeId)
  const overIndex = topics.findIndex((topic) => topic.id === payload.overId)

  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return [...topics]
  }

  const next = [...topics]
  const [movedTopic] = next.splice(activeIndex, 1)
  const adjustedOverIndex = next.findIndex((topic) => topic.id === payload.overId)
  const insertIndex = payload.position === 'before' ? adjustedOverIndex : adjustedOverIndex + 1
  next.splice(insertIndex, 0, movedTopic)

  return next
}

export function filterTopicsForManageMode<T extends TopicListItem>(
  topics: readonly T[],
  searchText: string,
  isManageMode: boolean
): T[] {
  if (!isManageMode || !searchText.trim()) {
    return [...topics]
  }

  const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)

  if (keywords.length === 0) {
    return [...topics]
  }

  return topics.filter((topic) => {
    const lowerName = topic.name.toLowerCase()
    return keywords.every((keyword) => lowerName.includes(keyword))
  })
}

export function groupTopicByPinned(topic: Pick<Topic, 'pinned'>, pinnedLabel: string, topicLabel: string) {
  if (topic.pinned) {
    return { id: 'pinned', label: pinnedLabel }
  }

  return { id: 'topics', label: topicLabel }
}
