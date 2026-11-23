import { useEffect, useEffectEvent, useMemo, useState } from 'react'

import { useCache, usePersistCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  getDefaultLocalAgentMode,
  getDefaultLocalAgentThoughtLevel,
  type LocalAgentConfiguration,
  type LocalAgentSessionInfo
} from '@shared/ai/localAgent'

const logger = loggerService.withContext('useLocalAgentSessionInfo')

type LocalOptionSnapshot = Pick<LocalAgentSessionInfo, 'mode' | 'thoughtLevel' | 'configOptions'>

function upsertSnapshot(
  previous: Record<string, LocalOptionSnapshot>,
  sessionId: string,
  snapshot: LocalOptionSnapshot
): Record<string, LocalOptionSnapshot> {
  return Object.fromEntries(
    [[sessionId, snapshot], ...Object.entries(previous).filter(([id]) => id !== sessionId)].slice(0, 100)
  )
}

function deleteSnapshot(
  previous: Record<string, LocalOptionSnapshot>,
  sessionId: string
): Record<string, LocalOptionSnapshot> {
  if (!(sessionId in previous)) return previous
  const next = { ...previous }
  delete next[sessionId]
  return next
}

export function useLocalAgentSessionInfo(
  sessionId: string,
  enabled: boolean,
  protocol?: LocalAgentConfiguration['protocol'],
  presetId?: string
) {
  const [snapshots, setSnapshots] = useCache('agent.session.local_options')
  const [persistedSnapshots, setPersistedSnapshots] = usePersistCache('local_agent.session_option_snapshots')
  const scope = useMemo(() => ({ sessionId, enabled }), [sessionId, enabled])
  const [live, setLive] = useState<{ scope: typeof scope; info: LocalAgentSessionInfo } | null>(null)

  const accept = useEffectEvent((info: LocalAgentSessionInfo | null, source: typeof scope, clearSnapshots = false) => {
    if (source !== scope) return
    if (!info) {
      setLive(null)
      if (clearSnapshots) {
        setSnapshots((previous) => deleteSnapshot(previous, sessionId))
        setPersistedSnapshots((previous) => deleteSnapshot(previous, sessionId))
      }
      return
    }
    setLive({ scope, info })
    const snapshot: LocalOptionSnapshot = {
      mode: info.mode,
      thoughtLevel: info.thoughtLevel,
      configOptions: info.configOptions
    }
    setSnapshots((previous) => upsertSnapshot(previous, sessionId, snapshot))
    setPersistedSnapshots((previous) => upsertSnapshot(previous, sessionId, snapshot))
  })

  useEffect(() => {
    setLive(null)
    if (!enabled) return
    let cancelled = false
    let receivedUpdate = false
    const unsubscribe = ipcApi.on('ai.local_agents.session_updated', (event) => {
      if (cancelled || event.sessionId !== sessionId) return
      receivedUpdate = true
      accept(event.info, scope, event.clearSnapshots)
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
  const base = info ?? snapshots[sessionId] ?? persistedSnapshots[sessionId]
  const options = useMemo(() => {
    if (!enabled) return base
    const fallbackMode = protocol ? getDefaultLocalAgentMode(protocol, presetId) : undefined
    const fallbackThoughtLevel = protocol ? getDefaultLocalAgentThoughtLevel(protocol) : undefined
    if (!base) {
      if (!fallbackMode && !fallbackThoughtLevel) return undefined
      return {
        ...(fallbackMode ? { mode: fallbackMode } : {}),
        ...(fallbackThoughtLevel ? { thoughtLevel: fallbackThoughtLevel } : {})
      }
    }
    const needsMode = !base.mode && fallbackMode
    const needsThought = !base.thoughtLevel && fallbackThoughtLevel
    if (!needsMode && !needsThought) return base
    return {
      ...base,
      ...(needsMode ? { mode: fallbackMode } : {}),
      ...(needsThought ? { thoughtLevel: fallbackThoughtLevel } : {})
    }
  }, [base, enabled, presetId, protocol])

  return {
    info,
    options
  }
}
