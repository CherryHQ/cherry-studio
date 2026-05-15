import {
  composeResourceListGroupResolvers,
  createPinnedGroupResolver,
  createTimeGroupResolver,
  getResourceTimeBucket,
  type ResourceListGroup,
  type ResourceListGroupReorderPayload,
  type ResourceListGroupResolver,
  type ResourceListItemReorderPayload,
  type ResourceListTimeBucket,
  sortByResourceGroupRank
} from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { TopicDisplayMode as PreferenceTopicDisplayMode } from '@shared/data/preference/preferenceTypes'

export type TopicDisplayMode = PreferenceTopicDisplayMode

export type TopicListGroupKind = 'pinned' | 'time' | 'assistant' | 'unknown-assistant'

export type TopicDisplayAssistant = {
  id: string
  name: string
}

export type TopicDisplayGroupLabels = {
  pinned: string
  time: Record<ResourceListTimeBucket, string>
  assistant: {
    default: string
    unknown: string
  }
}

export type TopicDisplayGroupOptions = {
  assistantById?: ReadonlyMap<string, TopicDisplayAssistant>
  labels: TopicDisplayGroupLabels
  mode: TopicDisplayMode
  now?: Parameters<typeof getResourceTimeBucket>[1]
}

export type TopicDisplaySortOptions = {
  assistantRankById?: ReadonlyMap<string, number>
  mode: TopicDisplayMode
  now?: Parameters<typeof getResourceTimeBucket>[1]
}

export type TopicListItem = Topic & {
  name: string
  orderKey?: string
}

const TOPIC_TIME_BUCKET_RANK: Record<ResourceListTimeBucket, number> = {
  today: 1,
  yesterday: 2,
  'this-week': 3,
  earlier: 4
}

export const TOPIC_PINNED_GROUP_ID = 'topic:pinned'
export const TOPIC_TODAY_GROUP_ID = 'topic:time:today'
export const TOPIC_DEFAULT_ASSISTANT_GROUP_ID = 'topic:assistant:default'
export const TOPIC_UNKNOWN_ASSISTANT_GROUP_ID = 'topic:assistant:unknown'

const TOPIC_ASSISTANT_GROUP_ID_PREFIX = 'topic:assistant:'
const TOPIC_UNKNOWN_ASSISTANT_RANK = Number.MAX_SAFE_INTEGER

export function moveTopicAfterDrop<T extends { id: string }>(
  topics: readonly T[],
  payload: ResourceListItemReorderPayload
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

export function applyOptimisticTopicDisplayMove<T extends TopicListItem>(
  topics: readonly T[],
  payload: ResourceListItemReorderPayload,
  targetAssistantId: string | null,
  groupBy: ResourceListGroupResolver<T>
): T[] {
  const activeIndex = topics.findIndex((topic) => topic.id === payload.activeId)
  if (activeIndex < 0) return [...topics]

  const activeTopic = topics[activeIndex]
  const currentAssistantId = activeTopic.assistantId ?? null
  const movedTopic =
    currentAssistantId === targetAssistantId
      ? activeTopic
      : ({
          ...activeTopic,
          assistantId: targetAssistantId ?? undefined
        } as T)

  const next = topics.filter((topic) => topic.id !== payload.activeId)
  let insertIndex = next.length

  if (payload.overType === 'item') {
    const overIndex = next.findIndex((topic) => topic.id === payload.overId)
    if (overIndex >= 0) {
      insertIndex = payload.position === 'before' ? overIndex : overIndex + 1
    }
  } else {
    const lastTargetTopicIndex = next.findLastIndex((topic) => groupBy(topic)?.id === payload.targetGroupId)
    if (lastTargetTopicIndex >= 0) {
      insertIndex = lastTargetTopicIndex + 1
    }
  }

  next.splice(insertIndex, 0, movedTopic)
  return next
}

export function buildTopicDropAnchor(payload: ResourceListItemReorderPayload): OrderRequest {
  if (payload.overType === 'item') {
    return payload.position === 'before' ? { after: payload.overId } : { before: payload.overId }
  }

  return { position: 'last' }
}

export function buildAssistantGroupDropAnchor(
  payload: ResourceListGroupReorderPayload,
  overAssistantId: string
): OrderRequest {
  return payload.sourceIndex < payload.targetIndex ? { after: overAssistantId } : { before: overAssistantId }
}

export function moveAssistantGroupAfterDrop(
  assistantIds: readonly string[],
  activeAssistantId: string,
  overAssistantId: string,
  payload: Pick<ResourceListGroupReorderPayload, 'sourceIndex' | 'targetIndex'>
): string[] {
  const activeIndex = assistantIds.indexOf(activeAssistantId)
  const overIndex = assistantIds.indexOf(overAssistantId)

  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return [...assistantIds]
  }

  const next = assistantIds.filter((assistantId) => assistantId !== activeAssistantId)
  const adjustedOverIndex = next.indexOf(overAssistantId)
  const insertIndex = payload.sourceIndex < payload.targetIndex ? adjustedOverIndex + 1 : adjustedOverIndex
  next.splice(insertIndex, 0, activeAssistantId)

  return next
}

export function normalizeTopicDropPayload(payload: ResourceListItemReorderPayload): ResourceListItemReorderPayload {
  return payload
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

export function getTopicAssistantGroupId(assistantId: string) {
  return `${TOPIC_ASSISTANT_GROUP_ID_PREFIX}${assistantId}`
}

export function getAssistantIdFromTopicGroupId(groupId: string): string | undefined {
  if (
    groupId === TOPIC_DEFAULT_ASSISTANT_GROUP_ID ||
    groupId === TOPIC_UNKNOWN_ASSISTANT_GROUP_ID ||
    !groupId.startsWith(TOPIC_ASSISTANT_GROUP_ID_PREFIX)
  ) {
    return undefined
  }

  return groupId.slice(TOPIC_ASSISTANT_GROUP_ID_PREFIX.length)
}

export function createTopicDisplayGroupResolver<T extends Pick<Topic, 'assistantId' | 'pinned' | 'updatedAt'>>({
  assistantById,
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

  return withTopicGroupIdPrefix(
    composeResourceListGroupResolvers(pinnedResolver, (topic) => {
      const assistantId = topic.assistantId

      if (!assistantId) {
        return { id: 'assistant:default', label: labels.assistant.default }
      }

      const assistant = assistantById?.get(assistantId)
      if (assistant) {
        return { id: `assistant:${assistant.id}`, label: assistant.name }
      }

      return { id: 'assistant:unknown', label: labels.assistant.unknown }
    })
  )
}

function getAssistantGroupRank<T extends Pick<Topic, 'assistantId' | 'pinned'>>(
  topic: T,
  assistantRankById?: ReadonlyMap<string, number>
) {
  if (topic.pinned === true) {
    return 0
  }

  const assistantRank = topic.assistantId ? assistantRankById?.get(topic.assistantId) : undefined
  if (assistantRank !== undefined) {
    return assistantRank + 1
  }

  if (!topic.assistantId) {
    return TOPIC_UNKNOWN_ASSISTANT_RANK - 1
  }

  return TOPIC_UNKNOWN_ASSISTANT_RANK
}

export function sortTopicsForDisplayGroups<T extends Pick<Topic, 'assistantId' | 'pinned' | 'updatedAt'>>(
  topics: readonly T[],
  options: TopicDisplaySortOptions
): T[] {
  if (options.mode === 'assistant') {
    return topics
      .map((topic, index) => ({
        topic,
        index,
        rank: getAssistantGroupRank(topic, options.assistantRankById),
        orderKey: 'orderKey' in topic && typeof topic.orderKey === 'string' ? topic.orderKey : undefined
      }))
      .sort((a, b) => {
        const groupDelta = a.rank - b.rank
        if (groupDelta !== 0) return groupDelta

        if (a.topic.pinned === true || b.topic.pinned === true) {
          return a.index - b.index
        }

        if (a.orderKey && b.orderKey) {
          const orderDelta = a.orderKey.localeCompare(b.orderKey)
          if (orderDelta !== 0) return -orderDelta
        }

        return a.index - b.index
      })
      .map(({ topic }) => topic)
  }

  return sortByResourceGroupRank(topics, (topic) => {
    if (topic.pinned === true) {
      return 0
    }

    return TOPIC_TIME_BUCKET_RANK[getTopicTimeBucket(topic.updatedAt, options.now)]
  })
}
