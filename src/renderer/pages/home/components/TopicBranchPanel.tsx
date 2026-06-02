import { dataApiService } from '@data/DataApiService'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import {
  buildTopicMessageFlowGraph,
  layoutTopicMessageFlowGraph,
  mergeTopicMessageFlowLiveTree,
  TopicMessageFlowCanvas
} from '@renderer/components/chat/messages/flow'
import type { TopicMessageFlowLiveState } from '@renderer/components/chat/messages/flow/topicMessageFlowLiveTree'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { Message as DbMessage, TreeResponse } from '@shared/data/types/message'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  topicId: string
  topicName?: string
  liveState?: TopicMessageFlowLiveState | null
  focusKey?: string | number
  layoutReady?: boolean
  onLocateMessage?: (messageId: string) => void
}

const logger = loggerService.withContext('TopicBranchPanel')

const emptyTree: TreeResponse = {
  activeNodeId: null,
  nodes: [],
  siblingsGroups: []
}

const TopicBranchPanel: FC<Props> = ({
  open,
  topicId,
  topicName,
  liveState,
  focusKey,
  layoutReady,
  onLocateMessage
}) => {
  const { t } = useTranslation()
  const messagesCachePath = `/topics/${topicId}/messages` as const
  const treeCachePath = `/topics/${topicId}/tree` as const
  const { data, error, isLoading, refetch } = useQuery('/topics/:topicId/tree', {
    enabled: open,
    params: { topicId },
    query: { depth: -1 }
  })
  const { trigger: setActiveNode } = useMutation('PUT', '/topics/:id/active-node', {
    refresh: [messagesCachePath, treeCachePath]
  })

  const tree = useMemo(
    () => mergeTopicMessageFlowLiveTree(data ?? emptyTree, liveState?.topicId === topicId ? liveState : null),
    [data, liveState, topicId]
  )
  const graph = useMemo(() => layoutTopicMessageFlowGraph(buildTopicMessageFlowGraph(tree)), [tree])

  const handleNodeSelect = useCallback(
    async (messageId: string) => {
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      if (selectedNode?.data.isOnActivePath) {
        onLocateMessage?.(messageId)
        return
      }

      let leafId = messageId
      try {
        const path = (await dataApiService.get(`/topics/${topicId}/path`, {
          query: { nodeId: messageId }
        })) as DbMessage[]
        if (path.length > 0) {
          leafId = path[path.length - 1].id
        }
        await setActiveNode({
          params: { id: topicId },
          body: { nodeId: leafId }
        })
        await refetch()
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('setActiveBranch from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to set active branch from topic flow', err as Error)
        window.toast.error(t('common.error'))
      }
    },
    [graph.nodes, onLocateMessage, refetch, setActiveNode, t, topicId]
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-border-subtle border-b px-3 text-xs">
        {topicName && (
          <>
            <span className="min-w-0 max-w-[220px] truncate text-foreground-muted">{topicName}</span>
            <span className="shrink-0 text-foreground-muted">·</span>
          </>
        )}
        <span className="shrink-0 text-foreground-muted">
          {graph.stats.branchCount} {t('chat.message.flow.branches', { defaultValue: 'branches' })}
        </span>
        <span className="shrink-0 text-foreground-muted">·</span>
        <span className="shrink-0 text-foreground-muted">
          {graph.stats.nodeCount} {t('chat.message.flow.nodes', { defaultValue: 'nodes' })}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full min-h-80 items-center justify-center text-destructive text-sm" role="alert">
            {t('common.error')}
          </div>
        ) : isLoading ? (
          <div className="flex h-full min-h-80 items-center justify-center text-foreground-muted text-sm">
            {t('common.loading')}
          </div>
        ) : (
          <TopicMessageFlowCanvas
            className="h-full min-h-0 rounded-none border-0"
            focusKey={focusKey}
            graph={graph}
            layoutReady={layoutReady}
            onNodeSelect={handleNodeSelect}
          />
        )}
      </div>
    </div>
  )
}

export default TopicBranchPanel
