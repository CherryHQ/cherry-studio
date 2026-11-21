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
import type { ConversationListSort } from '@shared/data/types/conversationList'

import { compareConversationListItems } from './conversationListSort'

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
  subject: {
    ungrouped: string
  }
}

export type TopicDisplaySubject = {
  id: string
  name: string
}

export type TopicDisplayGroupOptions = {
  assistantById?: ReadonlyMap<string, TopicDisplayAssistant>
  subjectById?: ReadonlyMap<string, TopicDisplaySubject>
  labels: TopicDisplayGroupLabels
  mode: TopicDisplayMode
  now?: Parameters<typeof getResourceTimeBucket>[1]
}

export type TopicDisplaySortOptions = {
  sort?: ConversationListSort
  sortLocale?: string
  assistantRankById?: ReadonlyMap<string, number>
  subjectRankById?: ReadonlyMap<string, number>
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
const TOPIC_SUBJECT_GROUP_ID_PREFIX = 'topic:subject:'
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

export function getTopicSubjectGroupId(groupId: string): string {
  return `${TOPIC_SUBJECT_GROUP_ID_PREFIX}${groupId}`
}

export function getSubjectIdFromTopicGroupId(groupId: string): string | undefined {
  if (!groupId.startsWith(TOPIC_SUBJECT_GROUP_ID_PREFIX)) return undefined

  return groupId.slice(TOPIC_SUBJECT_GROUP_ID_PREFIX.length)
}

export function createTopicDisplayGroupResolver<
  T extends Pick<Topic, 'assistantId' | 'groupId' | 'lastActivityAt' | 'pinned'>
>({ assistantById, subjectById, labels, mode, now }: TopicDisplayGroupOptions): ResourceListGroupResolver<T> {
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

  if (mode === 'subject') {
    return withTopicGroupIdPrefix((topic) => {
      const subject = topic.groupId ? subjectById?.get(topic.groupId) : undefined
      if (!subject) return { id: 'subject:ungrouped', label: labels.subject.ungrouped }
      return { id: `subject:${subject.id}`, label: subject.name }
    })
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

function getSubjectGroupRank<T extends Pick<Topic, 'groupId'>>(
  topic: T,
  subjectRankById?: ReadonlyMap<string, number>
) {
  const subjectRank = topic.groupId ? subjectRankById?.get(topic.groupId) : undefined
  return subjectRank ?? TOPIC_UNLINKED_ASSISTANT_RANK
}

export function sortTopicsForDisplayGroups<
  T extends Pick<Topic, 'id' | 'assistantId' | 'groupId' | 'lastActivityAt' | 'pinned' | 'createdAt'> & {
    name?: string
    orderKey?: string
  }
>(topics: readonly T[], options: TopicDisplaySortOptions): T[] {
  const isPinned = (topic: T) => topic.pinned === true
  const compare = options.sort ? compareConversationListItems<T>(options.sort, options.sortLocale) : undefined

  if (options.mode === 'assistant' || options.mode === 'subject') {
    const getRank = (topic: T) =>
      options.mode === 'subject'
        ? getSubjectGroupRank(topic, options.subjectRankById)
        : getAssistantGroupRank(topic, options.assistantRankById)

    return topics
      .map((topic, index) => ({ topic, index, rank: getRank(topic) }))
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank
        if (a.topic.pinned !== b.topic.pinned) return a.topic.pinned ? -1 : 1
        if (a.topic.pinned && b.topic.pinned) return a.index - b.index
        return (
          (compare ? compare(a.topic, b.topic) : compareResourceOrderKey(a.topic.orderKey, b.topic.orderKey)) ||
          a.index - b.index
        )
      })
      .map(({ topic }) => topic)
  }

  return sortRankedResourceItems(topics, {
    getRank: (topic) =>
      topic.pinned === true ? 0 : TOPIC_TIME_BUCKET_RANK[getTopicTimeBucket(topic.lastActivityAt, options.now)],
    isPinned,
    compareWithinGroup: compare ?? compareResourceRecency((topic) => topic.lastActivityAt)
  })
}
