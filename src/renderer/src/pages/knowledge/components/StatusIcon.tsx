import { Button, Tooltip } from '@cherrystudio/ui'
import type { ItemStatus, KnowledgeItem } from '@shared/data/types/knowledge'
import { CheckCircle2, CircleDashed, CircleX, Clock, type LucideIcon, ScanText, TriangleAlert } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface StatusConfig {
  icon: LucideIcon
  i18nKey: string
  showProgress?: boolean
  containerClass: string
  iconClass: string
}

const STATUS_CONFIG: Partial<Record<ItemStatus, StatusConfig>> = {
  idle: {
    icon: Clock,
    i18nKey: 'knowledge.status_idle',
    containerClass:
      'flex flex-row items-center justify-center gap-2 rounded-2xs border px-2 text-zinc-400 border-zinc-400/20 bg-zinc-400/10',
    iconClass: 'text-zinc-400'
  },
  pending: {
    icon: TriangleAlert,
    i18nKey: 'knowledge.status_pending',
    containerClass:
      'flex flex-row items-center justify-center gap-2 rounded-2xs border px-2 text-yellow-400 border-yellow-400/20 bg-yellow-400/10',
    iconClass: 'text-yellow-400'
  },
  ocr: {
    icon: ScanText,
    i18nKey: 'knowledge.status_ocr',
    showProgress: true,
    containerClass:
      'flex flex-row items-center justify-center gap-2 rounded-2xs border px-2 text-teal-500 border-teal-500/20 bg-teal-500/10',
    iconClass: 'text-teal-500'
  },
  read: {
    icon: CircleDashed,
    i18nKey: 'knowledge.status_read',
    showProgress: true,
    containerClass:
      'flex flex-row items-center justify-center gap-2 rounded-2xs border px-2 text-amber-400 border-amber-400/20 bg-amber-400/10',
    iconClass: 'text-amber-400'
  },
  embed: {
    icon: CircleDashed,
    i18nKey: 'knowledge.status_embed',
    showProgress: true,
    containerClass:
      'flex flex-row items-center justify-center gap-2 rounded-2xs border px-2 text-amber-400 border-amber-400/20 bg-amber-400/10',
    iconClass: 'text-amber-400'
  }
}

interface StatusIconProps {
  item: KnowledgeItem
}

export const StatusIcon: FC<StatusIconProps> = ({ item }) => {
  const { t } = useTranslation()
  const { status, progress, error } = item

  return useMemo(() => {
    if (status === 'completed') {
      return (
        <Button size="icon-sm" variant="ghost">
          <CheckCircle2 size={16} className="text-primary" />
        </Button>
      )
    }

    if (status === 'failed') {
      return (
        <Button size="icon-sm" variant="ghost">
          <Tooltip placement="top" content={error}>
            <CircleX size={16} className="text-red-600" />
          </Tooltip>
        </Button>
      )
    }

    const config = STATUS_CONFIG[status]
    if (!config) {
      return null
    }

    const { icon: Icon, i18nKey, showProgress, containerClass, iconClass } = config

    return (
      <div className={containerClass}>
        <Icon size={16} className={iconClass} />
        <div>{t(i18nKey)}</div>
        {showProgress && <div>{progress}%</div>}
      </div>
    )
  }, [status, progress, error, t])
}
