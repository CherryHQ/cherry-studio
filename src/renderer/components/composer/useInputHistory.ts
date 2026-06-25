import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { useCallback, useRef, useState } from 'react'

import { getNextInputHistoryIndex, type InputHistoryDirection } from './inputHistoryNavigation'

interface UseInputHistoryOptions {
  applyText: (value: string) => void
}

export function useInputHistory({ applyText }: UseInputHistoryOptions) {
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftBeforeHistoryRef = useRef<string | null>(null)
  const { data: history = [] } = useQuery('/input-history')
  const { trigger: saveInputHistory } = useMutation('POST', '/input-history', {
    refresh: ['/input-history']
  })

  const applyHistoryIndex = useCallback(
    (nextIndex: number) => {
      setHistoryIndex(nextIndex)
      if (nextIndex === -1) {
        applyText(draftBeforeHistoryRef.current ?? '')
        draftBeforeHistoryRef.current = null
        return
      }

      applyText(history[nextIndex]?.content ?? '')
    },
    [applyText, history]
  )

  const navigateHistory = useCallback(
    (direction: InputHistoryDirection, currentText: string) => {
      const nextIndex = getNextInputHistoryIndex({
        currentIndex: historyIndex,
        direction,
        messagesLength: history.length
      })

      if (nextIndex === historyIndex) {
        return false
      }

      if (historyIndex === -1 && nextIndex !== -1) {
        draftBeforeHistoryRef.current = currentText
      }
      applyHistoryIndex(nextIndex)
      return true
    },
    [applyHistoryIndex, history.length, historyIndex]
  )

  const resetHistoryIndex = useCallback(() => {
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = null
  }, [])

  const saveHistory = useCallback(
    async (content: string) => {
      const normalizedContent = content.trim()
      if (!normalizedContent) {
        return
      }

      await saveInputHistory({ body: { content: normalizedContent } })
    },
    [saveInputHistory]
  )

  return {
    navigateHistory,
    resetHistoryIndex,
    saveHistory
  }
}
