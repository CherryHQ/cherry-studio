import { Popover, PopoverAnchor, PopoverContent } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import MessageContent from '@renderer/components/chat/messages/frame/MessageContent'
import { MessageContentProvider } from '@renderer/components/chat/messages/MessageContentProvider'
import { toMessageListItem } from '@renderer/components/chat/messages/utils/messageListItem'
import { EmptyState, LoadingState } from '@renderer/components/chat/primitives'
import { useTimer } from '@renderer/hooks/useTimer'
import { cn } from '@renderer/utils'
import { sharedMessageToUIMessage, uiMessagesToPartsMap } from '@renderer/utils/message/messageProjection'
import type { MessageRole, MessageStatus } from '@shared/data/types/message'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import dayjs from 'dayjs'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { TopicMessageFlowNodeModel } from './types'

const PREVIEW_OPEN_DELAY_MS = 300
const PREVIEW_CLOSE_DELAY_MS = 120
const PREVIEW_OPEN_TIMER_KEY = 'topic-message-flow-node-preview-open'
const PREVIEW_CLOSE_TIMER_KEY = 'topic-message-flow-node-preview-close'
const bodyXsTypographyClassName = 'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)]'
const bodySmTypographyClassName = 'text-[length:var(--font-size-body-sm)] leading-[var(--line-height-body-sm)]'

const roleClassNames: Record<MessageRole, string> = {
  user: 'border-success/35 bg-success-bg',
  assistant: 'border-info/35 bg-info-bg',
  system: 'border-border bg-muted/45',
  // The virtual root is never rendered as a flow node; entry exists only to satisfy the
  // exhaustive Record<MessageRole> type.
  root: 'border-border bg-muted/45'
}

const statusDotClassNames: Record<MessageStatus, string> = {
  pending: 'bg-warning',
  success: 'bg-success',
  error: 'bg-destructive',
  paused: 'bg-foreground-muted'
}

function getModelShortLabel(modelId?: string | null) {
  if (!modelId) return ''

  const value = modelId.trim()
  if (!value) return ''

  return value.split('/').at(-1)?.split(':').at(-1) ?? value
}

function formatNodeTime(createdAt: string) {
  const value = dayjs(createdAt)
  return value.isValid() ? value.format('MM/DD HH:mm') : createdAt || '-'
}

function useRoleLabel(role: MessageRole) {
  const { t } = useTranslation()

  if (role === 'user') return t('export.user')
  if (role === 'assistant') return t('export.assistant')
  return t('assistants.tag.system')
}

function useStatusLabel(status: MessageStatus, isInputDraft?: boolean) {
  const { t } = useTranslation()

  if (isInputDraft) return t('chat.message.flow.status.awaiting_input')
  if (status === 'pending') return t('common.loading')
  if (status === 'success') return t('common.completed')
  if (status === 'error') return t('common.error')
  return t('agent.task.status.paused')
}

interface TopicMessageFlowNodePreviewCardProps {
  messageId: string
  open: boolean
  roleLabel: string
  statusLabel: string
  modelLabel: string
  timeLabel: string
}

function TopicMessageFlowNodePreviewCard({
  messageId,
  open,
  roleLabel,
  statusLabel,
  modelLabel,
  timeLabel
}: TopicMessageFlowNodePreviewCardProps) {
  const { t } = useTranslation()
  const {
    data: message,
    error,
    isLoading
  } = useQuery('/messages/:id', {
    enabled: open,
    params: { id: messageId }
  })
  const uiMessage = useMemo(() => (message ? sharedMessageToUIMessage(message) : null), [message])
  const messageItems = useMemo(
    () =>
      uiMessage && message
        ? [
            toMessageListItem(uiMessage, {
              topicId: message.topicId
            })
          ]
        : [],
    [message, uiMessage]
  )
  const partsByMessageId = useMemo(() => (uiMessage ? uiMessagesToPartsMap([uiMessage]) : {}), [uiMessage])
  const previewMessage = messageItems[0]

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3 border-border-subtle border-b pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'shrink-0 rounded-3xs bg-muted px-1.5 py-0.5 font-medium text-foreground',
              bodyXsTypographyClassName
            )}>
            {roleLabel}
          </span>
          {modelLabel ? (
            <span className={cn('truncate font-mono text-foreground-muted', bodyXsTypographyClassName)}>
              {modelLabel}
            </span>
          ) : null}
        </div>
        <div className={cn('shrink-0 text-right text-foreground-muted', bodyXsTypographyClassName)}>
          <div>{statusLabel}</div>
          <time dateTime={message?.createdAt ?? undefined}>{timeLabel}</time>
        </div>
      </div>

      {error ? (
        <div
          className={cn('flex min-h-24 items-center justify-center text-destructive', bodySmTypographyClassName)}
          role="alert">
          {t('common.error')}
        </div>
      ) : isLoading || !message ? (
        <LoadingState
          className="min-h-24 justify-center"
          data-testid="topic-message-flow-preview-loading"
          label={t('common.loading')}
        />
      ) : previewMessage ? (
        <MessageContentProvider
          messages={messageItems}
          partsByMessageId={partsByMessageId}
          renderConfig={{ narrowMode: false, showMessageOutline: false }}>
          <div className={cn('min-w-0', bodySmTypographyClassName)}>
            <MessageContent message={previewMessage} />
          </div>
        </MessageContentProvider>
      ) : (
        <EmptyState className="min-h-24 py-4" compact preset="no-result" title={t('common.no_results')} />
      )}
    </div>
  )
}

const TopicMessageFlowNode = ({ data, selected }: NodeProps<TopicMessageFlowNodeModel>) => {
  const roleLabel = useRoleLabel(data.role)
  const statusLabel = useStatusLabel(data.status, data.isInputDraft)
  const modelLabel = getModelShortLabel(data.modelId)
  const timeLabel = formatNodeTime(data.createdAt)
  const [open, setOpen] = useState(false)
  const { clearTimeoutTimer, setTimeoutTimer } = useTimer()
  const openTimerPendingRef = useRef(false)
  const hasOpenedDuringHoverRef = useRef(false)

  const clearOpenTimer = useCallback(() => {
    clearTimeoutTimer(PREVIEW_OPEN_TIMER_KEY)
    openTimerPendingRef.current = false
  }, [clearTimeoutTimer])

  const clearCloseTimer = useCallback(() => {
    clearTimeoutTimer(PREVIEW_CLOSE_TIMER_KEY)
  }, [clearTimeoutTimer])

  const scheduleOpen = useCallback(() => {
    clearCloseTimer()
    if (open || hasOpenedDuringHoverRef.current || openTimerPendingRef.current) return

    openTimerPendingRef.current = true
    setTimeoutTimer(
      PREVIEW_OPEN_TIMER_KEY,
      () => {
        openTimerPendingRef.current = false
        hasOpenedDuringHoverRef.current = true
        setOpen(true)
      },
      PREVIEW_OPEN_DELAY_MS
    )
  }, [clearCloseTimer, open, setTimeoutTimer])

  const keepOpen = useCallback(() => {
    clearCloseTimer()
  }, [clearCloseTimer])

  const scheduleClose = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    setTimeoutTimer(
      PREVIEW_CLOSE_TIMER_KEY,
      () => {
        setOpen(false)
        hasOpenedDuringHoverRef.current = false
      },
      PREVIEW_CLOSE_DELAY_MS
    )
  }, [clearCloseTimer, clearOpenTimer, setTimeoutTimer])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          className={cn(
            'group/topic-message-flow-node relative w-55 rounded-md border bg-card px-3 py-2 shadow-xs transition-[border-color,box-shadow,opacity]',
            'focus-within:ring-2 focus-within:ring-ring/35',
            roleClassNames[data.role],
            data.isActive && 'border-primary shadow-sm ring-2 ring-primary/20',
            selected && !data.isActive && 'ring-2 ring-ring/25',
            data.isInactiveBranch && 'opacity-55'
          )}
          data-active={data.isActive ? 'true' : 'false'}
          data-message-id={data.messageId}
          data-on-active-path={data.isOnActivePath ? 'true' : 'false'}
          onMouseEnter={data.isInputDraft ? undefined : scheduleOpen}
          onMouseLeave={data.isInputDraft ? undefined : scheduleClose}
          onMouseMove={data.isInputDraft ? undefined : scheduleOpen}>
          <Handle className="opacity-0" isConnectable={false} position={Position.Top} type="target" />

          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  'shrink-0 rounded-3xs bg-background/70 px-1.5 py-0.5 font-medium text-foreground',
                  bodyXsTypographyClassName
                )}>
                {roleLabel}
              </span>
              {modelLabel ? (
                <span className={cn('truncate font-mono text-foreground-muted', bodyXsTypographyClassName)}>
                  {modelLabel}
                </span>
              ) : null}
            </div>
          </div>

          <p className={cn('mt-2 line-clamp-2 min-h-9 text-foreground', bodyXsTypographyClassName)}>
            {data.preview || '-'}
          </p>

          <div
            className={cn(
              'mt-2 flex items-center justify-between gap-2 text-foreground-muted',
              bodyXsTypographyClassName
            )}>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn('size-1.5 shrink-0 rounded-full', statusDotClassNames[data.status])} />
              <span className="truncate">{statusLabel}</span>
            </span>
            <time className="shrink-0" dateTime={data.createdAt}>
              {timeLabel}
            </time>
          </div>

          <Handle className="opacity-0" isConnectable={false} position={Position.Bottom} type="source" />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="center"
        className="z-80 max-h-[60vh] w-96 overflow-y-auto p-4"
        onMouseEnter={keepOpen}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="right"
        sideOffset={10}>
        {open && !data.isInputDraft ? (
          <TopicMessageFlowNodePreviewCard
            messageId={data.messageId}
            modelLabel={modelLabel}
            open={open}
            roleLabel={roleLabel}
            statusLabel={statusLabel}
            timeLabel={timeLabel}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

export default memo(TopicMessageFlowNode)
