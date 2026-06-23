import { cn } from '@renderer/utils'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

interface TopicMessageFlowLegendProps {
  className?: string
}

const LegendMarker = ({ className }: { className: string }) => (
  <span className={cn('inline-block h-2.5 w-4 shrink-0 rounded-[3px] border', className)} />
)

const LegendLine = ({ className }: { className: string }) => (
  <span className={cn('inline-block w-5 shrink-0 border-t-2 border-dashed', className)} />
)

const TopicMessageFlowLegend = ({ className }: TopicMessageFlowLegendProps) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'pointer-events-none absolute top-4 right-5 z-10 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-foreground-muted text-sm',
        className
      )}
      data-testid="topic-message-flow-legend">
      <span className="inline-flex items-center gap-1.5">
        <LegendMarker className="border-success/40 bg-success/20" />
        {t('export.user')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LegendMarker className="border-info/40 bg-info/20" />
        {t('export.assistant')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LegendLine className="border-success" />
        {t('common.current')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LegendLine className="border-foreground-muted" />
        {t('common.disabled')}
      </span>
    </div>
  )
}

export default memo(TopicMessageFlowLegend)
