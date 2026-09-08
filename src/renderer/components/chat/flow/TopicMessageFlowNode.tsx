import { Button, Tooltip } from '@cherrystudio/ui'
import { useDataChange, useQuery } from '@data/hooks/useDataApi'
import { MessagePartsScopeProvider, usePartsMap } from '@renderer/components/chat/messages/blocks/MessagePartsContext'
import MessageAvatar from '@renderer/components/chat/messages/frame/MessageAvatar'
import MessageContent from '@renderer/components/chat/messages/frame/MessageContent'
import MessageErrorBoundary from '@renderer/components/chat/messages/frame/MessageErrorBoundary'
import MessageMenuBar from '@renderer/components/chat/messages/frame/MessageMenuBar'
import {
  useMessageListActions,
  useMessageListData,
  useMessageListEditingId,
  useMessageListItemActivityState,
  useMessageListMeta,
  useMessageRenderConfig
} from '@renderer/components/chat/messages/MessageListProvider'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import {
  getMessageListItemModelName,
  toMessageListItem
} from '@renderer/components/chat/messages/utils/messageListItem'
import { LoadingState } from '@renderer/components/chat/primitives'
import { sharedMessageToUIMessage } from '@renderer/utils/message/messageProjection'
import { firstLetter, removeLeadingEmoji } from '@renderer/utils/naming'
import { cn } from '@renderer/utils/style'
import type { MessageRole, MessageStatus } from '@shared/data/types/message'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import dayjs from 'dayjs'
import { Plus, UserRound } from 'lucide-react'
import type { RefObject } from 'react'
import { memo, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { TopicMessageFlowNodeData, TopicMessageFlowNodeModel } from './types'

const STATUS_DOT_CLASS_NAMES: Record<MessageStatus, string> = {
  pending: 'bg-warning',
  success: 'bg-foreground-disabled',
  error: 'bg-error',
  paused: 'border border-border-strong bg-muted'
}

function useRoleLabel(role: MessageRole, isContextBoundary?: boolean) {
  const { t } = useTranslation()
  if (isContextBoundary) return t('chat.message.new.context')
  if (role === 'user') return t('export.user')
  if (role === 'assistant') return t('export.assistant')
  return t('assistants.tag.system')
}

function useStatusLabel(status: MessageStatus, isAwaitingInput?: boolean) {
  const { t } = useTranslation()
  if (isAwaitingInput) return t('chat.message.flow.status.awaiting_input')
  if (status === 'pending') return t('common.loading')
  if (status === 'success') return t('common.completed')
  if (status === 'error') return t('common.error')
  return t('agent.task.status.paused')
}

function TopicMessageFlowHeader({
  data,
  message
}: {
  data: TopicMessageFlowNodeData
  message?: MessageListItem | null
}) {
  const { t } = useTranslation()
  const meta = useMessageListMeta()
  const renderConfig = useMessageRenderConfig()
  const roleLabel = useRoleLabel(data.role, data.isContextBoundary)
  const statusLabel = useStatusLabel(data.status, data.isAwaitingInput)
  const isAssistant = data.role === 'assistant'
  const snapshot = message?.messageSnapshot
  const modelName = isAssistant && message ? getMessageListItemModelName(message) : ''
  const authorName = snapshot ? snapshot.name : meta.assistantProfile?.name
  const authorAvatar = snapshot ? snapshot.emoji : meta.assistantProfile?.avatar
  const name = removeLeadingEmoji(
    data.isContextBoundary
      ? roleLabel
      : isAssistant
        ? authorName || modelName || roleLabel
        : renderConfig.userName || t('common.you')
  )
  const time = dayjs(data.createdAt)

  return (
    <Button
      variant="ghost"
      className="nodrag h-auto w-full shrink-0 justify-start gap-2.5 rounded-lg px-4 py-3 text-left">
      <MessageAvatar
        avatar={isAssistant ? authorAvatar : meta.userProfile?.avatar}
        fallback={isAssistant ? firstLetter(name).toUpperCase() : <UserRound className="size-4" />}
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="max-w-full truncate font-medium text-sm" title={name}>
          {name}
        </span>
        {modelName && (
          <span className="max-w-full truncate text-muted-foreground text-xs" title={modelName}>
            {modelName}
          </span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
        {(data.status !== 'success' || data.isAwaitingInput) && (
          <span
            aria-label={statusLabel}
            className={cn(
              'size-1.5 rounded-full',
              data.isAwaitingInput ? 'bg-warning' : STATUS_DOT_CLASS_NAMES[data.status]
            )}
          />
        )}
        {time.isValid() && <time dateTime={data.createdAt}>{time.format('MM/DD HH:mm')}</time>}
      </span>
    </Button>
  )
}

function TopicMessageFlowMessage({ data }: { data: TopicMessageFlowNodeModel['data'] }) {
  const { t } = useTranslation()
  const { messages, topic } = useMessageListData()
  const actions = useMessageListActions()
  const renderConfig = useMessageRenderConfig()
  const editingMessageId = useMessageListEditingId()
  const partsByMessageId = usePartsMap()
  const messageContainerRef = useRef<HTMLDivElement>(null)
  const {
    data: persistedMessage,
    error,
    refetch
  } = useQuery('/messages/:id', {
    params: { id: data.messageId },
    swrOptions: { keepPreviousData: false }
  })
  useDataChange('/messages/:id', () => void refetch(), { routeParams: { id: data.messageId } })

  const liveMessage = messages.find((message) => message.id === data.messageId)
  const message = useMemo(() => {
    const source =
      liveMessage ??
      (persistedMessage
        ? toMessageListItem(sharedMessageToUIMessage(persistedMessage), {
            topicId: topic.id,
            assistantId: topic.assistantId
          })
        : null)
    return source ? { ...source, isActiveBranch: data.isOnActivePath } : null
  }, [data.isOnActivePath, liveMessage, persistedMessage, topic.assistantId, topic.id])
  const parts = partsByMessageId?.[data.messageId] ?? persistedMessage?.data.parts
  const startEditing = useCallback(() => {
    if (message && parts) actions.startEditing?.(message, parts)
  }, [actions, message, parts])

  return (
    <>
      <TopicMessageFlowHeader data={data} message={message} />
      {!message || !parts ? (
        error ? (
          <div className="px-4 py-6 text-destructive text-sm" role="alert">
            {t('common.error')}
          </div>
        ) : (
          <LoadingState className="min-h-24 justify-center" label={t('common.loading')} />
        )
      ) : (
        <MessagePartsScopeProvider messageId={message.id} parts={parts}>
          <div
            className="nodrag nopan flex min-h-0 min-w-0 flex-col pb-3"
            onClick={(event) => {
              const target = event.target instanceof Element ? event.target : null
              if (target?.closest('a,button,input,textarea,select,[role="button"],[contenteditable="true"]')) {
                event.stopPropagation()
              }
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            style={{
              fontSize: renderConfig.fontSize,
              fontFamily: renderConfig.messageFont === 'serif' ? 'var(--font-family-serif)' : 'var(--font-family)'
            }}>
            <div
              ref={messageContainerRef}
              className="nowheel min-h-0 cursor-auto select-text overflow-y-auto overscroll-contain px-4">
              <MessageErrorBoundary>
                <MessageContent message={message} defaultUserContentExpanded />
              </MessageErrorBoundary>
            </div>
            <TopicMessageFlowMessageActions
              message={message}
              messageContainerRef={messageContainerRef}
              onStartEditing={startEditing}
              isEditing={editingMessageId === message.id}
            />
          </div>
          {editingMessageId !== message.id && <TopicMessageFlowBranchButton data={data} message={message} />}
        </MessagePartsScopeProvider>
      )}
    </>
  )
}

function TopicMessageFlowBranchButton({
  data,
  message
}: {
  data: TopicMessageFlowNodeModel['data']
  message: MessageListItem
}) {
  const { t } = useTranslation()
  const activity = useMessageListItemActivityState(message)
  const disabled = data.actionsDisabled || activity.isStreamTarget || activity.isApprovalAnchor
  if (data.role !== 'assistant' || !data.onStartBranch) return null

  const visibility =
    'nodrag nopan absolute z-10 opacity-0 pointer-events-none group-hover/flow-node:opacity-100 group-hover/flow-node:pointer-events-auto group-focus-within/flow-node:opacity-100 group-focus-within/flow-node:pointer-events-auto group-data-[selected=true]/flow-node:opacity-100 group-data-[selected=true]/flow-node:pointer-events-auto group-data-[active=true]/flow-node:opacity-100 group-data-[active=true]/flow-node:pointer-events-auto'
  const continueLabel = t('chat.message.flow.continue_here')

  return (
    <div className={cn(visibility, '-translate-y-1/2 top-1/2 right-0 flex translate-x-1/2')}>
      <Tooltip content={disabled ? t('chat.message.flow.actions_unavailable') : continueLabel} placement="top">
        <Button
          variant="outline"
          size="icon"
          className="size-5 rounded-full border-border-strong bg-card text-primary"
          aria-label={continueLabel}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            void data.onStartBranch?.(data.messageId)
          }}>
          <Plus className="size-3" />
        </Button>
      </Tooltip>
    </div>
  )
}

function TopicMessageFlowMessageActions({
  message,
  messageContainerRef,
  onStartEditing,
  isEditing
}: {
  message: MessageListItem
  messageContainerRef: RefObject<HTMLDivElement | null>
  onStartEditing: () => void
  isEditing: boolean
}) {
  const activity = useMessageListItemActivityState(message)
  if (isEditing || activity.isStreamTarget || activity.isApprovalAnchor) return null

  return (
    <div
      className="mx-4 mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-border border-t pt-2 text-muted-foreground"
      onClick={(event) => event.stopPropagation()}>
      <MessageMenuBar
        message={message}
        isLastMessage={false}
        forceVisible
        isAssistantMessage={message.role === 'assistant'}
        isProcessing={activity.isProcessing}
        messageContainerRef={messageContainerRef as RefObject<HTMLDivElement>}
        onStartEditing={onStartEditing}
        variant={message.role === 'assistant' ? 'footer' : 'header'}
      />
    </div>
  )
}

const TopicMessageFlowNode = ({ data, selected }: NodeProps<TopicMessageFlowNodeModel>) => {
  const { t } = useTranslation()
  const statusLabel = useStatusLabel(data.status, data.isAwaitingInput)

  return (
    <div
      className={cn(
        'group/message group/flow-node relative flex max-h-105 min-w-0 flex-col rounded-lg border border-border-strong bg-card text-card-foreground',
        data.role === 'user' && 'bg-chat-user',
        data.isAwaitingInput && 'border-dashed',
        (data.isActive || selected) && 'border-border-selected ring-1 ring-border-selected ring-inset',
        data.isContextBoundary && 'bg-muted'
      )}
      data-active={data.isActive ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-message-id={data.messageId}
      data-on-active-path={data.isOnActivePath ? 'true' : 'false'}>
      <Handle className="opacity-0" isConnectable={false} position={Position.Left} type="target" />
      {data.isAwaitingInput || data.isContextBoundary ? (
        <>
          <TopicMessageFlowHeader data={data} />
          <p className="px-4 pb-4 text-muted-foreground text-sm">
            {data.isContextBoundary ? t('chat.message.new.context') : statusLabel}
          </p>
        </>
      ) : (
        <TopicMessageFlowMessage data={data} />
      )}
      <Handle className="opacity-0" isConnectable={false} position={Position.Right} type="source" />
    </div>
  )
}

export default memo(TopicMessageFlowNode)
