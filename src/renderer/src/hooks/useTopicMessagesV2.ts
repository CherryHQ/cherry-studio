/**
 * V2 hook for loading topic messages from DataApi as CherryUIMessage[].
 *
 * Uses useQuery (DataApi SWR) for standard data fetching.
 * Returns uiMessages for useChat initialMessages and refresh for post-stream sync.
 */

import { useQuery } from '@renderer/data/hooks/useDataApi'
import type { CherryUIMessage, MessageStats, ModelSnapshot } from '@shared/data/types/message'
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
      ...(shared.stats?.totalTokens ? { totalTokens: shared.stats.totalTokens } : {}),
      createdAt: shared.createdAt
    }
  }
}

export interface MessageMetadata {
  parentId: string | null
  modelId?: string
  /**
   * Captured at message creation (`{id, name, provider, group?}`).
   * Primary reason to plumb this through: UI avatars + model labels read
   * `message.model.{provider,id,name}` via `getModelLogo`, and the live
   * provider config may no longer have this model (e.g. uninstalled
   * provider). The snapshot is the only stable source.
   */
  modelSnapshot?: ModelSnapshot
  siblingsGroupId?: number
  createdAt: string
  status: SharedMessage['status']
  /**
   * Persisted stats (tokens + durations). Kept in the metadataMap — not
   * on `CherryUIMessage.metadata` — because metadata on the UI message
   * only carries the subset agentLoop's `messageMetadata` callback
   * writes during streaming (tokens on `finish`), whereas the full
   * `MessageStats` (including time* fields computed at persist time)
   * only exists in the DB. Routing through metadataMap keeps the two
   * sources disjoint and avoids synthesising half-filled stats mid-stream.
   */
  stats?: MessageStats
}

export type MessageMetadataMap = Record<string, MessageMetadata>

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
  metadataMap: MessageMetadataMap
  /**
   * Map from any sibling member's id to the full ordered sibling group
   * (includes the member itself). Lets the sibling navigator render
   * `< i/N >` without reconstructing the group from metadataMap. Only
   * groups with ≥ 2 members are present.
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

  const metadataMap = useMemo<MessageMetadataMap>(() => {
    if (!branchData?.items) return {}

    // metadataMap must cover every sibling (not just the active branch) so
    // lookups for off-path messages (e.g. the navigator resolving a sibling
    // id) still work.
    const entries: SharedMessage[] = []
    for (const item of branchData.items) {
      entries.push(item.message)
      if (item.siblingsGroup) entries.push(...item.siblingsGroup)
    }
    return Object.fromEntries(
      entries.map((message) => [
        message.id,
        {
          parentId: message.parentId,
          modelId: message.modelId ?? undefined,
          modelSnapshot: message.modelSnapshot ?? undefined,
          siblingsGroupId: message.siblingsGroupId || undefined,
          createdAt: message.createdAt,
          status: message.status,
          stats: message.stats ?? undefined
        }
      ])
    )
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
    metadataMap,
    siblingsMap,
    isLoading: isLoading || !isReady,
    refresh,
    activeNodeId: branchData?.activeNodeId ?? null
  }
}
