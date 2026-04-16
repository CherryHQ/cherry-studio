/**
 * V2 hook for loading topic messages from DataApi as CherryUIMessage[].
 *
 * Uses useQuery (DataApi SWR) for standard data fetching.
 * Returns uiMessages for useChat initialMessages and refresh for post-stream sync.
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
      ...(shared.stats?.totalTokens ? { totalTokens: shared.stats.totalTokens } : {}),
      createdAt: shared.createdAt
    }
  }
}

export interface MessageMetadata {
  parentId: string | null
  modelId?: string
  siblingsGroupId?: number
  createdAt: string
  status: SharedMessage['status']
}

export type MessageMetadataMap = Record<string, MessageMetadata>

function flattenBranchMessages(items: BranchMessage[]): SharedMessage[] {
  const result: SharedMessage[] = []
  for (const item of items) {
    result.push(item.message)
    if (item.siblingsGroup) {
      for (const sibling of item.siblingsGroup) result.push(sibling)
    }
  }
  return result
}

// ── Hook ──

export interface UseTopicMessagesV2Result {
  uiMessages: CherryUIMessage[]
  metadataMap: MessageMetadataMap
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

    const entries = flattenBranchMessages(branchData.items)
    return Object.fromEntries(
      entries.map((message) => [
        message.id,
        {
          parentId: message.parentId,
          modelId: message.modelId ?? undefined,
          siblingsGroupId: message.siblingsGroupId || undefined,
          createdAt: message.createdAt,
          status: message.status
        }
      ])
    )
  }, [branchData])

  const refresh = useCallback(async (): Promise<CherryUIMessage[]> => {
    const result = (await mutate()) as BranchMessagesResponse | undefined
    if (!result?.items) return []
    return flattenBranchMessages(result.items).map(toUIMessage)
  }, [mutate])

  return {
    uiMessages,
    metadataMap,
    isLoading: isLoading || !isReady,
    refresh,
    activeNodeId: branchData?.activeNodeId ?? null
  }
}
