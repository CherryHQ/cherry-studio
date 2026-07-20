import { Badge, Button } from '@cherrystudio/ui'
import type { KnowledgeBase } from '@shared/data/types/knowledge'
import { FlaskConical, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { statusBadgeClassNames } from './statusStyles'

interface DetailHeaderProps {
  base: KnowledgeBase
  onOpenRagConfig: () => void
  onOpenRecallTest: () => void
  onRebuild: () => void
}

const DetailHeader = ({ base, onOpenRagConfig, onOpenRecallTest, onRebuild }: DetailHeaderProps) => {
  const { t } = useTranslation()

  const statusLabelKey = `knowledge.status.${base.status}` as const
  const statusLabel = t(statusLabelKey)

  return (
    <header className="shrink-0 px-3 pt-3.5 pb-2">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 truncate font-bold text-2xl text-foreground leading-8">{base.name}</h1>
          {base.status === 'failed' && (
            <Button
              type="button"
              variant="ghost"
              onClick={onRebuild}
              aria-label={`${statusLabel}, ${t('knowledge.restore.action')}`}
              title={t('knowledge.restore.action')}
              className="h-auto min-h-0 shrink-0 cursor-pointer rounded-full p-0 shadow-none transition-opacity hover:bg-transparent hover:opacity-80">
              <Badge variant="outline" className={statusBadgeClassNames[base.status]}>
                {statusLabel}
              </Badge>
            </Button>
          )}
        </div>

        {base.status !== 'failed' && (
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onOpenRecallTest}>
              <FlaskConical size={14} />
              {t('knowledge.tabs.recall_test')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('knowledge.tabs.rag_config')}
              onClick={onOpenRagConfig}>
              <SlidersHorizontal size={14} />
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}

export default DetailHeader
