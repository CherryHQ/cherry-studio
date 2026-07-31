import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import { useInfiniteFlatItems, useInfiniteQuery } from '@renderer/data/hooks/useDataApi'
import { isAgentSessionTopicId } from '@renderer/utils/agentSession'
import type { MessageStats } from '@shared/data/types/message'
import type { FC } from 'react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageListActions } from '../MessageListProvider'
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
      className="message-tokens cursor-pointer select-text text-right text-muted-foreground text-xs tabular-nums leading-5 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
  const [showAllDetails, setShowAllDetails] = useState(false)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const contentId = useId()
  const messageKind = isAgentSessionTopicId(message.topicId) ? 'agent-session' : 'chat'
  const { pages, isRefreshing, hasNext, loadNext } = useInfiniteQuery('/ai-usage-records', {
    enabled: isDetailsOpen && message.stats?.runtimeTiming !== undefined,
    query: {
      messageKind,
      messageId: message.id,
      sortBy: 'createdAt',
      sortOrder: 'asc'
    },
    limit: 200
  })
  const records = useInfiniteFlatItems(pages)
  const requestedPageCountRef = useRef(1)

  useEffect(() => {
    if (!isDetailsOpen) {
      requestedPageCountRef.current = pages.length
      return
    }
    if (isRefreshing || !hasNext || requestedPageCountRef.current > pages.length) return

    requestedPageCountRef.current = pages.length + 1
    loadNext()
  }, [hasNext, isDetailsOpen, isRefreshing, loadNext, pages.length])

  return (
    <HoverCard open={isDetailsOpen} onOpenChange={setIsDetailsOpen} openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-describedby={showAllDetails ? contentId : undefined}
          className="message-tokens cursor-pointer select-text text-right text-muted-foreground text-xs tabular-nums leading-5 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onFocus={() => setShowAllDetails(true)}
          onBlur={() => setShowAllDetails(false)}
          onClick={onLocate}>
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
        <MessageTokenDetailsCard message={message} records={records} showAllDetails={showAllDetails} />
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
