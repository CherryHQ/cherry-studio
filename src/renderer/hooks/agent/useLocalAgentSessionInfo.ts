import { useEffect, useEffectEvent, useMemo, useState } from 'react'

import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { LocalAgentSessionInfo } from '@shared/ai/localAgent'

const logger = loggerService.withContext('useLocalAgentSessionInfo')

export function useLocalAgentSessionInfo(sessionId: string, enabled: boolean) {
  const [snapshots, setSnapshots] = useCache('agent.session.local_options')
  const scope = useMemo(() => ({ sessionId, enabled }), [sessionId, enabled])
  const [live, setLive] = useState<{ scope: typeof scope; info: LocalAgentSessionInfo } | null>(null)

  const accept = useEffectEvent((info: LocalAgentSessionInfo, source: typeof scope) => {
    if (source !== scope) return
    setLive({ scope, info })
    const { mode, thoughtLevel, configOptions } = info
    setSnapshots((previous) =>
      Object.fromEntries(
        [
          [sessionId, { mode, thoughtLevel, configOptions }],
          ...Object.entries(previous).filter(([id]) => id !== sessionId)
        ].slice(0, 100)
      )
    )
  })

  useEffect(() => {
    setLive(null)
    if (!enabled) return
    let cancelled = false
    let receivedUpdate = false
    const unsubscribe = ipcApi.on('ai.local_agents.session_updated', (event) => {
      if (cancelled || event.sessionId !== sessionId) return
      receivedUpdate = true
      accept(event.info, scope)
    })
    void ipcApi
      .request('ai.local_agents.session_info', { sessionId })
      .then((info) => {
        // A push can overtake the initial read; never replace it with the older snapshot.
        if (!cancelled && !receivedUpdate && info) accept(info, scope)
      })
      .catch((error) => logger.warn('Failed to read local agent capabilities', { error }))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [sessionId, enabled, scope])

  const info = enabled && live?.scope === scope ? live.info : null
  return { info, options: info ?? snapshots[sessionId] }
}
