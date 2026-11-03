import { application } from '@application'
import { AgentSessionForkSourceError, agentSessionForkService } from '@data/services/AgentSessionForkService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { getRetiredAgentSessionMigration } from '@data/services/retiredAgentRuntimeMigration'
import { AgentSessionForkError, type RuntimeForkProbeCandidate } from '@main/ai/runtime/fork'
import { isAgentSessionForkFailureReason, type AgentSessionForkAvailabilityDecision } from '@shared/ai/agentSessionFork'
import { isDataApiNotFoundError } from '@shared/data/api/errors'

import type { AgentSessionRuntimeDriver } from '../../runtime/types'
import { prepareForkSource } from './AgentSessionForkOperations'

const unknown: AgentSessionForkAvailabilityDecision = { enabled: null, reason: 'operation_failed' }

function decision(error: unknown): AgentSessionForkAvailabilityDecision {
  if (
    (error instanceof AgentSessionForkError || error instanceof AgentSessionForkSourceError) &&
    isAgentSessionForkFailureReason(error.reason)
  )
    return { enabled: false, reason: error.reason }
  return unknown
}

export async function getForkAvailability(sourceSessionId: string, messageIds: readonly string[]) {
  const ids = [...new Set(messageIds)]
  const results = new Map<string, AgentSessionForkAvailabilityDecision>()
  try {
    agentSessionService.getConversationById(sourceSessionId)
  } catch (error) {
    if (!isDataApiNotFoundError(error)) throw error
    return {
      items: ids.map((messageId) => ({
        messageId,
        availability: { enabled: false as const, reason: 'source_missing' as const }
      }))
    }
  }
  const marker = getRetiredAgentSessionMigration(application.get('DbService').getDb(), sourceSessionId)
  const groups = new Map<
    AgentSessionRuntimeDriver,
    Array<{ candidate: RuntimeForkProbeCandidate; prepared: ReturnType<typeof prepareForkSource> }>
  >()
  for (const messageId of ids) {
    try {
      if (marker) {
        const source = agentSessionForkService.read(sourceSessionId, messageId)
        const selected = source.messages.at(-1)!
        results.set(
          messageId,
          selected.role === 'assistant' && selected.status === 'success'
            ? unknown
            : { enabled: false, reason: 'not_turn_boundary' }
        )
        continue
      }
      const prepared = prepareForkSource(sourceSessionId, messageId)
      if (!prepared.driver.probeFork) {
        results.set(messageId, unknown)
        continue
      }
      const candidate = {
        messageId,
        checkpoint: prepared.checkpoint,
        checkpoints: prepared.checkpoints,
        cwd: prepared.source.workspace.path
      }
      const group = groups.get(prepared.driver) ?? []
      group.push({ candidate, prepared })
      groups.set(prepared.driver, group)
    } catch (error) {
      results.set(messageId, decision(error))
    }
  }
  for (const [driver, group] of groups) {
    let probed: ReadonlyMap<string, AgentSessionForkAvailabilityDecision>
    try {
      probed = await driver.probeFork!(group.map(({ candidate }) => candidate))
    } catch {
      probed = new Map()
    }
    for (const { candidate, prepared } of group) {
      try {
        const current = agentSessionForkService.read(sourceSessionId, candidate.messageId, prepared.excludedIds)
        const source = prepared.source
        if (
          current.agent.type !== source.agent.type ||
          current.agent.id !== source.agent.id ||
          current.workspace.id !== source.workspace.id ||
          current.workspace.path !== source.workspace.path ||
          JSON.stringify(current.messages) !== JSON.stringify(source.messages)
        )
          throw new AgentSessionForkSourceError('source_changed')
        results.set(candidate.messageId, probed.get(candidate.messageId) ?? unknown)
      } catch (error) {
        results.set(candidate.messageId, decision(error))
      }
    }
  }
  return { items: ids.map((messageId) => ({ messageId, availability: results.get(messageId) ?? unknown })) }
}
