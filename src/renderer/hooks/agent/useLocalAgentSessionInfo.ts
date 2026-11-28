import { useEffect, useMemo, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { LocalAgentSessionView } from '@shared/ai/localAgent'

const logger = loggerService.withContext('useLocalAgentSessionInfo')

export function useLocalAgentSessionInfo(sessionId: string, enabled: boolean, bindingKey?: string) {
  const scope = useMemo(() => ({ sessionId, enabled, bindingKey }), [sessionId, enabled, bindingKey])
  const [snapshot, setSnapshot] = useState<{ scope: typeof scope; view: LocalAgentSessionView }>()
  useEffect(() => {
    if (!scope.enabled) return
    let cancelled = false
    let receivedUpdate = false
    const unsubscribe = ipcApi.on('ai.local_agents.session_updated', (event) => {
      if (cancelled || event.sessionId !== scope.sessionId) return
      receivedUpdate = true
      setSnapshot({ scope, view: event })
    })
    void ipcApi
      .request('ai.local_agents.session_info', { sessionId: scope.sessionId })
      .then((view) => {
        if (!cancelled && !receivedUpdate) setSnapshot({ scope, view })
      })
      .catch((error) => logger.warn('Failed to read local agent capabilities', { error }))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [scope])

  return snapshot?.scope === scope ? snapshot.view : undefined
}
