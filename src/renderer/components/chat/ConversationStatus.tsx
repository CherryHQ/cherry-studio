import { CircleAlert, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { getConversationStatus } from '@renderer/utils/conversationStatus'
import { cn } from '@renderer/utils/style'

export function ConversationStatus({
  status,
  className,
  testId
}: {
  status: ReturnType<typeof getConversationStatus>
  className?: string
  testId?: string
}) {
  const { t } = useTranslation()
  if (!status) return null
  const label =
    status === 'approval'
      ? t('agent.toolPermission.pendingBadge')
      : status === 'pending'
        ? t('message.tools.status.running')
        : status === 'error'
          ? t('message.tools.status.error')
          : t('message.tools.status.done')
  return (
    <span
      role="img"
      aria-label={label}
      data-testid={testId}
      className={cn(
        'flex size-3 shrink-0 items-center justify-center',
        status === 'approval' ? 'text-warning' : status === 'error' ? 'text-error' : 'text-foreground-tertiary',
        className
      )}>
      {status === 'pending' ? (
        <Loader2 aria-hidden className="size-full animate-spin motion-reduce:animate-none" />
      ) : status === 'done' ? (
        <span aria-hidden className="size-1.25 rounded-full bg-success" />
      ) : (
        <CircleAlert aria-hidden className="size-full" />
      )}
    </span>
  )
}
