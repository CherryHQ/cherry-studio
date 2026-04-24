/**
 * V2 hook for loading topic messages from DataApi as CherryUIMessage[].
 *
 * Uses useQuery (DataApi SWR) for standard data fetching. `toUIMessage`
 * projects every persisted field onto `CherryUIMessage.metadata`, so
 * downstream consumers read per-message metadata (model, parent, stats,
 * status, …) directly from the message object — no parallel metadataMap
 * lookup that can lag behind `useChat.state.messages` during streaming.
 */

import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { BranchMessage, BranchMessagesResponse, Message as SharedMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useMemo, useState } from 'react'

const FETCH_LIMIT = 999

// ── Converters ──

function toUIMessage(shared: SharedMessage): CherryUIMessage {
  return {
    id: shared.id,
    role: shared.role,
    parts: (shared.data?.parts ?? []) as CherryUIMessage['parts'],
    metadata: {
      parentId: shared.parentId,
      siblingsGroupId: shared.siblingsGroupId || undefined,
      modelId: shared.modelId ?? undefined,
      modelSnapshot: shared.modelSnapshot ?? undefined,
      status: shared.status,
      createdAt: shared.createdAt,
      stats: shared.stats ?? undefined,
      ...(shared.stats?.totalTokens ? { totalTokens: shared.stats.totalTokens } : {})
    }
  }
}

/**
 * Heuristic: an assistant sibling group is a **regenerate** cohort (alternate
 * branches produced by retrying the same model) when its members include any
 * duplicate `modelId`. Multi-model cohorts (user @mentioned N distinct models
 * in one turn) have all-distinct `modelId`s and so are excluded.
 *
 * This lets us tell apart "show all side-by-side" (multi-model) from "show
 * one with `< i/N >` navigator" (regenerate) without adding a schema field.
 * Missing `modelId`s are treated as distinct (best-effort — assistants always
 * have a model set at reservation, so this is mainly a defensive branch).
 */
function isRegenerateGroup(members: SharedMessage[]): boolean {
  if (members.length < 2) return false
  const modelIds = members.map((m) => m.modelId).filter((id): id is string => Boolean(id))
  return new Set(modelIds).size < modelIds.length
}

/**
 * Flatten a branch response into a renderer-friendly message list.
 *
 * Visibility rule per sibling group:
 * - User siblings: alternate conversation branches — only the active one is
 *   in view; off-path branches are surfaced via the sibling navigator.
 * - Assistant multi-model siblings (all distinct models): all visible; they
 *   render together in `MessageGroup` with a model tab bar.
 * - Assistant regenerate siblings (duplicate models): only the active one is
 *   in view; the rest live off-path and are surfaced via the navigator.
 */
function flattenBranchMessages(items: BranchMessage[]): SharedMessage[] {
  const result: SharedMessage[] = []
  for (const item of items) {
    result.push(item.message)
    if (!item.siblingsGroup || item.siblingsGroup.length === 0) continue
    if (item.message.role === 'user') continue
    const group = [item.message, ...item.siblingsGroup]
    if (isRegenerateGroup(group)) continue
    for (const sibling of item.siblingsGroup) result.push(sibling)
  }
  return result
}

/**
 * Build a map keyed by each sibling member's id, where the value is the
 * complete ordered group (including the member itself). Members are sorted
 * by `createdAt` so navigator position (`< 2/3 >`) is stable and matches
 * the order in which branches were created.
 *
 * Only groups that the navigator should control are emitted: user sibling
 * groups and assistant regenerate cohorts. Multi-model cohorts use the
 * MessageGroup tab bar instead and are omitted.
 */
function buildSiblingsMap(items: BranchMessage[]): Record<string, SharedMessage[]> {
  const map: Record<string, SharedMessage[]> = {}
  for (const item of items) {
    if (!item.siblingsGroup || item.siblingsGroup.length === 0) continue
    const group = [item.message, ...item.siblingsGroup].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    if (item.message.role !== 'user' && !isRegenerateGroup(group)) continue
    for (const member of group) {
      map[member.id] = group
    }
  }
  return map
}

// ── Hook ──

export interface UseTopicMessagesV2Result {
  uiMessages: CherryUIMessage[]
  /**
   * Map from any sibling member's id to the full ordered sibling group
   * (includes the member itself). Lets the sibling navigator render
   * `< i/N >` without reconstructing the group on the fly. Only groups
   * with ≥ 2 members are present.
   */
  siblingsMap: Record<string, SharedMessage[]>
  isLoading: boolean
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
}

export function useTopicMessagesV2(topicId: string): UseTopicMessagesV2Result {
  const { data, isLoading, mutate } = useQuery(`/topics/${topicId}/messages`, {
    query: { limit: FETCH_LIMIT, includeSiblings: true },
    swrOptions: { dedupingInterval: 0 }
  })

  // On remount with stale SWR cache, isLoading=false but data is stale.
  // Force a fresh fetch and track readiness so the loading gate blocks until fresh.
  const [isReady, setIsReady] = useState(false)
  useEffect(() => {
    setIsReady(false)
    void mutate().then(() => setIsReady(true))
  }, [topicId]) // eslint-disable-line react-hooks/exhaustive-deps -- mutate is stable

  const branchData = data as BranchMessagesResponse | undefined

  const uiMessages = useMemo<CherryUIMessage[]>(() => {
    if (!branchData?.items) return []
    return flattenBranchMessages(branchData.items).map(toUIMessage)
  }, [branchData])

  const siblingsMap = useMemo<Record<string, SharedMessage[]>>(
    () => (branchData?.items ? buildSiblingsMap(branchData.items) : {}),
    [branchData]
  )

  const refresh = useCallback(async (): Promise<CherryUIMessage[]> => {
    const result = (await mutate()) as BranchMessagesResponse | undefined
    if (!result?.items) return []
    return flattenBranchMessages(result.items).map(toUIMessage)
  }, [mutate])

  return {
    uiMessages,
    siblingsMap,
    isLoading: isLoading || !isReady,
    refresh,
    activeNodeId: branchData?.activeNodeId ?? null
  }
}
