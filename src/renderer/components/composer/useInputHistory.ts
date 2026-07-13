import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useCallback, useRef, useState } from 'react'

import { getNextInputHistoryIndex, type InputHistoryDirection } from './inputHistoryNavigation'
import type { ComposerSerializedDraft } from './tokens'

export const INPUT_HISTORY_LIMIT = 20

interface UseInputHistoryApplyOptions {
  source: 'history' | 'draft'
}

interface UseInputHistoryOptions {
  applyDraft: (draft: ComposerSerializedDraft, options: UseInputHistoryApplyOptions) => void
}

export function useInputHistory({ applyDraft }: UseInputHistoryOptions) {
  const [historyIndex, setHistoryIndex] = useState(-1)
  const draftBeforeHistoryRef = useRef<ComposerSerializedDraft | null>(null)
  const navigationHistoryRef = useRef<string[] | null>(null)
  const [history, setHistory] = usePersistCache('ui.composer.input_history')

  const applyHistoryIndex = useCallback(
    (nextIndex: number) => {
      setHistoryIndex(nextIndex)
      if (nextIndex === -1) {
        applyDraft(draftBeforeHistoryRef.current ?? { text: '', tokens: [] }, { source: 'draft' })
        draftBeforeHistoryRef.current = null
        navigationHistoryRef.current = null
        return
      }

      const activeHistory = navigationHistoryRef.current ?? history
      const historyItem = activeHistory[nextIndex]
      if (!historyItem) {
        applyDraft(draftBeforeHistoryRef.current ?? { text: '', tokens: [] }, { source: 'draft' })
        draftBeforeHistoryRef.current = null
        navigationHistoryRef.current = null
        setHistoryIndex(-1)
        return
      }

      applyDraft({ text: historyItem, tokens: [] }, { source: 'history' })
    },
    [applyDraft, history]
  )

  const navigateHistory = useCallback(
    (direction: InputHistoryDirection, currentDraft: ComposerSerializedDraft) => {
      const activeHistory = navigationHistoryRef.current ?? history
      const nextIndex = getNextInputHistoryIndex({
        currentIndex: historyIndex,
        direction,
        messagesLength: activeHistory.length
      })

      if (nextIndex === historyIndex) {
        return historyIndex !== -1
      }

      if (historyIndex === -1 && nextIndex !== -1) {
        draftBeforeHistoryRef.current = currentDraft
        navigationHistoryRef.current = history
      }
      applyHistoryIndex(nextIndex)
      return true
    },
    [applyHistoryIndex, history, historyIndex]
  )

  const resetHistoryIndex = useCallback(() => {
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = null
    navigationHistoryRef.current = null
  }, [])

  const takeDraftBeforeHistory = useCallback(() => {
    // Consumers that replace the whole composer (for example message editing)
    // need the live draft captured before the currently visible history preview.
    const draft = draftBeforeHistoryRef.current
    setHistoryIndex(-1)
    draftBeforeHistoryRef.current = null
    navigationHistoryRef.current = null
    return draft
  }, [])

  const saveHistory = useCallback(
    async (content: string) => {
      const normalizedContent = content.trim()
      if (!normalizedContent) {
        return
      }

      setHistory((prev) =>
        [normalizedContent, ...prev.filter((item) => item !== normalizedContent)].slice(0, INPUT_HISTORY_LIMIT)
      )
    },
    [setHistory]
  )

  return {
    navigateHistory,
    resetHistoryIndex,
    takeDraftBeforeHistory,
    saveHistory
  }
}
