import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { ComposerDraftToken } from '../../tokens'
import { composerKnowledgeBaseTokenId, knowledgeBaseToComposerToken } from './composerTokens'

const KNOWLEDGE_BASE_IDS_KEY_SEPARATOR = '\u0000'

interface UseComposerKnowledgeBaseScopeParams {
  /** Knowledge base ids configured on the active assistant or Agent. */
  configuredKnowledgeBaseIds: readonly string[] | undefined
  allKnowledgeBases: KnowledgeBase[]
  isKnowledgeBasesLoading: boolean
  scopeKey: string
  selectedKnowledgeBases: KnowledgeBase[]
  setSelectedKnowledgeBases: Dispatch<SetStateAction<KnowledgeBase[]>>
  /** Ids saved in the draft cache, restored once the knowledge bases have loaded. */
  initialKnowledgeBaseIds: readonly string[]
  /**
   * The caller remounts this hook whenever `scopeKey` changes — the Agent composer's tool provider is
   * keyed by agent + session, the same granularity as the scope. That makes a selection already
   * present at mount a draft-cache seed belonging to `scopeKey`, to be pruned like any other, rather
   * than another conversation's leftover to clear. Chat keeps one provider across topics and so omits
   * this.
   */
  remountsOnScopeChange?: boolean
}

interface UseComposerKnowledgeBaseScopeResult {
  selectableKnowledgeBases: KnowledgeBase[]
  selectedKnowledgeBasesInScope: KnowledgeBase[]
  resolveKnowledgeBaseMarker: (marker: string) => ComposerDraftToken | null
  restoreKnowledgeBaseSelection: (baseIds: readonly string[], options?: { retryUnavailable?: boolean }) => void
  /** Whether the saved selection has been restored; draft writes must wait for this. */
  isKnowledgeBaseDraftHydrated: boolean
  /** True while a restored draft still has knowledge-base ids waiting on the loading catalog. */
  hasPendingKnowledgeBaseRestore: boolean
  /** Drops restored ids still waiting on the catalog; for content replaced without a restore. */
  clearPendingKnowledgeBaseRestore: () => void
  /** Ids to persist with the draft, including saved ids that are not selectable right now. */
  knowledgeBaseIdsRef: RefObject<string[]>
  /** Folds the current selection into `knowledgeBaseIdsRef`, keeping ids that are unavailable for now. */
  syncKnowledgeBaseIds: () => void
}

/**
 * Owns knowledge-base availability, marker resolution, selection pruning, and the draft's saved
 * knowledge-base ids for one composer scope.
 */
export function useComposerKnowledgeBaseScope({
  configuredKnowledgeBaseIds,
  allKnowledgeBases,
  isKnowledgeBasesLoading,
  scopeKey,
  selectedKnowledgeBases,
  setSelectedKnowledgeBases,
  initialKnowledgeBaseIds,
  remountsOnScopeChange
}: UseComposerKnowledgeBaseScopeParams): UseComposerKnowledgeBaseScopeResult {
  const selectedKnowledgeBasesScopeKeyRef = useRef<string | null>(remountsOnScopeChange ? scopeKey : null)
  const knowledgeBaseIdsRef = useRef([...initialKnowledgeBaseIds])
  const observedKnowledgeBaseSelectionKeyRef = useRef<string | null>(
    initialKnowledgeBaseIds.length === 0 ? JSON.stringify([]) : null
  )
  const [isKnowledgeBaseDraftHydrated, setIsKnowledgeBaseDraftHydrated] = useState(initialKnowledgeBaseIds.length === 0)

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

  /**
   * Re-select a persisted scope by id — used when editing a queued follow-up back into the composer.
   * Mapped through `selectableKnowledgeBases`, not the raw list, so a payload naming a base the
   * assistant no longer configures cannot come back as a checked-but-unsendable pick.
   *
   * With `retryUnavailable` (explicit draft restores), ids the catalog cannot offer yet are kept
   * with the draft and retried on availability changes: knowledge loading can be disabled (empty
   * composer) until a restored draft needs it, and dropping the ids here would strip their
   * still-unmatched tokens instead. Draft-cache hydration leaves this off so an unavailable saved
   * id stays persisted-but-unselected.
   */
  const [pendingKnowledgeBaseRestoreIds, setPendingKnowledgeBaseRestoreIds] = useState<readonly string[] | null>(null)
  const restoreKnowledgeBaseSelection = useCallback(
    (baseIds: readonly string[], options?: { retryUnavailable?: boolean }) => {
      const wanted = new Set(baseIds)
      const restored = selectableKnowledgeBases.filter((base) => wanted.has(base.id))
      if (options?.retryUnavailable) {
        const restoredIds = new Set(restored.map((base) => base.id))
        const pending = baseIds.filter((id) => !restoredIds.has(id))
        setPendingKnowledgeBaseRestoreIds(pending.length > 0 ? pending : null)
        knowledgeBaseIdsRef.current = [...new Set([...knowledgeBaseIdsRef.current, ...baseIds])]
      } else {
        // A plain restore replaces the composer content: a retry still pending from previous
        // content must not merge its ids into the replacement when the catalog later offers them.
        setPendingKnowledgeBaseRestoreIds(null)
      }
      setSelectedKnowledgeBases(restored)
    },
    [selectableKnowledgeBases, setSelectedKnowledgeBases]
  )

  /** Drops restored ids still waiting on the catalog; for content replaced without a restore. */
  const clearPendingKnowledgeBaseRestore = useCallback(() => {
    setPendingKnowledgeBaseRestoreIds(null)
  }, [])

  // Retry restored ids the catalog could not offer when the restore ran.
  useEffect(() => {
    if (!pendingKnowledgeBaseRestoreIds || pendingKnowledgeBaseRestoreIds.length === 0) return
    const wanted = new Set(pendingKnowledgeBaseRestoreIds)
    const restorable = selectableKnowledgeBases.filter((base) => wanted.has(base.id))
    if (restorable.length === 0) return
    const restorableIds = new Set(restorable.map((base) => base.id))
    const remaining = pendingKnowledgeBaseRestoreIds.filter((id) => !restorableIds.has(id))
    setPendingKnowledgeBaseRestoreIds(remaining.length > 0 ? remaining : null)
    setSelectedKnowledgeBases((prev) => {
      const merged = [...prev, ...restorable.filter((base) => !prev.some((current) => current.id === base.id))]
      return merged.length === prev.length ? prev : merged
    })
  }, [pendingKnowledgeBaseRestoreIds, selectableKnowledgeBases, setSelectedKnowledgeBases])

  // Draft-persist effects see selection changes only through this identity, so it must keep these deps.
  const syncKnowledgeBaseIds = useCallback(() => {
    const selectedKnowledgeBaseIds = selectedKnowledgeBasesInScope.map((base) => base.id)
    const selectedKnowledgeBaseIdsKey = JSON.stringify(selectedKnowledgeBaseIds)
    if (observedKnowledgeBaseSelectionKeyRef.current === null) {
      observedKnowledgeBaseSelectionKeyRef.current = selectedKnowledgeBaseIdsKey
    } else if (observedKnowledgeBaseSelectionKeyRef.current !== selectedKnowledgeBaseIdsKey) {
      observedKnowledgeBaseSelectionKeyRef.current = selectedKnowledgeBaseIdsKey
      const selectableKnowledgeBaseIdSet = new Set(selectableKnowledgeBases.map((base) => base.id))
      const unresolvedKnowledgeBaseIds = knowledgeBaseIdsRef.current.filter(
        (id) => !selectableKnowledgeBaseIdSet.has(id)
      )
      knowledgeBaseIdsRef.current = [...new Set([...unresolvedKnowledgeBaseIds, ...selectedKnowledgeBaseIds])]
    }
  }, [selectableKnowledgeBases, selectedKnowledgeBasesInScope])

  useEffect(() => {
    const scopeChanged = selectedKnowledgeBasesScopeKeyRef.current !== scopeKey
    selectedKnowledgeBasesScopeKeyRef.current = scopeKey
    if (scopeChanged) {
      // An assistant switch inside the same topic does not remount this hook: drop a restore
      // still pending from the previous scope so its ids cannot merge into the new selection.
      setPendingKnowledgeBaseRestoreIds(null)
    }
    setSelectedKnowledgeBases((prev) => {
      const next = scopeChanged ? [] : filterSelectableKnowledgeBases(prev)
      if (next.length === prev.length && next.every((base, index) => base.id === prev[index]?.id)) return prev
      return next
    })
  }, [filterSelectableKnowledgeBases, scopeKey, setSelectedKnowledgeBases])

  useEffect(() => {
    if (isKnowledgeBaseDraftHydrated || isKnowledgeBasesLoading) return

    const wantedIds = new Set(initialKnowledgeBaseIds)
    const restoredIds = selectableKnowledgeBases.filter((base) => wantedIds.has(base.id)).map((base) => base.id)
    observedKnowledgeBaseSelectionKeyRef.current = JSON.stringify(restoredIds)
    restoreKnowledgeBaseSelection(initialKnowledgeBaseIds)
    setIsKnowledgeBaseDraftHydrated(true)
  }, [
    initialKnowledgeBaseIds,
    isKnowledgeBaseDraftHydrated,
    isKnowledgeBasesLoading,
    restoreKnowledgeBaseSelection,
    selectableKnowledgeBases
  ])

  return {
    selectableKnowledgeBases,
    selectedKnowledgeBasesInScope,
    resolveKnowledgeBaseMarker,
    restoreKnowledgeBaseSelection,
    isKnowledgeBaseDraftHydrated,
    hasPendingKnowledgeBaseRestore: pendingKnowledgeBaseRestoreIds !== null && isKnowledgeBasesLoading,
    clearPendingKnowledgeBaseRestore,
    knowledgeBaseIdsRef,
    syncKnowledgeBaseIds
  }
}
