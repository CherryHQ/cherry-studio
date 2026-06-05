import { usePersistCache } from '@data/hooks/useCache'
import { useCallback } from 'react'

const MAX_RECENT_EMOJIS = 32

export const useRecentEmojis = () => {
  const [recent, setRecent] = usePersistCache('ui.emoji.recently_used')

  const pushRecent = useCallback(
    (emoji: string) => {
      const next = [emoji, ...recent.filter((item) => item !== emoji)].slice(0, MAX_RECENT_EMOJIS)
      setRecent(next)
    },
    [recent, setRecent]
  )

  const clearRecent = useCallback(() => {
    setRecent([])
  }, [setRecent])

  return { recent, pushRecent, clearRecent }
}
