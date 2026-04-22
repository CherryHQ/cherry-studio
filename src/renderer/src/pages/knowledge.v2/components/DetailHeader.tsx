import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { Clock3, FileText, MoreHorizontal } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface DetailHeaderProps {
  base: KnowledgeBase
}

const DEFAULT_DOCUMENT_COUNT = 0
const DEFAULT_STATUS = 'completed'

const statusClassNames = {
  completed: 'text-muted-foreground/35',
  processing: 'text-amber-400/80',
  failed: 'text-destructive/80'
} as const

const statusTextKeys = {
  completed: 'knowledge.status_completed',
  processing: 'knowledge.status_processing',
  failed: 'knowledge.status_failed'
} as const

const DetailHeader = ({ base }: DetailHeaderProps) => {
  const { t, i18n } = useTranslation()

  const formattedUpdatedAt = useMemo(() => {
    const diffMs = new Date(base.updatedAt).getTime() - Date.now()
    const absMs = Math.abs(diffMs)
    const formatter = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })

    if (absMs < 60 * 60 * 1000) {
      return formatter.format(Math.round(diffMs / (60 * 1000)), 'minute')
    }

    if (absMs < 24 * 60 * 60 * 1000) {
      return formatter.format(Math.round(diffMs / (60 * 60 * 1000)), 'hour')
    }

    return formatter.format(Math.round(diffMs / (24 * 60 * 60 * 1000)), 'day')
  }, [base.updatedAt, i18n.language])

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-border/15 border-b px-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/60 text-xs')}>
          <span aria-hidden="true">{base.emoji}</span>
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <h1 className="truncate text-[0.6875rem] text-foreground leading-4.125">{base.name}</h1>
          <span className={cn('text-[0.5625rem] leading-3.375', statusClassNames[DEFAULT_STATUS])}>
            {t(statusTextKeys[DEFAULT_STATUS])}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 text-[0.5625rem] text-muted-foreground/35 leading-3.375">
        <div className="flex items-center gap-1">
          <FileText className="size-3" />
          <span>{t('knowledge_v2.meta.documents_count', { count: DEFAULT_DOCUMENT_COUNT })}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock3 className="size-3" />
          <span>{formattedUpdatedAt}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 min-h-5 min-w-5 rounded p-0 text-muted-foreground/35 shadow-none hover:bg-accent/60 hover:text-foreground"
          onClick={() => undefined}
          aria-label={t('common.more')}>
          <MoreHorizontal className="size-3" />
        </Button>
      </div>
    </header>
  )
}

export default DetailHeader
