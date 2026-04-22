import { cn } from '@cherrystudio/ui/lib/utils'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { DataSourceIconMeta, DataSourceStatusViewModel } from './utils/models'
import { toKnowledgeItemRowViewModel } from './utils/selectors'

export interface KnowledgeItemRowProps {
  item: KnowledgeItem
  onClick: () => void
}

const KnowledgeItemRowIcon = ({ icon, iconClassName }: DataSourceIconMeta) => {
  const Icon = icon

  return (
    <div className="flex size-6 shrink-0 items-center justify-center rounded bg-accent/40">
      <Icon className={cn('size-3.5', iconClassName)} />
    </div>
  )
}

const KnowledgeItemRowContent = ({
  id,
  metaParts,
  suffix,
  title
}: {
  id: string
  metaParts: string[]
  suffix: string
  title: string
}) => (
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-1.5">
      <div className="truncate text-[0.6875rem] text-foreground leading-4.125">{title}</div>
      {suffix ? (
        <span className="shrink-0 text-[0.5rem] text-muted-foreground/30 uppercase leading-3">{suffix}</span>
      ) : null}
    </div>

    <div className="mt-px flex items-center gap-1.5 text-[0.5625rem] text-muted-foreground/35 leading-3.375">
      {metaParts.map((part) => (
        <span key={`${id}-${part}`}>{part}</span>
      ))}
    </div>
  </div>
)

const KnowledgeItemRowStatus = ({ status }: { status: DataSourceStatusViewModel }) => {
  const { t } = useTranslation()
  const icon =
    status.icon === 'loader' ? (
      <LoaderCircle className="size-1.75 animate-spin" />
    ) : status.icon === 'check' ? (
      <Check className="size-1.75" />
    ) : (
      <CircleAlert className="size-2" />
    )

  return (
    <div className="flex shrink-0 items-center">
      <span className={cn('inline-flex items-center gap-0.5 text-[0.5625rem] leading-3.375', status.textClassName)}>
        {icon}
        <span>{t(status.labelKey)}</span>
      </span>
    </div>
  )
}

const KnowledgeItemRow = ({ item, onClick }: KnowledgeItemRowProps) => {
  const {
    i18n: { language }
  } = useTranslation()
  const { icon, metaParts, status, suffix, title } = toKnowledgeItemRowViewModel(item, language)

  return (
    <div
      className="group/row relative flex h-11 cursor-pointer items-center gap-2.5 px-2.5 py-1.5 transition-colors hover:bg-accent/25"
      onClick={onClick}>
      <KnowledgeItemRowIcon {...icon} />
      <KnowledgeItemRowContent id={item.id} title={title} suffix={suffix} metaParts={metaParts} />
      <KnowledgeItemRowStatus status={status} />
    </div>
  )
}

export default KnowledgeItemRow
