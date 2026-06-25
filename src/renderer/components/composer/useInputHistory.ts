import { useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { useCallback, useRef, useState } from 'react'

import { getNextInputHistoryIndex, type InputHistoryDirection } from './inputHistoryNavigation'
import type { ComposerSerializedDraft } from './tokens'

interface UseInputHistoryOptions {
  applyDraft: (draft: ComposerSerializedDraft) => void
}

export function useInputHistory({ applyDraft }: UseInputHistoryOptions) {
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftBeforeHistoryRef = useRef<ComposerSerializedDraft | null>(null)
  const { data: history = [] } = useQuery('/input-history')
  const { trigger: saveInputHistory } = useMutation('POST', '/input-history', {
    refresh: ['/input-history']
  })

  const applyHistoryIndex = useCallback(
    (nextIndex: number) => {
      setHistoryIndex(nextIndex)
      if (nextIndex === -1) {
        applyDraft(draftBeforeHistoryRef.current ?? { text: '', tokens: [] })
        draftBeforeHistoryRef.current = null
        return
      }

      const historyItem = history[nextIndex]
      if (!historyItem) {
        applyDraft(draftBeforeHistoryRef.current ?? { text: '', tokens: [] })
        draftBeforeHistoryRef.current = null
        setHistoryIndex(-1)
        return
      }

      applyDraft({ text: historyItem.content, tokens: [] })
    },
    [applyDraft, history]
  )

  const navigateHistory = useCallback(
    (direction: InputHistoryDirection, currentDraft: ComposerSerializedDraft) => {
      const nextIndex = getNextInputHistoryIndex({
        currentIndex: historyIndex,
        direction,
        messagesLength: history.length
      })

      if (nextIndex === historyIndex) {
        return false
      }

      if (historyIndex === -1 && nextIndex !== -1) {
        draftBeforeHistoryRef.current = currentDraft
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
