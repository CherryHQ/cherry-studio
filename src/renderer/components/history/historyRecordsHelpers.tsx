import EmojiIcon from '@renderer/components/EmojiIcon'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Assistant } from '@shared/data/types/assistant'
import type { TFunction } from 'i18next'
import { Bot } from 'lucide-react'

import type { HistorySourceOption, HistoryStatusOption } from './historyRecordsTypes'

export const ALL_SOURCE_ID = 'all'
export const UNLINKED_ASSISTANT_SOURCE_ID = '__unlinked_assistant__'
export const UNKNOWN_AGENT_SOURCE_ID = '__unknown_agent__'

/**
 * Map a history source-filter selection to the server-side owner scope
 * (D1 of #16890): the synthetic "unlinked" source ids become the literal
 * `'unlinked'` scope, `all` means no scope, and concrete ids pass through.
 */
export function toServerOwnerScope(selectedSourceId: string): string | undefined {
  if (selectedSourceId === ALL_SOURCE_ID) return undefined
  if (selectedSourceId === UNLINKED_ASSISTANT_SOURCE_ID || selectedSourceId === UNKNOWN_AGENT_SOURCE_ID) {
    return 'unlinked'
  }
  return selectedSourceId
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
  hasUnlinkedAssistant: boolean,
  assistantById: ReadonlyMap<string, Assistant>,
  assistantRankById: ReadonlyMap<string, number>,
  unlinkedAssistantLabel: string,
  t: TFunction
): HistorySourceOption[] {
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
        icon: assistant.emoji ? <span className="text-sm leading-none">{assistant.emoji}</span> : <Bot size={15} />
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
  hasUnknownAgent: boolean,
  agentById: ReadonlyMap<string, AgentEntity>,
  agentRankById: ReadonlyMap<string, number>,
  unknownAgentLabel: string,
  t: TFunction
): HistorySourceOption[] {
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
          icon: (
            <EmojiIcon
              emoji={getAgentAvatarFromConfiguration(agent.configuration)}
              size={18}
              fontSize={11}
              className="mr-0 text-foreground"
            />
          )
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
