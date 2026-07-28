import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef } from 'react'

import type { ComposerDraftToken } from '../../tokens'
import { composerKnowledgeBaseTokenId, knowledgeBaseToComposerToken } from './composerTokens'

const KNOWLEDGE_BASE_IDS_KEY_SEPARATOR = '\u0000'

interface UseComposerKnowledgeBaseScopeParams {
  /** Knowledge base ids configured on the active assistant or Agent. */
  configuredKnowledgeBaseIds: readonly string[] | undefined
  allKnowledgeBases: KnowledgeBase[]
  isKnowledgeBasesLoading: boolean
  /** Set once the knowledge-base query has failed. See `areKnowledgeBasesUnusable` below. */
  knowledgeBasesError?: unknown
  scopeKey: string
  selectedKnowledgeBases: KnowledgeBase[]
  setSelectedKnowledgeBases: Dispatch<SetStateAction<KnowledgeBase[]>>
}

interface UseComposerKnowledgeBaseScopeResult {
  selectableKnowledgeBases: KnowledgeBase[]
  selectedKnowledgeBasesInScope: KnowledgeBase[]
  resolveKnowledgeBaseMarker: (marker: string) => ComposerDraftToken | null
  restoreKnowledgeBaseSelection: (baseIds: readonly string[]) => void
}

/** Owns knowledge-base availability, marker resolution, and selection pruning for one composer scope. */
export function useComposerKnowledgeBaseScope({
  configuredKnowledgeBaseIds,
  allKnowledgeBases,
  isKnowledgeBasesLoading,
  knowledgeBasesError,
  scopeKey,
  selectedKnowledgeBases,
  setSelectedKnowledgeBases
}: UseComposerKnowledgeBaseScopeParams): UseComposerKnowledgeBaseScopeResult {
  const selectedKnowledgeBasesScopeKeyRef = useRef<string | null>(null)
  const pendingRestoreKnowledgeBaseIdsRef = useRef<readonly string[] | null>(null)

  const configuredKnowledgeBaseIdsKey = (configuredKnowledgeBaseIds ?? []).join(KNOWLEDGE_BASE_IDS_KEY_SEPARATOR)
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
      if (configuredKnowledgeBaseIdSet.size === 0)
        return bases.filter((base) => isKnowledgeBasesLoading || availableKnowledgeBaseIdSet.has(base.id))
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
      map.set(composerKnowledgeBaseTokenId(base), base)
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
  const isSelectedKnowledgeBasesScopeCurrent = selectedKnowledgeBasesScopeKeyRef.current === scopeKey
  const selectedKnowledgeBasesInScope = useMemo(
    () => (isSelectedKnowledgeBasesScopeCurrent ? filterSelectableKnowledgeBases(selectedKnowledgeBases) : []),
    [filterSelectableKnowledgeBases, isSelectedKnowledgeBasesScopeCurrent, selectedKnowledgeBases]
  )

  const applyKnowledgeBaseSelection = useCallback(
    (baseIds: readonly string[]) => {
      const wanted = new Set(baseIds)
      setSelectedKnowledgeBases(selectableKnowledgeBases.filter((base) => wanted.has(base.id)))
    },
    [selectableKnowledgeBases, setSelectedKnowledgeBases]
  )

  /**
   * The bases cannot be mapped yet — either still loading, or the query failed. The failed case needs
   * naming because it does NOT look like one: the knowledge-base query runs with
   * `shouldRetryOnError: false`, so a rejected fetch settles at `isLoading === false` with an empty
   * list and never retries, i.e. indistinguishable from "the user has no knowledge bases".
   */
  const areKnowledgeBasesUnusable =
    isKnowledgeBasesLoading || (knowledgeBasesError != null && allKnowledgeBases.length === 0)

  /**
   * Re-select a persisted scope by id — used when editing a queued follow-up back into the composer.
   * The follow-up queue outlives a reload, so a restore can land before the bases are usable; mapping
   * ids through the then-empty list would drop the entire scope, and the queue entry is discarded
   * right after, making the loss unrecoverable. Park the ids and apply them on arrival instead.
   */
  const restoreKnowledgeBaseSelection = useCallback(
    (baseIds: readonly string[]) => {
      if (areKnowledgeBasesUnusable) {
        pendingRestoreKnowledgeBaseIdsRef.current = baseIds
        return
      }
      pendingRestoreKnowledgeBaseIdsRef.current = null
      applyKnowledgeBaseSelection(baseIds)
    },
    [applyKnowledgeBaseSelection, areKnowledgeBasesUnusable]
  )

  useEffect(() => {
    const scopeChanged = selectedKnowledgeBasesScopeKeyRef.current !== scopeKey
    selectedKnowledgeBasesScopeKeyRef.current = scopeKey
    // A pending restore belongs to the scope it was captured in — never replay it into a new one.
    if (scopeChanged) pendingRestoreKnowledgeBaseIdsRef.current = null
    setSelectedKnowledgeBases((prev) => {
      const next = scopeChanged ? [] : filterSelectableKnowledgeBases(prev)
      if (next.length === prev.length && next.every((base, index) => base.id === prev[index]?.id)) return prev
      return next
    })
  }, [filterSelectableKnowledgeBases, scopeKey, setSelectedKnowledgeBases])

  // Declared after the pruning effect so a landing restore wins over the prune of the empty selection
  // it is replacing.
  useEffect(() => {
    const pending = pendingRestoreKnowledgeBaseIdsRef.current
    if (!pending || areKnowledgeBasesUnusable) return
    pendingRestoreKnowledgeBaseIdsRef.current = null
    applyKnowledgeBaseSelection(pending)
  }, [applyKnowledgeBaseSelection, areKnowledgeBasesUnusable])

  return {
    selectableKnowledgeBases,
    selectedKnowledgeBasesInScope,
    resolveKnowledgeBaseMarker,
    restoreKnowledgeBaseSelection
  }
}
