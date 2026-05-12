import {
  composeResourceListGroupResolvers,
  createPinnedGroupResolver,
  createTimeGroupResolver,
  getResourceTimeBucket,
  type ResourceListGroup,
  type ResourceListGroupResolver,
  type ResourceListReorderPayload,
  type ResourceListTimeBucket,
  sortByResourceGroupRank
} from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'

export type TopicDisplayMode = 'time' | 'assistant' | 'tag'

export type TopicListGroupKind = 'pinned' | 'time' | 'assistant' | 'tag' | 'untagged' | 'unassigned'

export type TopicDisplayGroupLabels = {
  pinned: string
  time: Record<ResourceListTimeBucket, string>
}

export type TopicDisplayGroupOptions = {
  labels: TopicDisplayGroupLabels
  mode: TopicDisplayMode
  now?: Parameters<typeof getResourceTimeBucket>[1]
}

export type TopicOrderMove = {
  id: string
  anchor: OrderRequest
}

export type TopicListItem = Topic & {
  name: string
}

const TOPIC_TIME_BUCKET_RANK: Record<ResourceListTimeBucket, number> = {
  today: 1,
  yesterday: 2,
  'this-week': 3,
  earlier: 4
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

export function getTopicTimeBucket(
  updatedAt: string,
  now?: Parameters<typeof getResourceTimeBucket>[1]
): ResourceListTimeBucket {
  return getResourceTimeBucket(updatedAt, now)
}

function withTopicGroupIdPrefix<T>(resolver: ResourceListGroupResolver<T>): ResourceListGroupResolver<T> {
  return (item) => {
    const group = resolver(item)
    if (!group) return null
    return { ...group, id: `topic:${group.id}` }
  }
}

export function createTopicDisplayGroupResolver<T extends Pick<Topic, 'pinned' | 'updatedAt'>>({
  labels,
  mode,
  now
}: TopicDisplayGroupOptions): ResourceListGroupResolver<T> {
  const pinnedResolver = createPinnedGroupResolver<T>({
    isPinned: (topic) => topic.pinned === true,
    group: { id: 'pinned', label: labels.pinned } satisfies ResourceListGroup
  })

  if (mode === 'time') {
    return withTopicGroupIdPrefix(
      composeResourceListGroupResolvers(
        pinnedResolver,
        createTimeGroupResolver<T>({
          getTimestamp: (topic) => topic.updatedAt,
          labels: labels.time,
          now
        })
      )
    )
  }

  return withTopicGroupIdPrefix(pinnedResolver)
}

export function sortTopicsForDisplayGroups<T extends Pick<Topic, 'pinned' | 'updatedAt'>>(
  topics: readonly T[],
  now?: Parameters<typeof getResourceTimeBucket>[1]
): T[] {
  return sortByResourceGroupRank(topics, (topic) => {
    if (topic.pinned === true) {
      return 0
    }

    return TOPIC_TIME_BUCKET_RANK[getTopicTimeBucket(topic.updatedAt, now)]
  })
}
