import { useCallback, useEffect, useState } from 'react'

import { cacheService } from '@data/CacheService'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'

import type { ComposerSerializedDraft } from './tokens'

export interface SavedDraftItem {
  id: string
  draft: ComposerSerializedDraft
  files: ComposerAttachment[]
  /**
   * Knowledge-base ids selected when the draft was parked. Restored on Edit so the draft keeps
   * its knowledge scope; absent only on drafts saved before this field existed, which leave the
   * current selection untouched.
   */
  knowledgeBaseIds?: string[]
}

const keyFor = (scopeKey: string) => `saved-drafts.${scopeKey}`
const EMPTY_DRAFTS: SavedDraftItem[] = []

function loadDrafts(scopeKey: string): SavedDraftItem[] {
  const cached = cacheService.getCasual<SavedDraftItem[]>(keyFor(scopeKey))
  return Array.isArray(cached) ? cached : EMPTY_DRAFTS
}

export interface SavedDraftsController {
  items: SavedDraftItem[]
  save: (draft: ComposerSerializedDraft, files: ComposerAttachment[], knowledgeBaseIds?: string[]) => void
  remove: (id: string) => void
}

/**
 * Per-conversation list of parked composer drafts: local notes that are never sent until the user
 * restores one into the composer. Shares the per-window casual cache tier with the followup queue.
 */
export function useSavedDrafts(scopeKey: string): SavedDraftsController {
  const [state, setState] = useState(() => ({ scopeKey, items: loadDrafts(scopeKey) }))

  useEffect(() => {
    const reload = () => {
      const items = loadDrafts(scopeKey)
      setState((current) => (current.scopeKey === scopeKey && current.items === items ? current : { scopeKey, items }))
    }
    const unsubscribe = cacheService.subscribe(keyFor(scopeKey), reload)
    reload()
    return unsubscribe
  }, [scopeKey])

  const save = useCallback(
    (draft: ComposerSerializedDraft, files: ComposerAttachment[], knowledgeBaseIds?: string[]) => {
      cacheService.setCasual(keyFor(scopeKey), [
        ...loadDrafts(scopeKey),
        { id: crypto.randomUUID(), draft, files, knowledgeBaseIds: knowledgeBaseIds ?? [] }
      ])
    },
    [scopeKey]
  )
  const remove = useCallback(
    (id: string) => {
      cacheService.setCasual(
        keyFor(scopeKey),
        loadDrafts(scopeKey).filter((item) => item.id !== id)
      )
    },
    [scopeKey]
  )

  return { items: state.scopeKey === scopeKey ? state.items : loadDrafts(scopeKey), save, remove }
}
