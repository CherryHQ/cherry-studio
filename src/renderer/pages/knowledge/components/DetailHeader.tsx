import { FlaskConical, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, PageHeader } from '@cherrystudio/ui'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

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
    <PageHeader
      title={base.name}
      className="relative mb-0 h-9 pb-1 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-b after:border-border after:content-['']"
      action={
        base.status === 'failed' ? (
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
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-muted-foreground"
              onClick={onOpenRecallTest}>
              <FlaskConical size={14} />
              {t('knowledge.tabs.recall_test')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('knowledge.tabs.rag_config')}
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={onOpenRagConfig}>
              <SlidersHorizontal size={14} />
            </Button>
          </div>
        )
      }
    />
  )
}

export default DetailHeader
