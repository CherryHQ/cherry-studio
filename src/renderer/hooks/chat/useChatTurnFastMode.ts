import { useCallback } from 'react'

import { useCache } from '@renderer/data/hooks/useCache'
import type { UseCacheKey } from '@shared/data/cache/cacheSchemas'

const FALLBACK_CONVERSATION_KEY = '__none__'

export function getChatTurnFastModeCacheKey(topicId: string): UseCacheKey {
  return `chat.turn.fast_mode.${topicId}`
}

export function useChatTurnFastMode(topicId: string | undefined): [boolean, (enabled: boolean) => void] {
  const cacheKey = getChatTurnFastModeCacheKey(topicId ?? FALLBACK_CONVERSATION_KEY)
  const [fastMode, setFastMode] = useCache(cacheKey)

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (!topicId) return
      setFastMode(enabled)
    },
    [setFastMode, topicId]
  )

  return [topicId ? fastMode : false, setEnabled]
}
