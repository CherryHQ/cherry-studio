import { CircleAlert, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ConversationRowStatusValue = 'approval' | 'done' | 'error' | 'pending'

type ConversationRowStatusProps = {
  status: ConversationRowStatusValue | null
  testId?: string
}

export const CONVERSATION_ROW_STATUS_TITLE_CLASS =
  'mr-7 transition-[margin] duration-150 group-hover:mr-0 group-has-[[data-resource-list-item-actions]:focus-within]:mr-0 group-has-[[data-resource-list-item-actions][data-active=true]]:mr-0'

const CONVERSATION_ROW_APPROVAL_BADGE_CLASS =
  'pointer-events-none max-w-28 shrink-0 truncate rounded-full border border-warning-border bg-warning-subtle px-1.5 font-medium text-[10px] text-warning-subtle-foreground leading-4 transition-[max-width,padding,opacity] duration-150 group-hover:max-w-0 group-hover:px-0 group-hover:opacity-0 group-has-[[data-resource-list-item-actions]:focus-within]:max-w-0 group-has-[[data-resource-list-item-actions][data-active=true]]:max-w-0 group-has-[[data-resource-list-item-actions]:focus-within]:px-0 group-has-[[data-resource-list-item-actions][data-active=true]]:px-0 group-has-[[data-resource-list-item-actions]:focus-within]:opacity-0 group-has-[[data-resource-list-item-actions][data-active=true]]:opacity-0'

const CONVERSATION_ROW_STREAM_INDICATOR_CLASS =
  '-translate-y-1/2 pointer-events-none absolute top-1/2 right-1.5 flex size-5 shrink-0 items-center justify-center opacity-100 transition-opacity duration-150 group-hover:opacity-0 group-has-[[data-resource-list-item-actions]:focus-within]:opacity-0 group-has-[[data-resource-list-item-actions][data-active=true]]:opacity-0'

export function ConversationRowStatus({ status, testId }: ConversationRowStatusProps) {
  const { t } = useTranslation()

  if (!status) return null

  if (status === 'approval') {
    return (
      <span data-testid={testId} className={CONVERSATION_ROW_APPROVAL_BADGE_CLASS}>
        {t('agent.toolPermission.pendingBadge')}
      </span>
    )
  }

  const statusLabel =
    status === 'pending'
      ? t('message.tools.status.running')
      : status === 'error'
        ? t('message.tools.status.error')
        : t('message.tools.status.done')

  return (
    <span aria-label={statusLabel} className={CONVERSATION_ROW_STREAM_INDICATOR_CLASS} data-testid={testId} role="img">
      {status === 'pending' ? (
        <Loader2 aria-hidden="true" className="size-3 animate-spin text-foreground-tertiary" />
      ) : status === 'error' ? (
        <CircleAlert aria-hidden="true" className="size-3 text-error" />
      ) : (
        <span aria-hidden="true" className="size-1.25 rounded-full bg-success" />
      )}
    </span>
  )
}
