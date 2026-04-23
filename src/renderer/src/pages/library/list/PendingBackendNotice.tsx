import { Info } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

const PendingBackendNotice: FC = () => {
  const { t } = useTranslation()

  return (
    <div
      role="status"
      className="mx-5 mt-3 flex items-start gap-2 rounded-3xs border border-border/30 bg-accent/20 px-3 py-2">
      <Info size={12} className="mt-0.5 shrink-0 text-muted-foreground/60" />
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] text-foreground/80">{t('library.pending_backend.title')}</span>
        <span className="text-[10px] text-muted-foreground/55">{t('library.pending_backend.description')}</span>
      </div>
    </div>
  )
}

export default PendingBackendNotice
