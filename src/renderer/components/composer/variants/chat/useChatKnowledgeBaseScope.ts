import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef } from 'react'

import type { ComposerDraftToken } from '../../tokens'
import { chatComposerTokenId, knowledgeBaseToComposerToken } from '../chatComposerTokens'

const KNOWLEDGE_BASE_IDS_KEY_SEPARATOR = '\u0000'

interface UseChatKnowledgeBaseScopeParams {
  /** Knowledge base ids configured on the active assistant. */
  assistantKnowledgeBaseIds: readonly string[] | undefined
  allKnowledgeBases: KnowledgeBase[]
  isKnowledgeBasesLoading: boolean
  topicId: string
  selectedAssistantId: string | null
  selectedKnowledgeBases: KnowledgeBase[]
  setSelectedKnowledgeBases: Dispatch<SetStateAction<KnowledgeBase[]>>
}

interface UseChatKnowledgeBaseScopeResult {
  selectableKnowledgeBases: KnowledgeBase[]
  selectedKnowledgeBasesInScope: KnowledgeBase[]
  resolveKnowledgeBaseMarker: (marker: string) => ComposerDraftToken | null
}

/**
 * Owns the chat composer's knowledge-base scoping: which configured-and-available bases are
 * selectable, the marker resolver, and the per-(topic+assistant) scope reset that prunes the
 * selection. Extracted verbatim from ChatComposer — chat-only.
 */
export function useChatKnowledgeBaseScope({
  assistantKnowledgeBaseIds,
  allKnowledgeBases,
  isKnowledgeBasesLoading,
  topicId,
  selectedAssistantId,
  selectedKnowledgeBases,
  setSelectedKnowledgeBases
}: UseChatKnowledgeBaseScopeParams): UseChatKnowledgeBaseScopeResult {
  const selectedKnowledgeBasesScopeKeyRef = useRef<string | null>(null)
  const selectedKnowledgeBasesScopeKey = `${topicId}:${selectedAssistantId ?? 'no-assistant'}`

  const configuredKnowledgeBaseIdsKey = (assistantKnowledgeBaseIds ?? []).join(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR)
  const configuredKnowledgeBaseIdSet = useMemo(
    () =>
      new Set(
        configuredKnowledgeBaseIdsKey ? configuredKnowledgeBaseIdsKey.split(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR) : []
      ),
    [configuredKnowledgeBaseIdsKey]
  )
  const availableKnowledgeBaseIdsKey = useMemo(
    () => allKnowledgeBases.map((base) => base.id).join(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR),
    [allKnowledgeBases]
  )
  const availableKnowledgeBaseIdSet = useMemo(
    () =>
      new Set(availableKnowledgeBaseIdsKey ? availableKnowledgeBaseIdsKey.split(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR) : []),
    [availableKnowledgeBaseIdsKey]
  )
  const filterSelectableKnowledgeBases = useCallback(
    (bases: readonly KnowledgeBase[]) => {
      if (configuredKnowledgeBaseIdSet.size === 0) return []
      return bases.filter(
        (base) =>
          configuredKnowledgeBaseIdSet.has(base.id) &&
          (isKnowledgeBasesLoading || availableKnowledgeBaseIdSet.has(base.id))
      )
    },
    [availableKnowledgeBaseIdSet, configuredKnowledgeBaseIdSet, isKnowledgeBasesLoading]
  )
  const selectableKnowledgeBases = useMemo(
    () => filterSelectableKnowledgeBases(allKnowledgeBases),
    [allKnowledgeBases, filterSelectableKnowledgeBases]
  )
  const knowledgeBaseMarkerMap = useMemo(() => {
    const map = new Map<string, KnowledgeBase>()
    selectableKnowledgeBases.forEach((base) => {
      map.set(base.id, base)
      map.set(base.name, base)
      map.set(chatComposerTokenId.knowledge(base), base)
    })
    return map
  }, [selectableKnowledgeBases])
  const resolveKnowledgeBaseMarker = useCallback(
    (marker: string): ComposerDraftToken | null => {
      const base = knowledgeBaseMarkerMap.get(marker)
      return base ? knowledgeBaseToComposerToken(base) : null
    },
    [knowledgeBaseMarkerMap]
  )
  const isSelectedKnowledgeBasesScopeCurrent =
    selectedKnowledgeBasesScopeKeyRef.current === selectedKnowledgeBasesScopeKey
  const selectedKnowledgeBasesInScope = useMemo(
    () => (isSelectedKnowledgeBasesScopeCurrent ? filterSelectableKnowledgeBases(selectedKnowledgeBases) : []),
    [filterSelectableKnowledgeBases, isSelectedKnowledgeBasesScopeCurrent, selectedKnowledgeBases]
  )

  useEffect(() => {
    const scopeChanged = selectedKnowledgeBasesScopeKeyRef.current !== selectedKnowledgeBasesScopeKey
    selectedKnowledgeBasesScopeKeyRef.current = selectedKnowledgeBasesScopeKey
    setSelectedKnowledgeBases((prev) => {
      const next = scopeChanged ? [] : filterSelectableKnowledgeBases(prev)
      if (next.length === prev.length && next.every((base, index) => base.id === prev[index]?.id)) return prev
      return next
    })
  }, [filterSelectableKnowledgeBases, selectedKnowledgeBasesScopeKey, setSelectedKnowledgeBases])

  return { selectableKnowledgeBases, selectedKnowledgeBasesInScope, resolveKnowledgeBaseMarker }
}
