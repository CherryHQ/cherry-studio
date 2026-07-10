import { hasFluentEmojiIcon } from '@cherrystudio/ui/fluent-emoji'
import { usePersistCache } from '@data/hooks/useCache'
import { useCallback, useEffect, useMemo } from 'react'

const MAX_RECENT_EMOJIS = 32

function filterSupportedEmojis(emojis: readonly string[]) {
  return emojis.filter((emoji) => hasFluentEmojiIcon(emoji))
}

function areEmojiListsEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((emoji, index) => emoji === right[index])
}

export const useRecentEmojis = () => {
  const [recent, setRecent] = usePersistCache('ui.emoji.recently_used')
  const supportedRecent = useMemo(() => filterSupportedEmojis(recent), [recent])

  useEffect(() => {
    if (areEmojiListsEqual(recent, supportedRecent)) return
    setRecent(supportedRecent)
  }, [recent, setRecent, supportedRecent])

  const pushRecent = useCallback(
    (emoji: string) => {
      if (!hasFluentEmojiIcon(emoji)) return
      setRecent((prev) =>
        [emoji, ...filterSupportedEmojis(prev).filter((item) => item !== emoji)].slice(0, MAX_RECENT_EMOJIS)
      )
    },
    [setRecent]
  )

  const clearRecent = useCallback(() => {
    setRecent([])
  }, [setRecent])

  return { recent: supportedRecent, pushRecent, clearRecent }
}
