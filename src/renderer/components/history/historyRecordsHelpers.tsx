import { EntityAvatarIcon } from '@renderer/components/EntityAvatarIcon'
import type { AgentSessionStreamState } from '@renderer/hooks/agent/useAgentSessionStreamStatuses'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { Topic as ApiTopic } from '@shared/data/types/topic'
import type { TFunction } from 'i18next'
import { Bot } from 'lucide-react'

import type { HistorySourceOption, HistorySourceStatus, HistoryStatusOption } from './historyRecordsTypes'

export const ALL_SOURCE_ID = 'all'
const UNLINKED_ASSISTANT_SOURCE_ID = '__unlinked_assistant__'
const UNKNOWN_AGENT_SOURCE_ID = '__unknown_agent__'

type AgentHistorySessionStatus = Exclude<HistorySourceStatus, 'all'>

export function getTopicSourceId(topic: Pick<ApiTopic, 'assistantId'>, assistantById?: ReadonlyMap<string, Assistant>) {
  if (!topic.assistantId) return UNLINKED_ASSISTANT_SOURCE_ID
  if (assistantById && !assistantById.has(topic.assistantId)) return UNLINKED_ASSISTANT_SOURCE_ID

  return topic.assistantId
}

export function getSessionAgentSourceId(
  session: Pick<AgentSessionEntity, 'agentId'>,
  agentById?: ReadonlyMap<string, AgentEntity>
) {
  if (!session.agentId) return UNKNOWN_AGENT_SOURCE_ID
  if (agentById && !agentById.has(session.agentId)) return UNKNOWN_AGENT_SOURCE_ID

  return session.agentId
}

export function getAgentHistoryStatus(streamStatus?: AgentSessionStreamState): AgentHistorySessionStatus {
  if (streamStatus?.isPending === true) return 'running'
  if (streamStatus?.status === 'error') return 'failed'

  return 'completed'
}

export function findAdjacentHistoryRecordAfterBulkDelete<T>(
  items: readonly T[],
  deletedIds: readonly string[],
  activeId: string,
  getId: (item: T) => string
): T | undefined {
  const deletedIdSet = new Set(deletedIds)
  const activeIndex = items.findIndex((item) => getId(item) === activeId)
  if (activeIndex < 0) return undefined

  for (let index = activeIndex + 1; index < items.length; index += 1) {
    if (!deletedIdSet.has(getId(items[index]))) return items[index]
  }

  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    if (!deletedIdSet.has(getId(items[index]))) return items[index]
  }

  return undefined
}

export function buildAgentStatusItems(t: TFunction): HistoryStatusOption[] {
  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all')
    },
    {
      id: 'running',
      label: t('history.records.status.running'),
      dotClassName: 'text-warning'
    },
    {
      id: 'completed',
      label: t('history.records.status.completed'),
      dotClassName: 'text-success'
    },
    {
      id: 'failed',
      label: t('history.records.status.failed'),
      dotClassName: 'text-destructive'
    }
  ]
}

export function buildAssistantSources(
  topics: readonly ApiTopic[],
  assistantById: ReadonlyMap<string, Assistant>,
  assistantRankById: ReadonlyMap<string, number>,
  unlinkedAssistantLabel: string,
  t: TFunction
): HistorySourceOption[] {
  const hasUnlinkedAssistant = topics.some(
    (topic) => getTopicSourceId(topic, assistantById) === UNLINKED_ASSISTANT_SOURCE_ID
  )

  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all')
    },
    ...Array.from(assistantById.values())
      .sort(
        (left, right) =>
          getAssistantSourceRank(left.id, assistantRankById) - getAssistantSourceRank(right.id, assistantRankById)
      )
      .map((assistant) => ({
        id: assistant.id,
        label: assistant.name,
        icon: <EntityAvatarIcon avatar={assistant.avatar} size={18} fontSize={14} className="mr-0" />
      })),
    ...(hasUnlinkedAssistant
      ? [
          {
            id: UNLINKED_ASSISTANT_SOURCE_ID,
            label: unlinkedAssistantLabel,
            icon: <Bot size={15} />
          }
        ]
      : [])
  ]
}

export function buildAgentSources(
  sessions: readonly AgentSessionEntity[],
  agentById: ReadonlyMap<string, AgentEntity>,
  agentRankById: ReadonlyMap<string, number>,
  unknownAgentLabel: string,
  t: TFunction
): HistorySourceOption[] {
  const hasUnknownAgent = sessions.some(
    (session) => getSessionAgentSourceId(session, agentById) === UNKNOWN_AGENT_SOURCE_ID
  )

  return [
    {
      id: ALL_SOURCE_ID,
      label: t('common.all')
    },
    ...Array.from(agentById.values())
      .sort((left, right) => getAgentSourceRank(left.id, agentRankById) - getAgentSourceRank(right.id, agentRankById))
      .map((agent) => {
        return {
          id: agent.id,
          label: agent.name,
          icon: <EntityAvatarIcon avatar={agent.avatar} size={18} fontSize={11} className="mr-0 text-foreground" />
        }
      }),
    ...(hasUnknownAgent
      ? [
          {
            id: UNKNOWN_AGENT_SOURCE_ID,
            label: unknownAgentLabel,
            icon: <Bot size={15} />
          }
        ]
      : [])
  ]
}

function getAssistantSourceRank(sourceId: string, assistantRankById: ReadonlyMap<string, number>) {
  const assistantRank = assistantRankById.get(sourceId)
  if (assistantRank !== undefined) return assistantRank

  return Number.MAX_SAFE_INTEGER
}

function getAgentSourceRank(sourceId: string, agentRankById: ReadonlyMap<string, number>) {
  const agentRank = agentRankById.get(sourceId)
  if (agentRank !== undefined) return agentRank

  return Number.MAX_SAFE_INTEGER
}
