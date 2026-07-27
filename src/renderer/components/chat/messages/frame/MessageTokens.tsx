import { HoverCard, HoverCardContent, HoverCardTrigger } from '@cherrystudio/ui'
import type { MessageStats } from '@shared/data/types/message'
import type { FC } from 'react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMessageListActions } from '../MessageListProvider'
import type { MessageListItem } from '../types'
import MessageTokenDetailsCard from './MessageTokenDetailsCard'

interface MessageTokensProps {
  message: MessageListItem
}

function getTotalTokens(stats: MessageStats): number {
  return stats.totalTokens ?? (stats.inputTokens ?? 0) + (stats.outputTokens ?? 0)
}

function getTokensPerSecond(stats: MessageStats): number | undefined {
  if (!stats.outputTokens || stats.timeCompletionMs === undefined) {
    return undefined
  }

  const textGenerationDurationMs = stats.timeCompletionMs - (stats.timeFirstTokenMs ?? 0)
  if (textGenerationDurationMs <= 0) {
    return undefined
  }

  return stats.outputTokens / (textGenerationDurationMs / 1000)
}

function UserMessageTokens({ label, onLocate }: { label: string; onLocate: () => void }) {
  return (
    <button
      type="button"
      className="message-tokens cursor-pointer select-text text-right text-foreground-secondary text-xs tabular-nums leading-5 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
  const contentId = useId()

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-describedby={showAllDetails ? contentId : undefined}
          className="message-tokens cursor-pointer select-text text-right text-foreground-secondary text-xs tabular-nums leading-5 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
        className="w-80 max-w-(--radix-hover-card-content-available-width) p-0">
        <MessageTokenDetailsCard message={message} showAllDetails={showAllDetails} />
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
    const tokensPerSecond = getTokensPerSecond(stats)
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
