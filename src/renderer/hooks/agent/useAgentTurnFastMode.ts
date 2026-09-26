import { useCallback } from 'react'

import { useCache } from '@renderer/data/hooks/useCache'
import type { UseCacheKey } from '@shared/data/cache/cacheSchemas'

const FALLBACK_SESSION_KEY = '__none__'

export function getAgentTurnFastModeCacheKey(sessionId: string): UseCacheKey {
  return `agent.turn.fast_mode.${sessionId}`
}

export function useAgentTurnFastMode(sessionId: string | undefined): [boolean, (enabled: boolean) => void] {
  const cacheKey = getAgentTurnFastModeCacheKey(sessionId ?? FALLBACK_SESSION_KEY)
  const [fastMode, setFastMode] = useCache(cacheKey)

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (!sessionId) return
      setFastMode(enabled)
    },
    [sessionId, setFastMode]
  )

  return [sessionId ? fastMode : false, setEnabled]
}
