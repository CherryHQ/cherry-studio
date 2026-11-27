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
  restoreKnowledgeBaseSelection: (baseIds: readonly string[]) => void
  /** Whether the saved selection has been restored; draft writes must wait for this. */
  isKnowledgeBaseDraftHydrated: boolean
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
   */
  const restoreKnowledgeBaseSelection = useCallback(
    (baseIds: readonly string[]) => {
      const wanted = new Set(baseIds)
      setSelectedKnowledgeBases(selectableKnowledgeBases.filter((base) => wanted.has(base.id)))
    },
    [selectableKnowledgeBases, setSelectedKnowledgeBases]
  )

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
    knowledgeBaseIdsRef,
    syncKnowledgeBaseIds
  }
}
