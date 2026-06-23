import {
  buildResourceListGroupDropAnchor,
  buildResourceListItemDropAnchor,
  compareResourceOrderKey,
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
  withResourceListGroupIdPrefix
} from '@renderer/components/chat/resources'
import type { Topic } from '@renderer/types'
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
  defaultAssistant?: Pick<TopicDisplayAssistant, 'name'>
  labels: TopicDisplayGroupLabels
  mode: TopicDisplayMode
  now?: Parameters<typeof getResourceTimeBucket>[1]
  pinnedAsSection?: boolean
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
export const TOPIC_PINNED_SECTION_ID = 'topic:section:pinned'
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
  updatedAt: string,
  now?: Parameters<typeof getResourceTimeBucket>[1]
): ResourceListTimeBucket {
  return getResourceTimeBucket(updatedAt, now)
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

export function createTopicDisplayGroupResolver<T extends Pick<Topic, 'assistantId' | 'pinned' | 'updatedAt'>>({
  assistantById,
  defaultAssistant,
  labels,
  mode,
  now,
  pinnedAsSection = false
}: TopicDisplayGroupOptions): ResourceListGroupResolver<T> {
  const pinnedResolver = createPinnedGroupResolver<T>({
    isPinned: (topic) => topic.pinned === true,
    group: { id: 'pinned', label: mode === 'time' || !pinnedAsSection ? labels.pinned : '' } satisfies ResourceListGroup
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
        return { id: 'assistant:unknown', label: defaultAssistant?.name || labels.assistant.unlinked }
      }

      const assistant = assistantById?.get(assistantId)
      if (assistant) {
        return { id: `assistant:${assistant.id}`, label: assistant.name }
      }

      return { id: 'assistant:unknown', label: labels.assistant.unlinked }
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

  return TOPIC_UNLINKED_ASSISTANT_RANK
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

        const orderDelta = compareResourceOrderKey(a.orderKey, b.orderKey)
        if (orderDelta !== 0) return orderDelta

        return a.index - b.index
      })
      .map(({ topic }) => topic)
  }

  return topics
    .map((topic, index) => ({
      topic,
      index,
      rank: topic.pinned === true ? 0 : TOPIC_TIME_BUCKET_RANK[getTopicTimeBucket(topic.updatedAt, options.now)],
      updatedAtMs: Date.parse(topic.updatedAt)
    }))
    .sort((a, b) => {
      const groupDelta = a.rank - b.rank
      if (groupDelta !== 0) return groupDelta

      if (a.topic.pinned === true || b.topic.pinned === true) {
        return a.index - b.index
      }

      if (Number.isFinite(a.updatedAtMs) && Number.isFinite(b.updatedAtMs)) {
        const updatedAtDelta = b.updatedAtMs - a.updatedAtMs
        if (updatedAtDelta !== 0) return updatedAtDelta
      }

      return a.index - b.index
    })
    .map(({ topic }) => topic)
}
