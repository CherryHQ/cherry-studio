import { CopyPlus, CornerDownRight, GitBranch } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { actionsToCommandMenuExtraItems } from '@renderer/components/chat/actions/actionMenuItems'
import type { ResolvedAction } from '@renderer/components/chat/actions/actionTypes'
import {
  buildTopicMessageFlowGraph,
  mergeTopicMessageFlowLiveTree,
  TopicMessageFlowCanvas,
  type TopicMessageFlowLiveState
} from '@renderer/components/chat/flow'
import { CommandContextMenu } from '@renderer/components/command'
import DeleteIcon from '@renderer/components/icons/DeleteIcon'
import { useChatWrite } from '@renderer/hooks/chat/ChatWriteContext'
import { useTopicStreamStatus } from '@renderer/hooks/useTopicStreamStatus'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { toast } from '@renderer/services/toast'
import { DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { TreeResponse } from '@shared/data/types/message'

import { useTopicBranchActions } from '../hooks/useTopicBranchActions'

interface Props {
  open: boolean
  topicId: string
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

const TopicBranchPanel: FC<Props> = ({ open, topicId, liveState, focusKey, layoutReady, onLocateMessage }) => {
  const { t } = useTranslation()
  const contextMenuMessageIdRef = useRef<string | null>(null)
  const [revealNodeId, setRevealNodeId] = useState<string>()
  const [branchActionPending, setBranchActionPending] = useState(false)
  const { isPending, status } = useTopicStreamStatus(topicId)
  const chatWrite = useChatWrite()
  const actionsDisabled = !chatWrite || branchActionPending || isPending || status === 'awaiting-approval'
  const { data, error, isLoading, refetch } = useQuery('/topics/:topicId/tree', {
    enabled: open,
    params: { topicId },
    query: { depth: -1 }
  })
  useDataChange(
    '/topics/:topicId/tree',
    () => {
      if (open) void refetch()
    },
    { routeParams: { topicId } }
  )
  const { trigger: copyBranchToNewTopic } = useMutation('POST', '/topics/:id/duplicate', {
    refresh: ['/topics']
  })
  const { reserveBranch, deleteReservedBranch } = useTopicBranchActions(topicId)

  const tree = useMemo(
    () => mergeTopicMessageFlowLiveTree(data ?? emptyTree, liveState?.topicId === topicId ? liveState : null),
    [data, liveState, topicId]
  )
  const graph = useMemo(() => buildTopicMessageFlowGraph(tree), [tree])

  const handleActivateNodeBranch = useCallback(
    async (messageId: string) => {
      if (!chatWrite || actionsDisabled) return
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      setBranchActionPending(true)
      let leafId = messageId
      try {
        if (selectedNode?.data.isOnActivePath) {
          if (!selectedNode.data.isAwaitingInput) onLocateMessage?.(messageId)
        } else {
          const activatedLeafId = await chatWrite.setActiveBranch(messageId)
          if (!activatedLeafId) return
          leafId = activatedLeafId
        }
        setRevealNodeId(leafId)
        void EventEmitter.emit(EVENT_NAMES.FOCUS_CHAT_COMPOSER, { topicId })
      } catch (err) {
        logger.error('Failed to set active branch from topic flow', err as Error)
        toast.error(t('common.error'))
      } finally {
        setBranchActionPending(false)
      }
    },
    [actionsDisabled, chatWrite, graph.nodes, onLocateMessage, t, topicId]
  )

  const handleStartNodeBranch = useCallback(
    async (messageId: string) => {
      if (actionsDisabled) return
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      if (selectedNode?.data.role !== 'assistant') {
        return
      }

      setBranchActionPending(true)
      try {
        const branch = await reserveBranch(messageId)
        setRevealNodeId(branch.id)
        toast.success(t('chat.message.new.branch.created'))
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('startMessageBranch from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to start message branch from topic flow', err as Error)
        toast.error(t('common.error'))
      } finally {
        setBranchActionPending(false)
      }
    },
    [actionsDisabled, graph.nodes, reserveBranch, t, topicId]
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

  const handleDeleteAwaitingInputMessage = useCallback(
    async (messageId: string) => {
      const selectedNode = graph.nodes.find((node) => node.data.messageId === messageId)
      if (!selectedNode?.data.isAwaitingInput) return

      try {
        await deleteReservedBranch(messageId)
        toast.success(t('common.delete_success'))
      } catch (err) {
        if (err instanceof DataApiError && err.code === ErrorCode.NOT_FOUND) {
          logger.warn('deleteAwaitingInputMessage from topic flow on missing message', { messageId, topicId })
          return
        }
        logger.error('Failed to delete awaiting-input message from topic flow', err as Error)
        toast.error(t('common.delete_failed'))
      }
    },
    [deleteReservedBranch, graph.nodes, t, topicId]
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
      const canShowStartBranch = selectedNode?.data.role === 'assistant'
      const canDeleteAwaitingInput = selectedNode?.data.isAwaitingInput === true

      const actions: ResolvedAction[] = [
        {
          id: 'topic-flow.activate-branch',
          label: t('chat.message.flow.continue_branch'),
          icon: <CornerDownRight size={14} />,
          group: 'branch',
          danger: false,
          availability: { visible: true, enabled: !actionsDisabled },
          children: []
        },
        {
          id: 'topic-flow.start-branch',
          commandId: 'message.newBranch',
          label: t('chat.message.new.branch.label'),
          icon: <GitBranch size={14} />,
          group: 'branch',
          danger: false,
          availability: {
            visible: canShowStartBranch,
            enabled: canShowStartBranch && !actionsDisabled
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
          id: 'topic-flow.delete-awaiting-input',
          label: t('common.delete'),
          icon: <DeleteIcon size={14} />,
          group: 'delete',
          danger: true,
          availability: {
            visible: canDeleteAwaitingInput,
            enabled: canDeleteAwaitingInput
          },
          children: []
        }
      ]

      return actionsToCommandMenuExtraItems(actions, (action) => {
        if (!action.availability.enabled) return
        if (action.id === 'topic-flow.activate-branch') {
          void handleActivateNodeBranch(messageId)
          return
        }
        if (action.id === 'topic-flow.start-branch') {
          void handleStartNodeBranch(messageId)
          return
        }
        if (action.id === 'topic-flow.copy-topic') {
          void handleCopyBranchToNewTopic(messageId)
          return
        }
        if (action.id === 'topic-flow.delete-awaiting-input') {
          void handleDeleteAwaitingInputMessage(messageId)
        }
      })
    },
    [
      actionsDisabled,
      graph.nodes,
      handleActivateNodeBranch,
      handleCopyBranchToNewTopic,
      handleDeleteAwaitingInputMessage,
      handleStartNodeBranch,
      t
    ]
  )

  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    if (!open) contextMenuMessageIdRef.current = null
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-card-foreground">
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
                onNodeActivate={handleActivateNodeBranch}
                onStartBranch={handleStartNodeBranch}
                actionsDisabled={actionsDisabled}
                revealNodeId={revealNodeId}
              />
            </div>
          </CommandContextMenu>
        )}
      </div>
    </div>
  )
}

export default TopicBranchPanel
