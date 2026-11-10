import { AlertCircle, ChevronRight, X } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

export interface ErrorNoticeAction {
  readonly label: string
  readonly onClick: () => void
  readonly icon?: ReactNode
}

export interface ErrorNoticeProps {
  /** `card`: title + info + footer row; `inline`: one row for settings and dialogs. */
  readonly variant?: 'card' | 'inline'
  readonly title: ReactNode
  readonly info?: ReactNode
  readonly action?: ErrorNoticeAction
  /** Renders the 「详情 ›」 link and makes the whole surface open the detail. */
  readonly onOpenDetail?: () => void
  /** A self-contained detail entry (e.g. `ErrorDetailAction`), used instead of `onOpenDetail`. */
  readonly detail?: ReactNode
  /** Quiet extra links placed just before the detail entry. */
  readonly extra?: ReactNode
  readonly onDismiss?: () => void
  readonly className?: string
}

const ACTION_CLASS =
  'rounded-[5px] text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground'

export function ErrorNotice({
  variant = 'card',
  title,
  info,
  action,
  onOpenDetail,
  detail,
  extra,
  onDismiss,
  className
}: ErrorNoticeProps) {
  const { t } = useTranslation()
  const stop = (event: MouseEvent) => event.stopPropagation()

  const detailEntry = onOpenDetail ? (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center gap-0.5 text-foreground-tertiary text-xs transition-colors duration-150 group-hover:text-foreground"
      onClick={(event) => {
        stop(event)
        onOpenDetail()
      }}>
      {t('common.detail')}
      <ChevronRight size={14} />
    </button>
  ) : (
    detail
  )
  const actionButton = action ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={ACTION_CLASS}
      onClick={(event) => {
        stop(event)
        action.onClick()
      }}>
      {action.icon}
      {action.label}
    </Button>
  ) : null
  const trailing =
    extra || detailEntry ? (
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {extra}
        {detailEntry}
      </div>
    ) : null

  return (
    <Alert
      type="error"
      showIcon
      icon={<AlertCircle size={14} className="lucide-custom mt-px text-error" />}
      className={cn(
        'group gap-2 rounded-lg border-border-subtle bg-background-subtle text-foreground shadow-none',
        variant === 'card' ? 'px-3 py-2.5' : 'py-2 pr-2 pl-3 text-xs leading-5',
        onOpenDetail && 'cursor-pointer',
        className
      )}
      onClick={onOpenDetail}>
      {onDismiss ? (
        <button
          type="button"
          className="absolute top-2 right-2 flex size-5.5 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          onClick={(event) => {
            stop(event)
            onDismiss()
          }}
          aria-label={t('common.close')}
          title={t('common.close')}>
          <X size={14} />
        </button>
      ) : null}
      {variant === 'card' ? (
        <>
          <div className={cn('font-medium text-[13px] leading-5', onDismiss && 'pr-5')}>{title}</div>
          {info ? (
            <div className="mt-0.5 line-clamp-2 text-muted-foreground text-xs leading-[18px] [overflow-wrap:anywhere] [&_a]:text-link">
              {info}
            </div>
          ) : null}
          {actionButton || trailing ? (
            <div className="mt-2 flex items-center gap-2">
              {actionButton}
              {trailing}
            </div>
          ) : null}
        </>
      ) : (
        <div className="flex min-w-0 items-start gap-2">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{title}</span>
          {actionButton || trailing ? (
            <div className="flex shrink-0 items-center gap-3">
              {actionButton}
              {trailing}
            </div>
          ) : null}
        </div>
      )}
    </Alert>
  )
}
