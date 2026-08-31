import type { Topic } from '@renderer/types/topic'
import {
  buildResourceListGroupDropAnchor,
  buildResourceListItemDropAnchor,
  compareResourceOrderKey,
  compareResourceRecency,
  composeResourceListGroupResolvers,
  createPinnedGroupResolver,
  createTimeGroupResolver,
  getResourceTimeBucket,
  moveResourceListStringGroupAfterDrop,
  type ResourceListGroup,
  type ResourceListGroupReorderPayload,
  type ResourceListGroupResolver,
  type ResourceListItemReorderPayload,
  type ResourceListTimeBucket,
  sortRankedResourceItems,
  withResourceListGroupIdPrefix
} from '@renderer/utils/chat/resourceListBase'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { TopicDisplayMode as PreferenceTopicDisplayMode } from '@shared/data/preference/preferenceTypes'

export type TopicDisplayMode = PreferenceTopicDisplayMode

export type TopicListGroupKind = 'pinned' | 'time' | 'assistant' | 'unlinked-assistant'

export type TopicDisplayAssistant = {
  id: string
  name: string
  orderKey?: string
}

export type TopicDisplayGroupLabels = {
  pinned: string
  time: Record<ResourceListTimeBucket, string>
  assistant: {
    unlinked: string
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
export const TOPIC_ASSISTANT_SECTION_ID = 'topic:section:assistant'
export const TOPIC_UNLINKED_ASSISTANT_GROUP_ID = 'topic:assistant:unknown'

const TOPIC_ASSISTANT_GROUP_ID_PREFIX = 'topic:assistant:'
const TOPIC_UNLINKED_ASSISTANT_RANK = Number.MAX_SAFE_INTEGER

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
  return buildResourceListItemDropAnchor(payload)
}

export function buildAssistantGroupDropAnchor(
  payload: ResourceListGroupReorderPayload,
  overAssistantId: string
): OrderRequest {
  return buildResourceListGroupDropAnchor(payload, overAssistantId)
}

export function moveAssistantGroupAfterDrop(
  assistantIds: readonly string[],
  activeAssistantId: string,
  overAssistantId: string,
  payload: Pick<ResourceListGroupReorderPayload, 'sourceIndex' | 'targetIndex'>
): string[] {
  return moveResourceListStringGroupAfterDrop(assistantIds, activeAssistantId, overAssistantId, payload)
}

export function normalizeTopicDropPayload(payload: ResourceListItemReorderPayload): ResourceListItemReorderPayload {
  return payload
}

export function groupTopicByPinned(topic: Pick<Topic, 'pinned'>, pinnedLabel: string, topicLabel: string) {
  if (topic.pinned) {
    return { id: 'pinned', label: pinnedLabel }
  }

  return { id: 'topics', label: topicLabel }
}

export function getTopicTimeBucket(
  lastActivityAt: string,
  now?: Parameters<typeof getResourceTimeBucket>[1]
): ResourceListTimeBucket {
  return getResourceTimeBucket(lastActivityAt, now)
}

function withTopicGroupIdPrefix<T>(resolver: ResourceListGroupResolver<T>): ResourceListGroupResolver<T> {
  return withResourceListGroupIdPrefix('topic:', resolver)
}

export function getAssistantIdFromTopicGroupId(groupId: string): string | undefined {
  if (groupId === TOPIC_UNLINKED_ASSISTANT_GROUP_ID || !groupId.startsWith(TOPIC_ASSISTANT_GROUP_ID_PREFIX)) {
    return undefined
  }

  return groupId.slice(TOPIC_ASSISTANT_GROUP_ID_PREFIX.length)
}

export function getTopicAssistantGroupId(assistantId: string): string {
  return `${TOPIC_ASSISTANT_GROUP_ID_PREFIX}${assistantId}`
}

export function getTopicAssistantDisplayGroupId(topic: { assistantId?: string | null }): string {
  return topic.assistantId ? getTopicAssistantGroupId(topic.assistantId) : TOPIC_UNLINKED_ASSISTANT_GROUP_ID
}

export function createTopicDisplayGroupResolver<T extends Pick<Topic, 'assistantId' | 'lastActivityAt' | 'pinned'>>({
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
          getTimestamp: (topic) => topic.lastActivityAt,
          labels: labels.time,
          now
        })
      )
    )
  }

  return withTopicGroupIdPrefix((topic) => {
    const assistantId = topic.assistantId

    if (!assistantId) {
      return { id: 'assistant:unknown', label: labels.assistant.unlinked }
    }

    const assistant = assistantById?.get(assistantId)
    if (assistant) {
      return { id: `assistant:${assistant.id}`, label: assistant.name }
    }

    return { id: 'assistant:unknown', label: labels.assistant.unlinked }
  })
}

function getAssistantGroupRank<T extends Pick<Topic, 'assistantId'>>(
  topic: T,
  assistantRankById?: ReadonlyMap<string, number>
) {
  const assistantRank = topic.assistantId ? assistantRankById?.get(topic.assistantId) : undefined
  if (assistantRank !== undefined) {
    return assistantRank
  }

  return TOPIC_UNLINKED_ASSISTANT_RANK
}

function readOptionalOrderKey<T extends object>(item: T): string | undefined {
  return 'orderKey' in item && typeof item.orderKey === 'string' ? item.orderKey : undefined
}

export function sortTopicsForDisplayGroups<T extends Pick<Topic, 'assistantId' | 'lastActivityAt' | 'pinned'>>(
  topics: readonly T[],
  options: TopicDisplaySortOptions
): T[] {
  const isPinned = (topic: T) => topic.pinned === true

  if (options.mode === 'assistant') {
    return topics
      .map((topic, index) => ({ topic, index, rank: getAssistantGroupRank(topic, options.assistantRankById) }))
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank
        if (a.topic.pinned !== b.topic.pinned) return a.topic.pinned ? -1 : 1
        if (a.topic.pinned && b.topic.pinned) return a.index - b.index
        return (
          compareResourceOrderKey(readOptionalOrderKey(a.topic), readOptionalOrderKey(b.topic)) || a.index - b.index
        )
      })
      .map(({ topic }) => topic)
  }

  return sortRankedResourceItems(topics, {
    getRank: (topic) =>
      topic.pinned === true ? 0 : TOPIC_TIME_BUCKET_RANK[getTopicTimeBucket(topic.lastActivityAt, options.now)],
    isPinned,
    compareWithinGroup: compareResourceRecency((topic) => topic.lastActivityAt)
  })
}
