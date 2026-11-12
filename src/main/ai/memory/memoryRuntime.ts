import { application } from '@application'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { topicService } from '@data/services/TopicService'

import { agentMemoryAuthority, type MemoryAuthority } from './memoryAuthority'

export function runtimeMemoryAuthorities(
  owner: { agentSessionId: string } | { topicId: string; assistantId: string },
  signal: AbortSignal
): MemoryAuthority[] {
  const turn = {
    assertActive: (): undefined => {
      signal.throwIfAborted()
      return undefined
    },
    isHeadless: () => false
  }
  if ('agentSessionId' in owner) {
    const session = agentSessionService.getById(owner.agentSessionId)
    const authorities = [agentMemoryAuthority(owner.agentSessionId, 'private', turn)]
    // Status inspection is not a content grant. Disabling sharing cannot sanitize native history.
    if (!agentChannelService.findBySessionId(owner.agentSessionId))
      authorities.push({
        ...authorities[0],
        scope: { kind: 'shared' },
        onRevoked: (listener) => {
          const ownerSubscription = authorities[0].onRevoked!(listener)
          const settingsSubscription = agentService.onAgentUpdated((event) => {
            if (event.agentId === session.agentId && event.agent.configuration?.shared_memory_enabled === false)
              listener()
          })
          return {
            dispose: () => {
              ownerSubscription.dispose()
              settingsSubscription.dispose()
            }
          }
        }
      })
    return authorities
  }
  const assertAuthorized = (): undefined => {
    signal.throwIfAborted()
    if (topicService.getById(owner.topicId).assistantId !== owner.assistantId)
      throw new Error('Memory conversation owner changed')
    assistantDataService.getById(owner.assistantId)
    return undefined
  }
  assertAuthorized()
  return [
    {
      scope: { kind: 'shared' },
      assertAuthorized,
      onRevoked: (listener) =>
        assistantDataService.onMemoryAccessRevoked((id) => {
          if (id === owner.assistantId) listener()
        })
    }
  ]
}

/** Connection owner lease. It is never revived after a permission or scope invalidation. */
export function openRuntimeMemoryGuard(agentSessionId: string, cancel: () => void) {
  const controller = new AbortController()
  const owners = runtimeMemoryAuthorities({ agentSessionId }, controller.signal)
  const service = application.get('MemoryService')
  const sessions = owners.map((owner) => service.open(owner))
  const revoke = () => {
    controller.abort(new Error('Memory runtime context expired'))
    cancel()
  }
  const subscriptions = owners.map((owner) => owner.onRevoked?.(revoke))
  subscriptions.push(
    service.onInvalidated((scope) => {
      if (
        !scope ||
        owners.some(
          (owner) =>
            owner.scope.kind === scope.kind &&
            (scope.kind === 'shared' || (owner.scope.kind === 'private' && owner.scope.agentId === scope.agentId))
        )
      )
        revoke()
    })
  )
  return {
    assertActive() {
      controller.signal.throwIfAborted()
    },
    async check() {
      controller.signal.throwIfAborted()
      for (const session of sessions) await session.assertRuntimeSafe()
      controller.signal.throwIfAborted()
    },
    dispose() {
      controller.abort(new Error('Memory runtime guard disposed'))
      for (const subscription of subscriptions) subscription?.dispose()
      for (const session of sessions) session.dispose()
    }
  }
}

/** Guards the transport, including native compaction and retries that bypass prompt hooks. */
export function memoryRuntimeFetch(
  fetch: typeof globalThis.fetch,
  authorities: (signal: AbortSignal) => MemoryAuthority[]
): typeof globalThis.fetch {
  let invalidated = false
  return async (input, init) => {
    if (invalidated) throw new Error('Memory context was invalidated; runtime continuation is blocked')
    const abort = new AbortController()
    const incoming = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const signal = incoming ? AbortSignal.any([incoming, abort.signal]) : abort.signal
    const owners = authorities(signal)
    if (!owners.length) return fetch(input, init)
    const service = application.get('MemoryService')
    const sessions = owners.map((owner) => service.open(owner))
    const revoke = () => {
      invalidated = true
      abort.abort(new Error('Memory context was invalidated; runtime continuation is blocked'))
    }
    const subscriptions = owners.map((owner) => owner.onRevoked?.(revoke))
    subscriptions.push(
      service.onInvalidated((scope) => {
        if (
          owners.some(
            (owner) =>
              !scope ||
              (owner.scope.kind === scope.kind &&
                (scope.kind === 'shared' || (owner.scope.kind === 'private' && owner.scope.agentId === scope.agentId)))
          )
        )
          revoke()
      })
    )
    const dispose = () => {
      for (const subscription of subscriptions) subscription?.dispose()
      for (const session of sessions) session.dispose()
    }
    const check = async () => {
      signal.throwIfAborted()
      for (const session of sessions) await session.assertRuntimeSafe()
      signal.throwIfAborted()
    }
    try {
      await check()
      const response = await fetch(input, { ...init, signal })
      await check()
      if (!response.body) {
        dispose()
        return response
      }
      const reader = response.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            signal.throwIfAborted()
            const result = await reader.read()
            signal.throwIfAborted()
            if (result.done) {
              await check()
              dispose()
              controller.close()
            } else controller.enqueue(result.value)
          } catch (error) {
            abort.abort(error)
            void reader.cancel(error).catch(() => {})
            dispose()
            controller.error(error)
          }
        },
        async cancel(reason) {
          abort.abort(reason)
          dispose()
          await reader.cancel(reason)
        }
      })
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch (error) {
      abort.abort(error)
      dispose()
      throw error
    }
  }
}
