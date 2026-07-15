import type { Topic } from '@renderer/types/topic'
import {
  buildResourceListGroupDropAnchor,
  buildResourceListItemDropAnchor,
  compareResourceCreationOrder,
  compareResourceIds,
  compareResourceOrderKey,
  compareResourceUpdatedOrder,
  composeResourceListGroupResolvers,
  createPinnedGroupResolver,
  moveResourceListStringGroupAfterDrop,
  type ResourceListGroup,
  type ResourceListGroupReorderPayload,
  type ResourceListGroupResolver,
  type ResourceListItemReorderPayload,
  sortRankedResourceItems
} from '@renderer/utils/chat/resourceListBase'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  TopicDisplayMode as PreferenceTopicDisplayMode,
  TopicSessionSortBy
} from '@shared/data/preference/preferenceTypes'

export type TopicDisplayMode = PreferenceTopicDisplayMode

export type TopicDisplayAssistant = {
  id: string
  name: string
  orderKey?: string
}

export type TopicDisplayGroupLabels = {
  pinned: string
  assistant: {
    unlinked: string
  }
}

export type TopicDisplayGroupOptions = {
  assistantById?: ReadonlyMap<string, TopicDisplayAssistant>
  defaultAssistant?: Pick<TopicDisplayAssistant, 'name'>
  labels: TopicDisplayGroupLabels
  mode: TopicDisplayMode
  pinnedAsSection?: boolean
}

export type TopicDisplaySortOptions = {
  assistantRankById?: ReadonlyMap<string, number>
  mode: TopicDisplayMode
  sortBy: TopicSessionSortBy
}

export type TopicListItem = Topic & {
  name: string
  orderKey?: string
}

export const TOPIC_PINNED_GROUP_ID = 'topic:pinned'
export const TOPIC_CREATED_GROUP_ID = 'topic:created'
export const TOPIC_PINNED_SECTION_ID = 'topic:section:pinned'
export const TOPIC_ASSISTANT_SECTION_ID = 'topic:section:assistant'
export const TOPIC_UNLINKED_ASSISTANT_GROUP_ID = 'topic:assistant:unknown'

const TOPIC_ASSISTANT_GROUP_ID_PREFIX = 'topic:assistant:'
const TOPIC_DEFAULT_ASSISTANT_RANK = Number.MAX_SAFE_INTEGER - 1
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

export function buildTopicDropAnchor(payload: ResourceListItemReorderPayload): OrderRequest | undefined {
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

export function createTopicDisplayGroupResolver<T extends Pick<Topic, 'assistantId' | 'pinned'>>({
  assistantById,
  defaultAssistant,
  labels,
  mode,
  pinnedAsSection = false
}: TopicDisplayGroupOptions): ResourceListGroupResolver<T> {
  const pinnedResolver = createPinnedGroupResolver<T>({
    isPinned: (topic) => topic.pinned === true,
    group: {
      id: TOPIC_PINNED_GROUP_ID,
      label: mode === 'time' || !pinnedAsSection ? labels.pinned : ''
    } satisfies ResourceListGroup
  })

  if (mode === 'time') {
    return composeResourceListGroupResolvers(pinnedResolver, () => ({ id: TOPIC_CREATED_GROUP_ID, label: '' }))
  }

  return composeResourceListGroupResolvers(pinnedResolver, (topic) => {
    const assistantId = topic.assistantId

    if (!assistantId) {
      return { id: TOPIC_UNLINKED_ASSISTANT_GROUP_ID, label: defaultAssistant?.name || labels.assistant.unlinked }
    }

    const assistant = assistantById?.get(assistantId)
    if (assistant) {
      return { id: getTopicAssistantGroupId(assistant.id), label: assistant.name }
    }

    return { id: TOPIC_UNLINKED_ASSISTANT_GROUP_ID, label: labels.assistant.unlinked }
  })
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
    return TOPIC_DEFAULT_ASSISTANT_RANK
  }

  return TOPIC_UNLINKED_ASSISTANT_RANK
}

export function sortTopicsForDisplayGroups<
  T extends Pick<Topic, 'assistantId' | 'createdAt' | 'id' | 'orderKey' | 'pinned' | 'updatedAt'>
>(topics: readonly T[], options: TopicDisplaySortOptions): T[] {
  const isPinned = (topic: T) => topic.pinned === true
  const compareWithinGroup =
    options.sortBy === 'createdAt'
      ? compareResourceCreationOrder
      : options.sortBy === 'updatedAt'
        ? compareResourceUpdatedOrder
        : (a: T, b: T) => compareResourceOrderKey(a.orderKey, b.orderKey) || compareResourceIds(a.id, b.id)

  if (options.mode === 'assistant') {
    return sortRankedResourceItems(topics, {
      getRank: (topic) => getAssistantGroupRank(topic, options.assistantRankById),
      isPinned,
      compareWithinGroup
    })
  }

  return sortRankedResourceItems(topics, {
    getRank: (topic) => (topic.pinned === true ? 0 : 1),
    isPinned,
    compareWithinGroup
  })
}
