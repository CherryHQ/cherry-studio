import { Badge } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

interface ProviderListHeaderTitleProps {
  filteredCount: number
}

export default function ProviderListHeaderTitle({ filteredCount }: ProviderListHeaderTitleProps) {
  const { t } = useTranslation()

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <h2 className="truncate font-semibold text-[14px] text-foreground/85 leading-[1.3]">
        {t('settings.provider.title')}
      </h2>
      <Badge variant="outline" className="h-6 shrink-0 rounded-full px-2.5 py-0 text-[12px] leading-none">
        {filteredCount}
      </Badge>
    </div>
  )
}
