import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { useInfiniteFlatItems, useInfiniteQuery } from '@renderer/data/hooks/useDataApi'
import type { MessageStats } from '@shared/data/types/message'
import type { FC, MouseEvent } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageListActions, useMessageListMeta } from '../MessageListProvider'
import type { MessageListItem } from '../types'
import { getMessageModelTokensPerSecond } from './messagePerformance'
import MessageTokenDetailsCard from './MessageTokenDetailsCard'

interface MessageTokensProps {
  message: MessageListItem
}

function getTotalTokens(stats: MessageStats): number {
  return stats.totalTokens ?? (stats.inputTokens ?? 0) + (stats.outputTokens ?? 0)
}

function UserMessageTokens({ label, onLocate }: { label: string; onLocate: () => void }) {
  return (
    <button
      type="button"
      className="message-tokens cursor-pointer select-text text-right text-muted-foreground text-xs tabular-nums leading-5 transition-colors duration-150 hover:text-foreground focus-visible:text-foreground focus-visible:underline focus-visible:outline-none"
      onClick={onLocate}>
      {label}
    </button>
  )
}

function AssistantMessageTokens({
  label,
  message,
  onLocate
}: {
  label: string
  message: MessageListItem
  onLocate: () => void
}) {
  const [showMoreDetails, setShowMoreDetails] = useState(false)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isDetailsDismissed, setIsDetailsDismissed] = useState(false)
  const contentId = useId()
  const messageKind = useMessageListMeta().aiUsageMessageKind ?? 'chat'
  const { pages, isLoading, isRefreshing, hasNext, loadNext } = useInfiniteQuery('/ai-usage-records', {
    enabled: showMoreDetails && isDetailsOpen && message.stats?.runtimeTiming !== undefined,
    query: {
      messageKind,
      messageId: message.id,
      sortBy: 'createdAt',
      sortOrder: 'asc'
    },
    limit: 200
  })
  const records = useInfiniteFlatItems(pages)
  const isDetailsVisible = isDetailsOpen && !isDetailsDismissed
  const requestedPageCountRef = useRef(1)
  const pointerDownPositionRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const handleDetailsOpenChange = (open: boolean) => {
    if (open && isDetailsDismissed) return
    setIsDetailsOpen(open)
  }
  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return

    pointerDownPositionRef.current = { x: event.clientX, y: event.clientY }
    setIsDetailsDismissed(true)
    setIsDetailsOpen(false)
  }
  const handleMouseBoundary = (event: MouseEvent<HTMLButtonElement>) => {
    const pointerDownPosition = pointerDownPositionRef.current
    if (!pointerDownPosition) {
      setIsDetailsDismissed(false)
      return
    }

    const movedDistance = Math.hypot(event.clientX - pointerDownPosition.x, event.clientY - pointerDownPosition.y)
    if (movedDistance < 2) return

    pointerDownPositionRef.current = undefined
    setIsDetailsDismissed(false)
  }
  const handleLocate = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      setIsDetailsDismissed(true)
      setIsDetailsOpen(false)
    }
    onLocate()
  }
  const handleBlur = () => {
    pointerDownPositionRef.current = undefined
    setIsDetailsDismissed(false)
  }

  useEffect(() => {
    if (!showMoreDetails || !isDetailsVisible) {
      requestedPageCountRef.current = pages.length
      return
    }
    if (isRefreshing || !hasNext || requestedPageCountRef.current > pages.length) return

    requestedPageCountRef.current = pages.length + 1
    loadNext()
  }, [hasNext, isDetailsVisible, isRefreshing, loadNext, pages.length, showMoreDetails])

  return (
    <HoverCard open={isDetailsVisible} onOpenChange={handleDetailsOpenChange} openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-describedby={isDetailsVisible ? contentId : undefined}
          className="message-tokens cursor-pointer select-text text-right text-muted-foreground text-xs tabular-nums leading-5 transition-colors duration-150 hover:text-foreground focus-visible:text-foreground focus-visible:underline focus-visible:outline-none"
          onBlur={handleBlur}
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseBoundary}
          onMouseLeave={handleMouseBoundary}
          onClick={handleLocate}>
          {label}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        id={contentId}
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-[28rem] max-w-(--radix-hover-card-content-available-width) p-0">
        <MessageTokenDetailsCard
          message={message}
          records={records}
          showMoreDetails={showMoreDetails}
          isLoadingDetails={isLoading || isRefreshing}
          onShowMoreDetailsChange={setShowMoreDetails}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

const MessageTokens: FC<MessageTokensProps> = ({ message }) => {
  const { t, i18n } = useTranslation()
  const actions = useMessageListActions()
  const stats = message.stats
  const compactFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.resolvedLanguage, {
        notation: 'compact',
        maximumFractionDigits: 1
      }),
    [i18n.resolvedLanguage]
  )
  const decimalFormatter = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }),
    [i18n.resolvedLanguage]
  )

  if (!stats) {
    return null
  }

  const totalTokens = getTotalTokens(stats)
  const tokenLabel = t('chat.message.token_details.tokens', { value: compactFormatter.format(totalTokens) })
  const locateMessage = () => actions.locateMessage?.(message.id, false)

  if (message.role === 'user') {
    return <UserMessageTokens label={tokenLabel} onLocate={locateMessage} />
  }

  if (message.role === 'assistant') {
    const tokensPerSecond = getMessageModelTokensPerSecond(stats)
    const throughputLabel =
      tokensPerSecond === undefined
        ? undefined
        : t('chat.message.token_details.tokens_per_second_value', {
            value: decimalFormatter.format(tokensPerSecond)
          })
    const label = throughputLabel ? `${tokenLabel} · ${throughputLabel}` : tokenLabel

    return <AssistantMessageTokens label={label} message={message} onLocate={locateMessage} />
  }

  return null
}

export default MessageTokens
