import { useTranslation } from 'react-i18next'

import { cn } from '@cherrystudio/ui/lib/utils'

interface LocalModelDownloadProgressProps {
  percent: number
  className?: string
}

/**
 * Progress readout for a local model download, shared by the settings panel and the
 * download dialog. One component because the two sit one click apart: the dialog is
 * how a knowledge base starts the download, the panel is where the user watches it,
 * and a user who sees both in a row should not be able to tell they are two views.
 */
export const LocalModelDownloadProgress = ({ percent, className }: LocalModelDownloadProgressProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>{t('settings.dependencies.localModels.status.downloading')}</span>
        <span>{percent}%</span>
      </div>
    </div>
  )
}
