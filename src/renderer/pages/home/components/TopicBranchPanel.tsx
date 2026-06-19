import { dataApiService } from '@data/DataApiService'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  buildTopicMessageFlowGraph,
  layoutTopicMessageFlowGraph,
  mergeTopicMessageFlowLiveTree,
  TopicMessageFlowCanvas
} from '@renderer/components/chat/messages/flow'
import type { TopicMessageFlowLiveState } from '@renderer/components/chat/messages/flow/topicMessageFlowLiveTree'
import { CommandContextMenu } from '@renderer/components/command'
import { DataApiError, ErrorCode } from '@shared/data/api'
import type { Message as DbMessage, TreeResponse } from '@shared/data/types/message'
import { CopyPlus, GitBranch } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  topicId: string
  topicName?: string
  liveState?: TopicMessageFlowLiveState | null
  focusKey?: string | number
  layoutReady?: boolean
  onLocateMessage?: (messageId: string) => void
  onStartBranchDraft?: (messageId: string) => Promise<void> | void
  onCancelBranchDraft?: (nextActiveNodeId?: string | null) => void
}

const logger = loggerService.withContext('TopicBranchPanel')

const emptyTree: TreeResponse = {
  activeNodeId: null,
  rootId: null,
  nodes: [],
  siblingsGroups: []
}

function getMessageIdFromContextMenuEvent(event: MouseEvent): string | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-message-id]')?.dataset.messageId ?? null
}

const TopicBranchPanel: FC<Props> = ({
  open,
  topicId,
  topicName,
  liveState,
  focusKey,
  layoutReady,
  onLocateMessage,
  onStartBranchDraft,
  onCancelBranchDraft
}) => {
  const { t } = useTranslation()
  const contextMenuMessageIdRef = useRef<string | null>(null)
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
  const { trigger: copyBranchToNewTopic } = useMutation('POST', '/topics/:id/duplicate', {
    refresh: ['/topics']
  })

  const tree = useMemo(
    () => mergeTopicMessageFlowLiveTree(data ?? emptyTree, liveState?.topicId === topicId ? liveState : null),
    [data, liveState, topicId]
  )
  const graph = useMemo(() => layoutTopicMessageFlowGraph(buildTopicMessageFlowGraph(tree)), [tree])
  const activeDraftAnchorId = useMemo(() => {
    if (liveState?.topicId !== topicId) return null
    return liveState.nodes.find((node) => node.isInputDraft && node.id === liveState.activeNodeId)?.parentId ?? null
  }, [liveState, topicId])

  const handleNodeSelect = useCallback(
    async (messageId: string) => {
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      if (activeDraftAnchorId) {
        if (messageId === activeDraftAnchorId) {
          onCancelBranchDraft?.(activeDraftAnchorId)
          onLocateMessage?.(messageId)
          return
        }
        onCancelBranchDraft?.()
      }

      if (!activeDraftAnchorId && selectedNode?.data.isOnActivePath) {
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
        onCancelBranchDraft?.(leafId)
        await setActiveNode({
          params: { id: topicId },
          body: { nodeId: leafId }
        })
        await refetch()
        onCancelBranchDraft?.()
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('setActiveBranch from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to set active branch from topic flow', err as Error)
        window.toast.error(t('common.error'))
      }
    },
    [activeDraftAnchorId, graph.nodes, onCancelBranchDraft, onLocateMessage, refetch, setActiveNode, t, topicId]
  )

  const handleStartNodeBranch = useCallback(
    async (messageId: string) => {
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      if (
        selectedNode?.data.role !== 'assistant' ||
        !selectedNode.data.hasAssistantDescendant ||
        messageId === graph.activeNodeId ||
        !onStartBranchDraft
      ) {
        return
      }

      try {
        await onStartBranchDraft(messageId)
        window.toast.success(t('chat.message.new.branch.created'))
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('startMessageBranch from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to start message branch from topic flow', err as Error)
        window.toast.error(t('common.error'))
      }
    },
    [graph.activeNodeId, graph.nodes, onStartBranchDraft, t, topicId]
  )

  const handleCopyBranchToNewTopic = useCallback(
    async (messageId: string) => {
      try {
        await copyBranchToNewTopic({
          params: { id: topicId },
          body: { nodeId: messageId }
        })
        window.toast.success(t('chat.message.flow.copy_topic.created'))
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('copyBranchToNewTopic from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to copy topic branch from topic flow', err as Error)
        window.toast.error(t('common.error'))
      }
    },
    [copyBranchToNewTopic, t, topicId]
  )

  const handleNodeContextMenu = useCallback((messageId: string) => {
    contextMenuMessageIdRef.current = messageId
  }, [])

  const getNodeContextMenuItems = useCallback(
    (event: MouseEvent) => {
      const messageId = getMessageIdFromContextMenuEvent(event) ?? contextMenuMessageIdRef.current
      contextMenuMessageIdRef.current = null
      if (!messageId) return []
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      const canStartBranch =
        !!onStartBranchDraft &&
        selectedNode?.data.role === 'assistant' &&
        !!selectedNode.data.hasAssistantDescendant &&
        messageId !== graph.activeNodeId

      const actions: ResolvedAction[] = [
        {
          id: 'topic-flow.start-branch',
          commandId: 'message.newBranch',
          label: t('chat.message.new.branch.label'),
          icon: <GitBranch size={14} />,
          group: 'branch',
          danger: false,
          availability: {
            visible: canStartBranch,
            enabled: true
          },
          children: []
        },
        {
          id: 'topic-flow.copy-topic',
          label: t('chat.message.flow.copy_topic.label'),
          icon: <CopyPlus size={14} />,
          group: 'copy',
          danger: false,
          availability: {
            visible: true,
            enabled: true
          },
          children: []
        }
      ]

      return actionsToCommandMenuExtraItems(actions, (action) => {
        if (!action.availability.enabled) return
        if (action.id === 'topic-flow.start-branch') {
          void handleStartNodeBranch(messageId)
          return
        }
        if (action.id === 'topic-flow.copy-topic') {
          void handleCopyBranchToNewTopic(messageId)
        }
      })
    },
    [graph.activeNodeId, graph.nodes, handleCopyBranchToNewTopic, handleStartNodeBranch, onStartBranchDraft, t]
  )

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) contextMenuMessageIdRef.current = null
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card text-card-foreground">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-border-subtle border-b px-3 text-xs">
        {topicName && (
          <>
            <span className="min-w-0 max-w-55 truncate text-foreground-muted">{topicName}</span>
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
          <CommandContextMenu
            location="webcontents.context"
            getExtraItems={getNodeContextMenuItems}
            onOpenChange={handleContextMenuOpenChange}>
            <div className="h-full min-h-0">
              <TopicMessageFlowCanvas
                className="h-full min-h-0 rounded-none border-0"
                focusKey={focusKey}
                graph={graph}
                layoutReady={layoutReady}
                onNodeContextMenu={handleNodeContextMenu}
                onNodeSelect={handleNodeSelect}
              />
            </div>
          </CommandContextMenu>
        )}
      </div>
    </div>
  )
}

export default TopicBranchPanel
