import { CopyPlus, GitBranch } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  buildTopicMessageFlowGraph,
  layoutTopicMessageFlowGraph,
  mergeTopicMessageFlowLiveTree,
  TopicMessageFlowCanvas,
  type TopicMessageFlowLiveState
} from '@renderer/components/chat/flow'
import { CommandContextMenu } from '@renderer/components/command'
import DeleteIcon from '@renderer/components/icons/DeleteIcon'
import { toast } from '@renderer/services/toast'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { Message as DbMessage, TreeResponse } from '@shared/data/types/message'

import { useTopicBranchActions } from '../hooks/useTopicBranchActions'
import { planBranchDeletion } from '../utils/topicBranchDeletion'

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
  onLocateMessage
}) => {
  const { t } = useTranslation()
  const contextMenuMessageIdRef = useRef<string | null>(null)
  const [deletionTarget, setDeletionTarget] = useState<{
    topicId: string
    messageId: string
    awaitingInputOnly: boolean
  } | null>(null)
  const deletingRef = useRef(false)
  const [isDeleting, setIsDeleting] = useState(false)
  useEffect(() => {
    setDeletionTarget(null)
  }, [open, topicId])
  const messagesCachePath = `/topics/${topicId}/messages` as const
  const treeCachePath = `/topics/${topicId}/tree` as const
  const { data, error, isLoading, refetch } = useQuery('/topics/:topicId/tree', {
    enabled: open,
    params: { topicId }
  })
  useDataChange(
    '/topics/:topicId/tree',
    () => {
      if (open) void refetch()
    },
    { routeParams: { topicId } }
  )
  const { trigger: setActiveNode } = useMutation('PUT', '/topics/:id/active-node', {
    refresh: [messagesCachePath, treeCachePath]
  })
  const { trigger: copyBranchToNewTopic } = useMutation('POST', '/topics/:id/duplicate', {
    refresh: ['/topics']
  })
  const { reserveBranch, deleteBranch } = useTopicBranchActions(topicId)

  const tree = useMemo(
    () => mergeTopicMessageFlowLiveTree(data ?? emptyTree, liveState?.topicId === topicId ? liveState : null),
    [data, liveState, topicId]
  )
  const graph = useMemo(() => layoutTopicMessageFlowGraph(buildTopicMessageFlowGraph(tree)), [tree])

  const handleNodeSelect = useCallback(
    async (messageId: string) => {
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      if (selectedNode?.data.isAwaitingInput && messageId === graph.activeNodeId) return
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
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('setActiveBranch from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to set active branch from topic flow', err as Error)
        toast.error(t('common.error'))
      }
    },
    [graph.activeNodeId, graph.nodes, onLocateMessage, setActiveNode, t, topicId]
  )

  const handleStartNodeBranch = useCallback(
    async (messageId: string) => {
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      if (selectedNode?.data.role !== 'assistant') {
        return
      }

      try {
        await reserveBranch(messageId)
        toast.success(t('chat.message.new.branch.created'))
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('startMessageBranch from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to start message branch from topic flow', err as Error)
        toast.error(t('common.error'))
      }
    },
    [graph.nodes, reserveBranch, t, topicId]
  )

  const handleCopyBranchToNewTopic = useCallback(
    async (messageId: string) => {
      try {
        await copyBranchToNewTopic({
          params: { id: topicId },
          body: { nodeId: messageId }
        })
        toast.success(t('chat.message.flow.copy_topic.created'))
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('copyBranchToNewTopic from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to copy topic branch from topic flow', err as Error)
        toast.error(t('common.error'))
      }
    },
    [copyBranchToNewTopic, t, topicId]
  )

  const handleConfirmDeleteBranch = useCallback(async () => {
    if (!open || !deletionTarget || deletionTarget.topicId !== topicId || deletingRef.current) return false
    const { messageId, awaitingInputOnly } = deletionTarget
    deletingRef.current = true
    setIsDeleting(true)
    try {
      await deleteBranch(messageId, awaitingInputOnly)
      toast.success(t('common.delete_success'))
    } catch (err) {
      if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
        logger.warn('deleteBranch from topic flow on missing message', { messageId, topicId })
        return true
      }
      logger.error('Failed to delete topic branch from topic flow', err as Error)
      toast.error(t('common.delete_failed'))
    } finally {
      deletingRef.current = false
      setIsDeleting(false)
      setDeletionTarget(null)
    }
    return true
  }, [deleteBranch, deletionTarget, open, t, topicId])

  const handleNodeContextMenu = useCallback((messageId: string) => {
    contextMenuMessageIdRef.current = messageId
  }, [])

  const getNodeContextMenuItems = useCallback(
    (event: MouseEvent) => {
      const messageId = getMessageIdFromContextMenuEvent(event) ?? contextMenuMessageIdRef.current
      contextMenuMessageIdRef.current = null
      if (!messageId) return []
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      const canShowStartBranch = selectedNode?.data.role === 'assistant'
      const deletionPlan = planBranchDeletion(data ?? emptyTree, messageId)

      const actions: ResolvedAction[] = [
        {
          id: 'topic-flow.start-branch',
          commandId: 'message.newBranch',
          label: t('chat.message.new.branch.label'),
          icon: <GitBranch size={14} />,
          group: 'branch',
          danger: false,
          availability: {
            visible: canShowStartBranch,
            enabled: canShowStartBranch
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
        },
        {
          id: 'topic-flow.delete-branch',
          label: t('chat.message.flow.delete_branch.label'),
          icon: <DeleteIcon size={14} />,
          group: 'delete',
          danger: true,
          availability: {
            visible: !deletionPlan.reason || deletionPlan.reason === 'pending',
            enabled: !deletionPlan.reason,
            reason: deletionPlan.reason === 'pending' ? t('message.delete.generating_unavailable') : undefined
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
          return
        }
        if (action.id === 'topic-flow.delete-branch') {
          setDeletionTarget({ topicId, messageId, awaitingInputOnly: deletionPlan.awaitingInputOnly })
        }
      })
    },
    [data, graph.nodes, handleCopyBranchToNewTopic, handleStartNodeBranch, t, topicId]
  )

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) contextMenuMessageIdRef.current = null
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-card-foreground">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-border-subtle border-b px-3 text-xs">
        {topicName && (
          <>
            <span className="min-w-0 max-w-55 truncate text-foreground-tertiary">{topicName}</span>
            <span className="shrink-0 text-foreground-tertiary">·</span>
          </>
        )}
        <span className="shrink-0 text-foreground-tertiary">
          {graph.stats.branchCount} {t('chat.message.flow.branches', { defaultValue: 'branches' })}
        </span>
        <span className="shrink-0 text-foreground-tertiary">·</span>
        <span className="shrink-0 text-foreground-tertiary">
          {graph.stats.nodeCount} {t('chat.message.flow.nodes', { defaultValue: 'nodes' })}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full min-h-80 items-center justify-center text-destructive text-sm" role="alert">
            {t('common.error')}
          </div>
        ) : isLoading ? (
          <div className="flex h-full min-h-80 items-center justify-center text-foreground-tertiary text-sm">
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
      <ConfirmDialog
        open={open && deletionTarget?.topicId === topicId}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) setDeletionTarget(null)
        }}
        title={t('chat.message.flow.delete_branch.confirm_title')}
        description={t('chat.message.flow.delete_branch.confirm_description')}
        confirmText={t('chat.message.flow.delete_branch.label')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={isDeleting}
        onConfirm={handleConfirmDeleteBranch}
      />
    </div>
  )
}

export default TopicBranchPanel
