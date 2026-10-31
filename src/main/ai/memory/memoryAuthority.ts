import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'
import type { Disposable } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import type { MemoryScope } from '@shared/types/memory'

import type { MemoryAccess } from './MemoryStore'

export interface MemoryAuthority extends MemoryAccess {
  readonly scope: MemoryScope
  onRevoked?(listener: () => void): Disposable
}

/** Supplied by the main-process turn owner, never by tool arguments. */
export interface MemoryTurn {
  assertActive(): undefined
  isHeadless(): boolean
}

function denied(): never {
  throw new Error('Memory access is not available for this caller')
}

export function agentMemoryAuthority(sessionId: string, kind: MemoryScope['kind'], turn: MemoryTurn): MemoryAuthority {
  const initial = agentSessionService.getById(sessionId)
  const agentId = initial.agentId
  if (!agentId) denied()
  const channelId = agentChannelService.findBySessionId(sessionId)?.id
  const scope: MemoryScope = kind === 'shared' ? { kind } : { kind, agentId }
  const assertAuthorized = (): undefined => {
    turn.assertActive()
    const session = agentSessionService.getById(sessionId)
    const agent = agentService.getAgent(agentId)
    const channel = agentChannelService.findBySessionId(sessionId)
    if (session.agentId !== agentId || !agent || channel?.id !== channelId) denied()
    if (channel && (!channel.isActive || channel.agentId !== agentId)) denied()
    if (kind === 'shared') {
      if (channel || turn.isHeadless() || agent.configuration?.shared_memory_enabled === false) denied()
      agentSessionService.getConversationById(sessionId)
    }
    return undefined
  }
  assertAuthorized()
  return {
    scope: Object.freeze(scope),
    assertAuthorized,
    onRevoked: (listener) => {
      const deletionSubscription = agentService.onMemoryAccessRevoked((id) => {
        if (id === agentId) listener()
      })
      const channelSubscription = channelId
        ? agentChannelService.onMemoryAccessRevoked((id) => {
            if (id === channelId) listener()
          })
        : undefined
      const agentSubscription = agentService.onAgentUpdated((event) => {
        if (
          kind === 'shared' &&
          event.agentId === agentId &&
          event.agent.configuration?.shared_memory_enabled === false
        )
          listener()
      })
      const sessionSubscription = agentSessionService.onSessionUpdated((event) => {
        if (event.sessionId !== sessionId) return
        try {
          assertAuthorized()
        } catch {
          listener()
        }
      })
      return {
        dispose: () => {
          agentSubscription.dispose()
          deletionSubscription.dispose()
          channelSubscription?.dispose()
          sessionSubscription.dispose()
        }
      }
    }
  }
}

export function assistantMemoryAuthority(
  context: { kind: 'conversation' | 'temporary' | 'auxiliary' | 'headless'; topicId: string; assistantId: string },
  turn: MemoryTurn
): MemoryAuthority {
  const { kind, topicId, assistantId } = context
  const assertAuthorized = (): undefined => {
    turn.assertActive()
    if (kind !== 'conversation' || turn.isHeadless()) denied()
    const topic = topicService.getById(topicId)
    const assistant = assistantDataService.getById(assistantId)
    if (topic.assistantId !== assistantId || assistant.settings.enableSharedMemory !== true) denied()
    return undefined
  }
  assertAuthorized()
  return {
    scope: Object.freeze({ kind: 'shared' }),
    assertAuthorized,
    onRevoked: (listener) =>
      assistantDataService.onMemoryAccessRevoked((id) => {
        if (id === assistantId) listener()
      })
  }
}

export function editorMemoryAuthority(senderId: string | null, target: MemoryScope): MemoryAuthority {
  const scope = Object.freeze({ ...target })
  const assertAuthorized = (): undefined => {
    const windows = application.get('WindowManager')
    if (!senderId || windows.getWindowType(senderId) !== WindowType.Main || !windows.getWindow(senderId)) denied()
    if (scope.kind === 'private' && !agentService.getAgent(scope.agentId)) denied()
    return undefined
  }
  assertAuthorized()
  return {
    scope,
    assertAuthorized,
    onRevoked:
      scope.kind === 'private'
        ? (listener) =>
            agentService.onMemoryAccessRevoked((id) => {
              if (id === scope.agentId) listener()
            })
        : undefined
  }
}
