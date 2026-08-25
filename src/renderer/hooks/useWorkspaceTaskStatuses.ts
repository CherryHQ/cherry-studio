import { useSharedCacheSelector } from '@renderer/data/hooks/useCache'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import {
  classifyTurn,
  TOPIC_STATUS_INDEX_CACHE_KEY,
  type TopicStatusSnapshotEntry,
  type TopicStatusSnapshotIndex
} from '@shared/ai/transport'
import { useMemo } from 'react'

export type WorkspaceTaskStatus = 'action-required' | 'completed' | 'error' | 'idle' | 'running'

const AGENT_SESSION_TOPIC_PREFIX = buildAgentSessionTopicId('')
const EMPTY_STATUS_INDEX: TopicStatusSnapshotIndex = Object.freeze({})
const STATUS_INDEX_KEYS = [TOPIC_STATUS_INDEX_CACHE_KEY] as const
const NO_STATUS_INDEX_KEYS = [] as const

const STATUS_PRIORITY: Record<WorkspaceTaskStatus, number> = {
  idle: 0,
  completed: 1,
  running: 2,
  error: 3,
  'action-required': 4
}

function higherPriorityStatus(current: WorkspaceTaskStatus, candidate: WorkspaceTaskStatus): WorkspaceTaskStatus {
  return STATUS_PRIORITY[candidate] > STATUS_PRIORITY[current] ? candidate : current
}

export function aggregateConversationTaskStatus(
  entries: readonly (TopicStatusSnapshotEntry | null | undefined)[]
): WorkspaceTaskStatus {
  let aggregate: WorkspaceTaskStatus = 'idle'

  for (const entry of entries) {
    if (!entry) continue
    const flags = classifyTurn(entry.status)
    const status: WorkspaceTaskStatus =
      flags.isAwaitingApproval || entry.awaitingApprovalAnchors.length > 0
        ? 'action-required'
        : entry.status === 'error'
          ? 'error'
          : flags.isStreamLive
            ? 'running'
            : entry.status === 'done' && entry.lastCompletedAt != null
              ? 'completed'
              : 'idle'
    aggregate = higherPriorityStatus(aggregate, status)
  }

  return aggregate
}

function aggregateWorkspaceStatuses(index: TopicStatusSnapshotIndex): {
  assistantStatus: WorkspaceTaskStatus
  agentStatus: WorkspaceTaskStatus
} {
  const assistantEntries: TopicStatusSnapshotEntry[] = []
  const agentEntries: TopicStatusSnapshotEntry[] = []

  for (const [topicId, entry] of Object.entries(index)) {
    if (topicId.startsWith(AGENT_SESSION_TOPIC_PREFIX)) {
      agentEntries.push(entry)
    } else {
      assistantEntries.push(entry)
    }
  }

  return {
    assistantStatus: aggregateConversationTaskStatus(assistantEntries),
    agentStatus: aggregateConversationTaskStatus(agentEntries)
  }
}

function selectStatusIndex(values: readonly (TopicStatusSnapshotIndex | undefined)[]): TopicStatusSnapshotIndex {
  return values[0] ?? EMPTY_STATUS_INDEX
}

/** Main-owned conversation state grouped by Sidebar app. */
export function useWorkspaceTaskStatuses(enabled = true): ReadonlyMap<SidebarAppId, WorkspaceTaskStatus> {
  const statusIndex = useSharedCacheSelector(enabled ? STATUS_INDEX_KEYS : NO_STATUS_INDEX_KEYS, selectStatusIndex)
  const { assistantStatus, agentStatus } = useMemo(() => aggregateWorkspaceStatuses(statusIndex), [statusIndex])

  return useMemo(
    () =>
      new Map<SidebarAppId, WorkspaceTaskStatus>([
        ['assistants', assistantStatus],
        ['agents', agentStatus]
      ]),
    [agentStatus, assistantStatus]
  )
}
