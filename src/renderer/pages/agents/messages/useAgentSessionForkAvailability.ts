import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDataChange } from '@data/hooks/useDataChange'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  type AgentSessionForkAvailabilityDecision,
  AgentSessionForkAvailabilityDecisionSchema
} from '@shared/ai/agentSessionFork'
import type { CherryUIMessage } from '@shared/data/types/message'

const logger = loggerService.withContext('agentSessionForkAvailability')
const unknown: AgentSessionForkAvailabilityDecision = { enabled: null, reason: 'operation_failed' }
const persistedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type Scope = {
  values: Map<string, AgentSessionForkAvailabilityDecision>
  candidates: string[]
  queued: Set<string>
  requesting: Set<string>
  inFlight?: Promise<void>
  active: boolean
}

export function useAgentSessionForkAvailability({
  sourceSessionId,
  agentId,
  messages,
  enabled
}: {
  sourceSessionId?: string
  agentId?: string
  messages: readonly CherryUIMessage[]
  enabled: boolean
}) {
  const scope = useMemo<Scope>(
    () => ({ values: new Map(), candidates: [], queued: new Set(), requesting: new Set(), active: false }),
    [sourceSessionId, agentId]
  )
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [snapshot, setSnapshot] = useState<{
    scope: Scope
    values: ReadonlyMap<string, AgentSessionForkAvailabilityDecision>
  }>(() => ({ scope, values: new Map() }))
  const key = messages
    .filter(
      (message) =>
        message.role === 'assistant' && message.metadata?.status === 'success' && persistedId.test(message.id)
    )
    .map((message) => message.id)
    .join(',')
  scope.candidates = key ? key.split(',') : []
  const publish = useCallback(() => {
    if (scope.active && scopeRef.current === scope) setSnapshot({ scope, values: new Map(scope.values) })
  }, [scope])
  const get = useCallback((id: string) => scopeRef.current.values.get(id), [])
  const revalidate = useCallback(
    (ids?: readonly string[]): Promise<void> => {
      if (!enabled || !sourceSessionId || !scope.active || scopeRef.current !== scope) return Promise.resolve()
      const candidates = new Set(scope.candidates)
      for (const id of ids ?? scope.candidates) {
        if (candidates.has(id)) {
          scope.queued.add(id)
        }
      }
      publish()
      if (scope.inFlight) return scope.inFlight
      const run = async () => {
        while (scope.active && scopeRef.current === scope && scope.queued.size) {
          const pending = [...scope.queued]
          scope.queued.clear()
          scope.requesting = new Set(pending)
          for (let offset = 0; offset < pending.length; offset += 200) {
            const batch = pending.slice(offset, offset + 200)
            let timer: ReturnType<typeof setTimeout> | undefined
            let items: unknown
            try {
              const result = await Promise.race([
                ipcApi.request('ai.agent.session.fork_availability', { sourceSessionId, messageIds: batch }),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(new Error('Fork availability deadline')), 3000)
                })
              ])
              items = result?.items
            } catch (error) {
              logger.warn('Fork availability request failed', { error })
            } finally {
              clearTimeout(timer)
            }
            if (!scope.active || scopeRef.current !== scope) return
            const found = new Map<string, AgentSessionForkAvailabilityDecision>()
            const duplicates = new Set<string>()
            if (Array.isArray(items)) {
              for (const item of items) {
                if (!item || typeof item.messageId !== 'string' || !batch.includes(item.messageId)) continue
                if (Object.keys(item).length !== 2 || !Object.hasOwn(item, 'availability')) {
                  found.set(item.messageId, unknown)
                  continue
                }
                if (found.has(item.messageId) || duplicates.has(item.messageId)) {
                  duplicates.add(item.messageId)
                  found.delete(item.messageId)
                  continue
                }
                const parsed = AgentSessionForkAvailabilityDecisionSchema.safeParse(item.availability)
                found.set(item.messageId, parsed.success ? parsed.data : unknown)
              }
            }
            for (const id of batch) {
              if (!scope.queued.has(id) && scope.candidates.includes(id)) scope.values.set(id, found.get(id) ?? unknown)
            }
            publish()
          }
        }
      }
      scope.inFlight = run().finally(() => {
        scope.inFlight = undefined
      })
      return scope.inFlight
    },
    [enabled, sourceSessionId, scope, publish]
  )
  const invalidate = useCallback(() => {
    void revalidate()
  }, [revalidate])
  useEffect(() => {
    scope.active = true
    return () => {
      scope.active = false
    }
  }, [scope])
  useEffect(() => {
    const candidates = new Set(scope.candidates)
    for (const id of scope.values.keys()) if (!candidates.has(id)) scope.values.delete(id)
    const missing = scope.candidates.filter(
      (id) => !scope.values.has(id) && !scope.queued.has(id) && !scope.requesting.has(id)
    )
    if (missing.length) void revalidate(missing)
    else publish()
  }, [key, scope, revalidate, publish])
  useDataChange(enabled && sourceSessionId ? '/agent-sessions/:sessionId/messages' : [], invalidate, {
    routeParams: { sessionId: sourceSessionId ?? '' }
  })
  useDataChange(enabled && agentId ? ['/agents', '/agents/:agentId'] : [], (effects) => {
    if (effects.some((effect) => !effect.entityIds || effect.entityIds.includes(agentId!))) invalidate()
  })
  useEffect(() => {
    if (!enabled) return
    window.addEventListener('focus', invalidate)
    return () => window.removeEventListener('focus', invalidate)
  }, [enabled, invalidate])
  return { byMessageId: snapshot.scope === scope ? snapshot.values : new Map(), get, revalidate, invalidate }
}
