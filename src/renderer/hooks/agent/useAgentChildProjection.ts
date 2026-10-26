import { useEffect, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { applyAgentChildUpdate, type AgentChildUpdate, type AgentChildView } from '@shared/ai/agentChildProjection'

const logger = loggerService.withContext('useAgentChildProjection')

export function useAgentChildProjection(sessionId: string, toolCallId: string | undefined, active: boolean) {
  const [state, setState] = useState<{ key: string; view: AgentChildView | null; error?: string }>()
  const key = `${sessionId}:${toolCallId}`
  useEffect(() => {
    if (!active || !toolCallId) return
    const subscriptionId = crypto.randomUUID()
    let disposed = false
    let loading = false
    let current: AgentChildView | null = null
    let buffered: AgentChildUpdate[] = []
    let overflow = false
    const fail = (error: unknown) => {
      if (!disposed) setState({ key, view: current, error: String(error) })
      logger.warn('Child projection subscription failed', { error })
    }
    const apply = (update: AgentChildUpdate) => {
      if (!current) return true
      const next = applyAgentChildUpdate(current, update)
      if (!next) {
        void attach()
        return false
      }
      current = next
      setState({ key, view: current })
      return true
    }
    async function attach() {
      if (loading || disposed) return
      loading = true
      buffered = []
      overflow = false
      try {
        const snapshot = await ipcApi.request('ai.agent.child.attach', {
          sessionId,
          toolCallId: toolCallId!,
          subscriptionId
        })
        if (disposed) return
        current = snapshot
        loading = false
        setState({ key, view: current })
        if (overflow) {
          void attach()
          return
        }
        const pending = buffered
        buffered = []
        for (const update of pending) if (!apply(update)) break
      } catch (error) {
        loading = false
        fail(error)
      }
    }
    const unsubscribe = ipcApi.on('ai.agent.child.changed', (event) => {
      if (disposed || event.subscriptionId !== subscriptionId) return
      if (loading) {
        if (overflow) return
        buffered.push(event.update)
        if (buffered.length > 100) {
          buffered = []
          overflow = true
        }
      } else apply(event.update)
    })
    void attach()
    return () => {
      disposed = true
      unsubscribe()
      void ipcApi.request('ai.agent.child.detach', { subscriptionId }).catch(fail)
    }
  }, [sessionId, toolCallId, active, key])
  return state?.key === key ? state : undefined
}
